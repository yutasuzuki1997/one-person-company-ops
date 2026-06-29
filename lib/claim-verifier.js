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

function extractClaims(text) {
  return { commits: extractCommits(text), prs: extractPrs(text) };
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
  const { commits, prs } = extractClaims(text);

  let repos = reposFromSettings(settings);
  // project名に一致するリポジトリを先頭へ(裸SHAの照合を当該リポジトリ優先に)
  if (opts.project && repos.length) {
    const p = String(opts.project).toLowerCase();
    repos = repos.slice().sort((a, b) => {
      const am = (a.name || '').toLowerCase().includes(p) || p.includes((a.name || '').toLowerCase()) ? 0 : 1;
      const bm = (b.name || '').toLowerCase().includes(p) || p.includes((b.name || '').toLowerCase()) ? 0 : 1;
      return am - bm;
    });
  }

  const claims = [];
  for (const sha of commits.slice(0, maxCommits)) {
    const v = verifyCommit(sha, repos, runner);
    claims.push({ type: 'commit', value: sha, status: v.status, repo: v.repo });
  }
  for (const pr of prs) {
    const v = verifyPr(pr, runner);
    claims.push({ type: pr.kind === 'pull' ? 'pr' : 'issue', value: `${pr.owner}/${pr.repo}#${pr.number}`, status: v.status, repo: v.repo });
  }

  const fabricated = claims.filter((c) => c.status === 'missing');
  const reasons = fabricated.map((c) =>
    c.type === 'commit'
      ? `存在しないコミットを主張: ${c.value}(GitHub上に未検出)`
      : `存在しない${c.type === 'pr' ? 'PR' : 'Issue'}を主張: ${c.value}`
  );
  return { verdict: fabricated.length ? 'fabricated' : 'ok', claims, reasons };
}

module.exports = { extractClaims, extractCommits, extractPrs, verifyClaims, reposFromSettings };
