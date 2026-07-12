// 完了前の品質ゲート(QA Gate)
// エージェントの自己申告の完了報告に対し、成果物の実体をプログラム検証する。
// LLMコスト0。狙いはSKILL.md禁止事項 #5「実作業せずCOMPLETED」#6「テストせず完了報告」の素通り防止。
// 方針: 誤検知(正当な完了を差し戻す)を最小化するため保守的に判定する。
//   - ローカル成果物ファイルが実在し中身がある → pass
//   - 外部URL(Notion/Sheets/GitHub等)を提示 → pass。ただし runQaGateAsync では
//     「URLだけが根拠」の場合に実fetchで中身を検証し、404/410・placeholder文言・途切れ等の
//     高精度な破損シグナルのみ suspect に格下げ。到達不能/タイムアウト/認証要(401,403)/5xx は無罪。
//   - 上記いずれも無い → suspect(差し戻し対象)

const fs = require('fs');
const path = require('path');

const MIN_BYTES = 200; // これ未満は「中身が薄い」とみなす

// 未来形マーカー(これらだけで成果物が無いと赤信号)
const FUTURE_MARKERS = ['します', 'いたします', '予定です', 'これから', '着手します', '進めます', 'will ', 'going to'];

// 完了報告から成果物パスを抽出する
function extractArtifacts(summary) {
  if (!summary || typeof summary !== 'string') return [];
  const paths = new Set();
  // 1) ###ARTIFACT path="..."### を最優先(構造化規約)
  const artifactRe = /###ARTIFACT\s+path="([^"]+)"\s*###/g;
  let m;
  while ((m = artifactRe.exec(summary)) !== null) paths.add(m[1].trim());
  if (paths.size > 0) return [...paths];
  // 2) フォールバック: それらしいファイルパス文字列
  //    先にURL(scheme付き / 裸ドメイン)を除去して、URL内の .md 等の誤抽出を防ぐ(ハナ検出T7)
  const cleaned = summary
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[\w-]+\.(?:com|net|org|io|ai|co|jp|dev|app|gg|me|tv|fm|so|xyz)\b\S*/gi, ' ');
  const pathRe = /([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:md|json|csv|txt|png|jpg|jpeg|pdf|html|js|ts|tsx|css))/g;
  while ((m = pathRe.exec(cleaned)) !== null) {
    const p = m[1].trim();
    if (p.startsWith('http')) continue;
    paths.add(p);
  }
  return [...paths];
}

// 抽出したパスを実ファイルとして検証する
function verifyArtifacts(paths, baseDir, sinceMs) {
  return paths.map((p) => {
    const abs = path.isAbsolute(p) ? p : path.join(baseDir, p);
    let exists = false, bytes = 0, fresh = false, mtimeMs = 0;
    try {
      const st = fs.statSync(abs);
      exists = st.isFile();
      bytes = st.size;
      mtimeMs = st.mtimeMs;
      // 1分の余裕を見て、タスク開始以降に更新されたか
      fresh = sinceMs ? st.mtimeMs >= sinceMs - 60_000 : true;
    } catch {}
    return { path: p, exists, bytes, fresh, mtimeMs };
  });
}

function hasUrl(text) {
  return /https?:\/\/\S+/.test(text || '');
}

// 完了報告に明示が無くても、タスク中に reports/ に生成された実ファイルを成果物として拾う。
// 狙い: ファイルは作ったが ###ARTIFACT### を書き忘れたケースの誤差し戻し防止＋索引登録の取りこぼし防止。
function findFreshArtifacts(baseDir, thresholdMs) {
  const dir = path.join(baseDir, 'reports');
  const out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const abs = path.join(dir, f);
      const st = fs.statSync(abs);
      if (st.isFile() && st.size >= MIN_BYTES && st.mtimeMs >= thresholdMs) {
        out.push({ path: 'reports/' + f, exists: true, bytes: st.size, fresh: true, mtimeMs: st.mtimeMs, undeclared: true });
      }
    }
  } catch {}
  return out;
}

// QAゲート本体。verdict: 'pass' | 'suspect'
function runQaGate(summary, opts = {}) {
  const baseDir = opts.baseDir || process.cwd();
  const sinceMs = opts.sinceMs || 0;
  const text = summary || '';

  const artifacts = verifyArtifacts(extractArtifacts(summary), baseDir, sinceMs);
  // freshnessは「既存レポートを前提に積み上げる」運用を許すため、pass条件から外す(soft note扱い)
  const realFile = artifacts.find((a) => a.exists && a.bytes >= MIN_BYTES);
  const externalUrl = hasUrl(text);

  const reasons = [];
  if (realFile) {
    if (!realFile.fresh) reasons.push(`成果物 ${realFile.path} は今回更新されていない(既存流用の可能性)`);
    return { verdict: 'pass', passBasis: 'file', artifacts, reasons };
  }
  if (externalUrl) {
    return { verdict: 'pass', passBasis: 'external-url', artifacts, reasons: ['外部URLを成果物として提示(中身は未検証)'] };
  }

  // フォールバック: 報告に明示は無いが、タスク中に reports/ に生成された実ファイルを拾う
  const freshWindowMs = opts.freshWindowMs || 15 * 60 * 1000;
  const nowMs = opts.nowMs || Date.now();
  const threshold = sinceMs > 0 ? sinceMs - 60_000 : nowMs - freshWindowMs;
  const fresh = findFreshArtifacts(baseDir, threshold);
  if (fresh.length) {
    return { verdict: 'pass', passBasis: 'fresh-fallback', artifacts: fresh, reasons: ['報告に明示は無いが、タスク中に生成されたreports/成果物を検出(###ARTIFACT###の明示を推奨)'] };
  }

  // ここから suspect: 実成果物なし
  if (artifacts.length === 0) {
    reasons.push('完了報告に成果物パスもURLも含まれていない');
  } else {
    reasons.push('成果物が確認できない: ' + artifacts.map((a) =>
      !a.exists ? `${a.path}(不在)` : `${a.path}(${a.bytes}B/中身が薄い)`
    ).join(', '));
  }
  if (FUTURE_MARKERS.some((k) => text.includes(k))) {
    reasons.push('「〜します」等の未来形のみで実成果物がない');
  }
  return { verdict: 'suspect', artifacts, reasons };
}

