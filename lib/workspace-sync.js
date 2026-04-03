'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const WORKSPACE_LOCAL = path.join(os.homedir(), '.onecompanyops-workspace');

function getWorkspacePath() {
  return WORKSPACE_LOCAL;
}

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const cmd = `git ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`;
    exec(cmd, { cwd, timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        // "nothing to commit" はエラーではない
        if (stderr && /nothing to commit/i.test(stderr)) return resolve(stdout);
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Workspaceリポジトリを初期化（clone or pull）し、DBに設定を読み込む
 */
async function initWorkspace(owner, repo, token) {
  try {
    if (!fs.existsSync(WORKSPACE_LOCAL)) {
      const cloneUrl = `https://${token}@github.com/${owner}/${repo}.git`;
      await runGit(['clone', cloneUrl, WORKSPACE_LOCAL], os.homedir());
    } else {
      await runGit(['pull'], WORKSPACE_LOCAL);
    }
    const data = loadFromWorkspace();
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * ローカルデータをWorkspaceリポジトリに書き込んでpush
 * @param {{ agents?, settings?, history? }} data
 * @param {string} commitMessage
 */
async function saveToWorkspace(data, commitMessage) {
  try {
    if (!fs.existsSync(WORKSPACE_LOCAL)) {
      return { success: false, error: 'Workspaceがまだ初期化されていません' };
    }

    const { agents, settings, history } = data || {};

    // agents.json
    if (agents !== undefined) {
      fs.writeFileSync(
        path.join(WORKSPACE_LOCAL, 'agents.json'),
        JSON.stringify(agents, null, 2),
        'utf8'
      );
    }

    // app-settings.json（機密キーはマスク）
    if (settings !== undefined) {
      const masked = { ...settings };
      delete masked.anthropicApiKey;
      delete masked.githubPersonalToken;
      delete masked.githubCompanyToken;
      fs.writeFileSync(
        path.join(WORKSPACE_LOCAL, 'app-settings.json'),
        JSON.stringify(masked, null, 2),
        'utf8'
      );
    }

    // history/{YYYY-MM-DD}.json
    if (history !== undefined) {
      const historyDir = path.join(WORKSPACE_LOCAL, 'history');
      fs.mkdirSync(historyDir, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(
        path.join(historyDir, `${today}.json`),
        JSON.stringify(history, null, 2),
        'utf8'
      );
    }

    await runGit(['add', '.'], WORKSPACE_LOCAL);
    try {
      await runGit(['commit', '-m', commitMessage || 'Update'], WORKSPACE_LOCAL);
    } catch (e) {
      if (!/nothing to commit/i.test(e.message)) throw e;
      // コミットするものがなければpushも不要
      return { success: true, skipped: true };
    }
    await runGit(['push'], WORKSPACE_LOCAL);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Workspaceからデータを読み込む
 * @returns {{ agents: any[], skills: string[], history: object }}
 */
function loadFromWorkspace() {
  let agents = [];
  let skills = [];
  let history = {};

  // agents.json
  try {
    const agentsFile = path.join(WORKSPACE_LOCAL, 'agents.json');
    if (fs.existsSync(agentsFile)) {
      agents = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
    }
  } catch {}

  // skills/*.md ファイル名一覧
  try {
    const skillsDir = path.join(WORKSPACE_LOCAL, 'skills');
    if (fs.existsSync(skillsDir)) {
      skills = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.md'));
    }
  } catch {}

  // history/ 配下の最新3ファイルの内容
  try {
    const historyDir = path.join(WORKSPACE_LOCAL, 'history');
    if (fs.existsSync(historyDir)) {
      const files = fs.readdirSync(historyDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .slice(-3);
      for (const file of files) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf8'));
          history[file.replace('.json', '')] = content;
        } catch {}
      }
    }
  } catch {}

  return { agents, skills, history };
}

/**
 * Workspace の skills/ 配下の .md ファイルをローカルの skills/ にコピーする
 */
function syncSkillsFromWorkspace() {
  try {
    const srcDir = path.join(WORKSPACE_LOCAL, 'skills');
    const dstDir = path.join(__dirname, '..', 'skills');

    if (!fs.existsSync(srcDir)) return { success: true, copied: 0 };
    fs.mkdirSync(dstDir, { recursive: true });

    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
    }

    return { success: true, copied: files.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  getWorkspacePath,
  initWorkspace,
  saveToWorkspace,
  loadFromWorkspace,
  syncSkillsFromWorkspace,
};
