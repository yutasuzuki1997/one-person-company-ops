// 主張検証(Claim Verifier) — P5
// 完了報告/currentState 内の「コミットハッシュ」「PR/Issue参照」を抽出し、GitHub上の実在を機械検証する。
// 狙い: エージェントが実在しないコミット(例: f259df1)やPRを成果として捏造し、currentStateに残すのを防ぐ。
// 方針(QAゲートと同じ): 誤検知を最小化する。404が確定したものだけ「捏造(missing)」とし、
//   gh不在/ネットワーク不通/対象リポジトリ不明は「検証不能(unverified)」=無罪扱い。
//
// 検証は GitHub CLI(gh) 経由。gh が無い/未認証なら全主張 unverified となり差し戻しは発生しない。

const { execFileSync } = require('child_process');

// コミットSHA抽出。誤検知を抑えるため:
//   - 40桁フルSHAは無条件で対象
//   - 7〜12桁の短縮SHAは [a-f] を含み、かつ近傍に commit 文脈語がある場合のみ対象(7桁の純数字IDを除外)
const COMMIT_CONTEXT = /(commit|コミット|sha|hash|ハッシュ|push|プッシュ|revision|リビジョン|\bgit\b)/i;

function extractCommits(text) {
  if (!text || typeof text !== 'string') return [];
  // URL内のパス片を誤検出しないよう、まずURLを除去
  const cleaned = text.replace(/https?:\/\/\S+/g, ' ');
  const out = new Set();
  // 40桁フルSHA
  for (const m of cleaned.matchAll(/\b([0-9a-f]{40})\b/gi)) out.add(m[1].toLowerCase());
  // 7〜12桁の短縮SHA(英字a-fを最低1つ含む)で、前後30字以内にcommit文脈語があるもの
  for (const m of cleaned.matchAll(/\b([0-9a-f]{7,12})\b/gi)) {
    const sha = m[1].toLowerCase();
    if (out.has(sha)) continue;
    if (!/[a-f]/.test(sha)) continue; // 純数字は除外
    const start = Math.max(0, m.index - 30);
    const ctx = cleaned.slice(start, m.index + sha.length + 30);
    if (COMMIT_CONTEXT.test(ctx)) out.add(sha);
  }
  return [...out];
}