// ---- 外部URLの中身検証(runQaGateAsyncからのみ使う) ----

const URL_TIMEOUT_MS = 5000; // 1URLあたりの取得タイムアウト
const MAX_URLS = 5;          // 検証するURL数の上限(暴走・遅延防止)

// 本文に含まれると「壊れ/未完成」と断定できる高精度マーカー(SPA本文の薄さ等は誤検知源なので使わない)
const BROKEN_MARKERS = [
  /lorem ipsum/i,
  /coming soon/i,
  /page not found/i,
  /404 not found/i,
  /this page could ?n[o']?t be found/i, // Notion/Vercelの404文言
];

// 完了報告テキストからhttp(s) URLを重複排除して抽出(先頭MAX_URLS件)
function extractUrls(text) {
  if (!text || typeof text !== 'string') return [];
  const urls = new Set();
  const re = /https?:\/\/[^\s"'<>)\]}]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // 末尾の句読点・閉じ括弧を落とす
    urls.add(m[0].replace(/[.,;:、。）)】\]]+$/, ''));
    if (urls.size >= MAX_URLS) break;
  }
  return [...urls];
}

// 1つのURLを取得して分類する。status: 'ok' | 'bad'(格下げ対象) | 'unknown'(無罪)
async function checkOneUrl(url, opts = {}) {
  const timeout = opts.urlTimeoutMs || URL_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { url, status: 'unknown', code: 0, reason: 'fetch利用不可' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'oco-qa-gate' },
    });
    const code = res.status;
    if (code === 404 || code === 410) return { url, status: 'bad', code, reason: `HTTP ${code}(リンク切れ)` };
    if (code === 401 || code === 403) return { url, status: 'unknown', code, reason: `HTTP ${code}(認証要・中身判定不能)` };
    if (code < 200 || code >= 300) return { url, status: 'unknown', code, reason: `HTTP ${code}(判定保留)` };
    // 2xx: 本文を高精度シグナルだけで判定(薄さ等は誤検知源なので不使用)
    let body = '';
    try { body = await res.text(); } catch {}
    const marker = BROKEN_MARKERS.find((re2) => re2.test(body));
    if (marker) return { url, status: 'bad', code, reason: `本文に未完成/404文言(${marker.source})` };
    // 連絡先メールが途中で途切れている(＠の直後にドメインが無くタグ/空白/終端)
    if (/[A-Za-z0-9._%+-]{3,}@(?:\s*<|\s*$|\s)/m.test(body)) {
      return { url, status: 'bad', code, reason: '連絡先メールがドメイン欠落で途切れている' };
    }
    return { url, status: 'ok', code, bytes: body.length };
  } catch (e) {
    const reason = e && e.name === 'AbortError' ? 'タイムアウト' : ((e && e.message) || 'ネットワーク到達不可');
    return { url, status: 'unknown', code: 0, reason }; // 到達不能は無罪
  } finally {
    clearTimeout(timer);
  }
}

// 複数URLを順次検証(件数は少ないので直列で十分)
async function verifyExternalUrls(urls, opts = {}) {
  const out = [];
  for (const url of urls) out.push(await checkOneUrl(url, opts));
  return out;
}

// 非同期版QAゲート。同期版に加え、pass根拠が「外部URLのみ」の場合に
// URL先を実fetchで検証し、破損が確定したら suspect に格下げする。
// opts.verifyUrls === false で無効化(既定ON)。opts.fetchImpl でfetch注入可(テスト用)。
async function runQaGateAsync(summary, opts = {}) {
  const base = runQaGate(summary, opts);
  if (opts.verifyUrls === false) return base;
  if (base.verdict !== 'pass' || base.passBasis !== 'external-url') return base;

  const urls = extractUrls(summary);
  if (urls.length === 0) return base;
  const checks = await verifyExternalUrls(urls, opts);
  base.urlChecks = checks;

  const bad = checks.filter((c) => c.status === 'bad');
  if (bad.length) {
    base.verdict = 'suspect';
    base.reasons = [
      ...(base.reasons || []).filter((r) => !r.includes('中身は未検証')),
      ...bad.map((b) => `外部URLが成果物として不正: ${b.url} — ${b.reason}`),
    ];
    return base;
  }
  const ok = checks.filter((c) => c.status === 'ok').length;
  const unk = checks.length - ok;
  base.reasons = [`外部URLを成果物として提示(到達検証 ok=${ok} 不明=${unk})`];
  return base;
}

module.exports = {
  extractArtifacts, verifyArtifacts, runQaGate, runQaGateAsync,
  extractUrls, verifyExternalUrls, checkOneUrl, MIN_BYTES,
};
