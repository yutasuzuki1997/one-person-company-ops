// 完了前の品質ゲート(QA Gate)
// エージェントの自己申告の完了報告に対し、成果物の実体をプログラム検証する。
// LLMコスト0。狙いはSKILL.md禁止事項 #5「実作業せずCOMPLETED」#6「テストせず完了報告」の素通り防止。
// 方針: 誤検知(正当な完了を差し戻す)を最小化するため保守的に判定する。
//   - ローカル成果物ファイルが実在し中身がある → pass
//   - 外部URL(Notion/Sheets/GitHub等)を提示 → pass(v1ではURL先の中身は未検証。LLMエスカレーションで補完予定)
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
    return { verdict: 'pass', artifacts, reasons };
  }
  if (externalUrl) {
    return { verdict: 'pass', artifacts, reasons: ['外部URLを成果物として提示(中身は未検証)'] };
  }

  // フォールバック: 報告に明示は無いが、タスク中に reports/ に生成された実ファイルを拾う
  const freshWindowMs = opts.freshWindowMs || 15 * 60 * 1000;
  const nowMs = opts.nowMs || Date.now();
  const threshold = sinceMs > 0 ? sinceMs - 60_000 : nowMs - freshWindowMs;
  const fresh = findFreshArtifacts(baseDir, threshold);
  if (fresh.length) {
    return { verdict: 'pass', artifacts: fresh, reasons: ['報告に明示は無いが、タスク中に生成されたreports/成果物を検出(###ARTIFACT###の明示を推奨)'] };
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

module.exports = { extractArtifacts, verifyArtifacts, runQaGate, MIN_BYTES };
