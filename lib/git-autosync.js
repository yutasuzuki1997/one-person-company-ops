/**
 * ワークスペースを約30分ごとに Git commit（変更時のみ）・remote があれば push
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function runGit(cwd, args, timeout = 120000) {
  try {
    execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function syncWorkspace(workspacePath, gitRemoteUrl) {
  const wp = path.resolve(workspacePath);
  if (!fs.existsSync(wp)) return { ok: false, reason: 'no path' };

  try {
    if (!fs.existsSync(path.join(wp, '.git'))) {
      execSync('git init', { cwd: wp, stdio: 'pipe' });
      runGit(wp, ['config', 'user.email', 'one-person-ops@local']);
      runGit(wp, ['config', 'user.name', '1人会社Ops']);
    }
    runGit(wp, ['add', '-A']);
    const st = execSync('git status --porcelain', { cwd: wp, encoding: 'utf8' });
    if (!st.trim()) return { ok: true, committed: false };

    const msg = 'auto: ' + new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (!runGit(wp, ['commit', '-m', msg])) return { ok: false, reason: 'commit failed' };

    if (gitRemoteUrl && String(gitRemoteUrl).trim()) {
      try {
        const out = execSync('git remote -v', { cwd: wp, encoding: 'utf8' });
        if (!out.includes('origin')) {
          execSync(`git remote add origin "${String(gitRemoteUrl).replace(/"/g, '\\"')}"`, {
            cwd: wp,
            shell: true,
            stdio: 'pipe',
          });
        }
        runGit(wp, ['push', '-u', 'origin', 'HEAD'], 180000);
      } catch {
        /* push は認証未設定で失敗しうる */
      }
    }
    return { ok: true, committed: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function startAutoGitSync(getCompanies, intervalMs = 30 * 60 * 1000) {
  const tick = () => {
    let list = [];
    try {
      list = getCompanies();
    } catch {
      return;
    }
    for (const c of list) {
      const wp = c.workspacePath && String(c.workspacePath).trim();
      if (!wp) continue;
      const r = syncWorkspace(wp, c.gitRemoteUrl);
      if (r.committed) console.log('[git-autosync]', c.name, 'committed');
    }
  };
  setInterval(tick, intervalMs);
  setTimeout(tick, 60000);
}

module.exports = { syncWorkspace, startAutoGitSync };