// PR/Issue参照抽出: github.com/owner/repo/(pull|issues)/N のURL形式のみ(repoが特定でき検証可能)。
// 裸の #123 は対象リポジトリが曖昧なため v1 では拾わない(誤検知回避)。
function extractPrs(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  const seen = new Set();
  const re = /github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)/gi;
  for (const m of text.matchAll(re)) {
    const key = `${m[1]}/${m[2]}#${m[4]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner: m[1], repo: m[2], kind: m[3] === 'pull' ? 'pull' : 'issues', number: m[4] });
  }
  return out;
}

// 裸の #123 抽出: リポジトリが曖昧なため、近傍(前後15字)にPR/Issue文脈語がある場合のみ拾う。
// 検証は project に紐づくリポジトリ1件に対してのみ行う(誤検知回避)。
const BARE_REF_CONTEXT = /(PR|pull|プルリク|merge|マージ|issue|イシュー|チケット)/i;

function extractBareRefs(text) {
  if (!text || typeof text !== 'string') return [];
  const cleaned = text.replace(/https?:\/\/\S+/g, ' '); // URL内の#は除外
  const out = new Set();
  for (const m of cleaned.matchAll(/#(\d{1,6})\b/g)) {
    const start = Math.max(0, m.index - 15);
    const ctx = cleaned.slice(start, m.index + m[0].length + 15);
    if (BARE_REF_CONTEXT.test(ctx)) out.add(m[1]);
  }
  return [...out];
}

function extractClaims(text) {
  return { commits: extractCommits(text), prs: extractPrs(text), bareRefs: extractBareRefs(text) };
}

// app-settings.json の repositories を {owner, repo, name} に正規化
function reposFromSettings(settings) {
  const list = (settings && Array.isArray(settings.repositories)) ? settings.repositories : [];
  return list
    .filter((r) => r && r.owner && r.repo)
    .map((r) => ({ owner: r.owner, repo: r.repo, name: r.name || r.repo }));
}

// 不在を示すGitHubの応答: 404(Not Found) と、commits APIが短縮SHA未解決時に返す 422 "No commit found for SHA"。
const NOT_FOUND_RE = /HTTP 404|Not Found|No commit found|No .*found for SHA/i;

// gh api を1回叩く。exit0=存在, 不在シグナル=missing, それ以外(認証/ネットワーク)はthrow。
function ghExists(endpoint, runner) {
  const run = runner || ((args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }));
  try {
    run(['api', endpoint, '--silent']);
    return 'found';
  } catch (e) {
    const msg = String((e && (e.stderr || e.message)) || '');
    if (NOT_FOUND_RE.test(msg)) return 'missing';
    throw e; // 認証エラー・ネットワーク不通など → 検証不能として扱わせる
  }
}

// 1つのコミットSHAを候補リポジトリ群に対して検証。
//   found(repo) / missing(全候補で404) / unverified(候補なし or gh失敗)
function verifyCommit(sha, repos, runner) {
  if (!repos.length) return { status: 'unverified', repo: null };
  let queried = 0;
  for (const r of repos) {
    let res;
    try { res = ghExists(`repos/${r.owner}/${r.repo}/commits/${sha}`, runner); }
    catch { continue; } // このリポジトリは到達不能 → 次へ
    queried++;
    if (res === 'found') return { status: 'found', repo: `${r.owner}/${r.repo}` };
  }
  if (queried === 0) return { status: 'unverified', repo: null }; // 1件も到達できなかった
  return { status: 'missing', repo: null };
}

function verifyPr(pr, runner) {
  try {
    const res = ghExists(`repos/${pr.owner}/${pr.repo}/${pr.kind}/${pr.number}`, runner);
    return { status: res === 'found' ? 'found' : 'missing', repo: `${pr.owner}/${pr.repo}` };
  } catch {
    return { status: 'unverified', repo: `${pr.owner}/${pr.repo}` };
  }
}

// 本体。完了報告テキストを検証し、捏造主張があれば verdict='fabricated' を返す。
// opts: { settings, project, runner, maxCommits }
//   project: 候補リポジトリの優先付けに使う(name部分一致を先頭へ)
function verifyClaims(text, opts = {}) {
  const settings = opts.settings || {};
  const runner = opts.runner;
  const maxCommits = opts.maxCommits || 6;
  const { commits, prs, bareRefs } = extractClaims(text);

  let repos = reposFromSettings(settings);
  // project名に一致するリポジトリを判定し、先頭へ(裸SHA/裸#Nの照合を当該リポジトリ優先に)
  const matchesProject = (r) => {
    if (!opts.project) return false;
    const p = String(opts.project).toLowerCase();
    const n = (r.name || '').toLowerCase();
    return !!n && (n.includes(p) || p.includes(n));
  };
  if (opts.project && repos.length) {
    repos = repos.slice().sort((a, b) => (matchesProject(a) ? 0 : 1) - (matchesProject(b) ? 0 : 1));
  }
  // 裸#Nの検証先: project一致リポジトリが特定できる時のみ(曖昧なら検証しない)
  const projectRepo = repos.find(matchesProject) || null;

  const claims = [];
  for (const sha of commits.slice(0, maxCommits)) {
    const v = verifyCommit(sha, repos, runner);
    claims.push({ type: 'commit', value: sha, status: v.status, repo: v.repo });
  }
  for (const pr of prs) {
    const v = verifyPr(pr, runner);
    claims.push({ type: pr.kind === 'pull' ? 'pr' : 'issue', value: `${pr.owner}/${pr.repo}#${pr.number}`, status: v.status, repo: v.repo });
  }
  for (const num of bareRefs) {
    if (!projectRepo) { claims.push({ type: 'ref', value: `#${num}`, status: 'unverified', repo: null }); continue; }
    // issues/N は PR も含む(PRはissueの一種)ため、PR/Issue両対応で1回の照会で済む
    const v = verifyPr({ owner: projectRepo.owner, repo: projectRepo.repo, kind: 'issues', number: num }, runner);
    claims.push({ type: 'ref', value: `${projectRepo.owner}/${projectRepo.repo}#${num}`, status: v.status, repo: v.repo });
  }

  const fabricated = claims.filter((c) => c.status === 'missing');
  const label = { commit: '存在しないコミット', pr: '存在しないPR', issue: '存在しないIssue', ref: '存在しないPR/Issue参照' };
  const reasons = fabricated.map((c) => `${label[c.type] || '存在しない参照'}を主張: ${c.value}`);
  return { verdict: fabricated.length ? 'fabricated' : 'ok', claims, reasons };
}

// goals.json の各プロジェクト currentState を走査し、捏造主張を含むものを返す。
// 自走サイクルが残した currentState の事後点検に使う(完了報告summary経由とは別の安全網)。
// 返り値: [{ project, reasons, claims }]
function scanCurrentStates(goals, opts = {}) {
  const list = Array.isArray(goals) ? goals : [];
  const out = [];
  for (const g of list) {
    if (!g || !g.currentState || typeof g.currentState !== 'string') continue;
    const r = verifyClaims(g.currentState, { ...opts, project: g.project });
    if (r.verdict === 'fabricated') out.push({ project: g.project, reasons: r.reasons, claims: r.claims });
  }
  return out;
}

module.exports = { extractClaims, extractCommits, extractPrs, extractBareRefs, verifyClaims, scanCurrentStates, reposFromSettings };
