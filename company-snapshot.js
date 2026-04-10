/**
 * cc-company 互換: .company/ 配下から「1人会社」のスナップショットを読む
 * @see https://github.com/Shin-sibainu/cc-company
 */
const fs = require('fs');
const path = require('path');

function safeExists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readFileLimited(file, max = 4000) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return '';
    return fs.readFileSync(file, 'utf8').slice(0, max);
  } catch {
    return '';
  }
}

/**
 * repoPath 直下に .company があるか検査し、秘書TODO・部署一覧を返す
 */
function snapshotFromRepo(repoPath, projectName) {
  const base = path.resolve(repoPath);
  const companyRoot = path.join(base, '.company');
  if (!safeExists(companyRoot)) {
    return null;
  }

  const todosDir = path.join(companyRoot, 'secretary', 'todos');
  let todosContent = '';
  let todosFile = '';
  const today = new Date().toISOString().slice(0, 10);
  const todayPath = path.join(todosDir, `${today}.md`);
  if (fs.existsSync(todayPath)) {
    todosContent = readFileLimited(todayPath, 3500);
    todosFile = `${today}.md`;
  } else if (safeExists(todosDir)) {
    let latest = null;
    let latestM = 0;
    try {
      for (const name of fs.readdirSync(todosDir)) {
        if (!name.endsWith('.md')) continue;
        const fp = path.join(todosDir, name);
        const st = fs.statSync(fp);
        if (st.mtimeMs > latestM) {
          latestM = st.mtimeMs;
          latest = { name, fp };
        }
      }
    } catch {
      /* ignore */
    }
    if (latest) {
      todosContent = readFileLimited(latest.fp, 3500);
      todosFile = latest.name;
    }
  }

  const orgClaude = readFileLimited(path.join(companyRoot, 'CLAUDE.md'), 1200);
  const secretaryClaude = readFileLimited(path.join(companyRoot, 'secretary', 'CLAUDE.md'), 800);

  const departments = [];
  try {
    for (const name of fs.readdirSync(companyRoot)) {
      if (name === 'secretary' || name.startsWith('.')) continue;
      const sub = path.join(companyRoot, name);
      if (!fs.statSync(sub).isDirectory()) continue;
      if (fs.existsSync(path.join(sub, 'CLAUDE.md'))) departments.push(name);
    }
  } catch {
    /* ignore */
  }

  return {
    projectName: projectName || path.basename(base),
    repoPath: base,
    hasCompany: true,
    secretaryTodosPreview: todosContent,
    secretaryTodosFile: todosFile,
    organizationRulesExcerpt: orgClaude,
    secretaryBriefExcerpt: secretaryClaude,
    departments,
  };
}

module.exports = { snapshotFromRepo };
