// プロジェクト知識インデックス
// 「プロジェクト ⇄ 成果物 ⇄ 現状」を結ぶ単一の真実源(project-index.json)。
// 狙い: QAゲートで検証済みの成果物を登録し、委託時にプロジェクトの過去資産一覧を
//       プロンプトへ自動注入する。書き込み(完了→保存)と読み戻し(委託時)の分断を閉じる。
//
// 真実源はローカル reports/ (エージェントがcwdで読み書きする実体)。
// プロジェクト名↔ファイル名のマッピングは workspace-memory.detectProject を共用する。

const fs = require('fs');
const path = require('path');
const { detectProject } = require('./workspace-memory');

function indexPath(dataDir) { return path.join(dataDir, 'project-index.json'); }
function reportsDir(dataDir) { return path.join(dataDir, 'reports'); }

function loadIndex(dataDir) {
  try { return JSON.parse(fs.readFileSync(indexPath(dataDir), 'utf-8')); } catch { return {}; }
}
function saveIndex(dataDir, idx) {
  try { fs.writeFileSync(indexPath(dataDir), JSON.stringify(idx, null, 2), 'utf-8'); }
  catch (e) { console.error('[project-knowledge] save error:', e.message); }
}

// reports/*.md の冒頭から見出しと1行要約を抽出
function extractTitleSummary(absPath) {
  let title = path.basename(absPath), summary = '';
  try {
    const lines = fs.readFileSync(absPath, 'utf-8').split('\n').map((l) => l.trim());
    const h = lines.find((l) => l.startsWith('# '));
    if (h) title = h.replace(/^#+\s*/, '').trim();
    const body = lines.find((l) => l && !l.startsWith('#') && !l.startsWith('---'));
    if (body) summary = body.replace(/^[-*]\s*/, '').slice(0, 120);
  } catch {}
  return { title, summary };
}

// プロジェクト名(表示名)→正規化スラッグ
function projectSlug(project) { return detectProject(String(project || '')); }

// 起動時: reports/ を走査して既存資産をインデックスへ取り込む(冪等・マージ)
function buildIndexFromReports(dataDir, projects) {
  const idx = loadIndex(dataDir);
  let files = [];
  try { files = fs.readdirSync(reportsDir(dataDir)).filter((f) => f.endsWith('.md')); } catch { return idx; }
  // slug→表示名 マップ(goals.jsonのproject一覧から)
  const slugToProject = {};
  for (const p of (projects || [])) { const s = projectSlug(p); if (s && s !== 'general') slugToProject[s] = p; }
  for (const f of files) {
    const project = slugToProject[detectProject(f)];
    if (!project) continue; // 対応プロジェクト不明はスキップ
    const rel = 'reports/' + f;
    const bucket = idx[project] || (idx[project] = { artifacts: [], updatedAt: null });
    if (bucket.artifacts.some((a) => a.path === rel)) continue; // 既出
    const { title, summary } = extractTitleSummary(path.join(reportsDir(dataDir), f));
    bucket.artifacts.push({ path: rel, title, summary, agent: null, at: null });
    bucket.updatedAt = new Date().toISOString();
  }
  saveIndex(dataDir, idx);
  return idx;
}

// QA合格時: 検証済み(実在)成果物を登録/更新(重複排除)
function registerArtifacts(dataDir, project, artifacts, meta = {}) {
  if (!project) return;
  const real = (artifacts || []).filter((a) => a && a.exists && a.path);
  if (real.length === 0) return;
  const idx = loadIndex(dataDir);
  const bucket = idx[project] || (idx[project] = { artifacts: [], updatedAt: null });
  for (const a of real) {
    const { title, summary } = extractTitleSummary(path.join(dataDir, a.path));
    const existing = bucket.artifacts.find((x) => x.path === a.path);
    if (existing) {
      existing.title = title; existing.summary = summary;
      existing.agent = meta.agent || existing.agent; existing.at = meta.at || new Date().toISOString();
    } else {
      bucket.artifacts.push({ path: a.path, title, summary, agent: meta.agent || null, at: meta.at || new Date().toISOString() });
    }
  }
  bucket.updatedAt = new Date().toISOString();
  saveIndex(dataDir, idx);
}

// 委託プロンプト注入用: プロジェクトの既存資産を簡潔列挙(直近15件)
function getProjectContext(dataDir, project) {
  const bucket = loadIndex(dataDir)[project];
  if (!bucket || !bucket.artifacts || !bucket.artifacts.length) return '';
  return bucket.artifacts.slice(-15)
    .map((a) => `- ${a.path}${a.title ? ` … ${a.title}` : ''}`)
    .join('\n');
}

// agentId / タスク名からプロジェクト表示名を解決(owner一致を優先)
function resolveProject(agentId, taskName, goals) {
  const list = Array.isArray(goals) ? goals : [];
  const byOwner = list.find((g) => g && g.owner && g.owner === agentId);
  if (byOwner) return byOwner.project;
  const slug = detectProject(taskName || '');
  if (slug && slug !== 'general') {
    const bySlug = list.find((g) => projectSlug(g.project) === slug);
    if (bySlug) return bySlug.project;
  }
  return null;
}

module.exports = { loadIndex, buildIndexFromReports, registerArtifacts, getProjectContext, resolveProject };
