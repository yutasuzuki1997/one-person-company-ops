'use strict';

/**
 * ワークスペース管理モジュール
 * - GitHubリポジトリのクローン
 * - エージェント情報のワークスペース同期
 * - ワークスペースコンテキストの読み込み
 */
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * ワークスペースリポジトリをローカルにgit clone
 * @param {{ owner, repo, tokenType, localPath, _token }} workspace
 * @param {Function} getToken - (tokenType) => string
 * @returns {{ success: boolean, error?: string, localPath?: string }}
 */
async function cloneWorkspace(workspace, getToken) {
  const { owner, repo, tokenType = 'personal', localPath } = workspace;
  if (!owner || !repo) return { success: false, error: 'owner と repo は必須です' };
  if (!localPath || !localPath.trim()) return { success: false, error: 'localPath は必須です' };

  const absPath = path.resolve(localPath.trim());
  const token = getToken ? getToken(tokenType) : null;

  // すでにクローン済みの場合はpullする
  if (fs.existsSync(path.join(absPath, '.git'))) {
    try {
      const remoteUrl = token
        ? `https://${token}@github.com/${owner}/${repo}.git`
        : `https://github.com/${owner}/${repo}.git`;
      execSync(`git -C "${absPath}" pull origin HEAD`, { stdio: 'pipe', timeout: 30000 });
      return { success: true, localPath: absPath, action: 'pulled' };
    } catch (e) {
      return { success: false, error: `git pull 失敗: ${e.message}` };
    }
  }

  // 親ディレクトリを作成
  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  const cloneUrl = token
    ? `https://${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  try {
    execSync(`git clone "${cloneUrl}" "${absPath}"`, { stdio: 'pipe', timeout: 60000 });
    return { success: true, localPath: absPath, action: 'cloned' };
  } catch (e) {
    return { success: false, error: `git clone 失敗: ${e.message}` };
  }
}

/**
 * エージェント情報をワークスペースの agents.json に書き込んで push
 * @param {Array} agents
 * @param {string} localPath
 * @returns {{ success: boolean, error?: string }}
 */
function syncAgentsToWorkspace(agents, localPath) {
  if (!localPath) return { success: false, error: 'localPath が未設定です' };
  const absPath = path.resolve(localPath);
  if (!fs.existsSync(absPath)) return { success: false, error: 'ワークスペースディレクトリが存在しません' };

  const agentsFile = path.join(absPath, 'agents.json');
  const agentsData = agents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    skills: a.skills || [],
    repositories: a.repositories || [],
    jobDescription: a.jobDescription || '',
    status: a.status || 'idle',
    createdAt: a.createdAt || new Date().toISOString(),
  }));

  try {
    fs.writeFileSync(agentsFile, JSON.stringify(agentsData, null, 2));
  } catch (e) {
    return { success: false, error: `agents.json 書き込み失敗: ${e.message}` };
  }

  // .git がある場合のみ commit & push
  if (!fs.existsSync(path.join(absPath, '.git'))) {
    return { success: true, pushed: false, reason: '.git がないためpushスキップ' };
  }

  try {
    execSync('git add agents.json', { cwd: absPath, stdio: 'pipe' });
    // 差分がない場合はコミット不要
    const status = execSync('git status --porcelain', { cwd: absPath, stdio: 'pipe' }).toString().trim();
    if (!status) return { success: true, pushed: false, reason: '変更なし' };

    execSync('git commit -m "Update agents"', { cwd: absPath, stdio: 'pipe' });
    execSync('git push', { cwd: absPath, stdio: 'pipe', timeout: 30000 });
    return { success: true, pushed: true };
  } catch (e) {
    return { success: false, error: `git push 失敗: ${e.message}` };
  }
}

/**
 * ワークスペースの agents.json と README.md を読み込んでコンテキスト文字列で返す
 * @param {string} localPath
 * @returns {string}
 */
function readWorkspaceContext(localPath) {
  if (!localPath) return '（ワークスペース未設定）';
  const absPath = path.resolve(localPath);
  if (!fs.existsSync(absPath)) return '（ワークスペースディレクトリが存在しません）';

  const parts = [];

  // README.md
  const readmeFile = path.join(absPath, 'README.md');
  if (fs.existsSync(readmeFile)) {
    try {
      const readme = fs.readFileSync(readmeFile, 'utf8').slice(0, 2000);
      parts.push(`### README\n${readme}`);
    } catch {}
  }

  // agents.json
  const agentsFile = path.join(absPath, 'agents.json');
  if (fs.existsSync(agentsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
      const summary = Array.isArray(data)
        ? data.map((a) => `- ${a.name} (${a.role}): ${a.jobDescription || '(JD未設定)'}`).join('\n')
        : JSON.stringify(data, null, 2).slice(0, 1000);
      parts.push(`### Workspace Agents\n${summary}`);
    } catch {}
  }

  return parts.length > 0 ? parts.join('\n\n') : '（ワークスペースにコンテンツがありません）';
}

module.exports = { cloneWorkspace, syncAgentsToWorkspace, readWorkspaceContext };
