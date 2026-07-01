// QAゲート計測(QA Metrics)
// QA判定/LLM二次レビュー/主張検証の結果を追記専用JSONLに記録し、誤検知・見逃し率を後から集計できるようにする。
// 副作用ログなので、書き込み失敗でQA本処理を止めない(全てtry/catchで握りつぶす)。

const fs = require('fs');
const path = require('path');

const FILE = 'qa-metrics.jsonl';

// claim-verifier の claims 配列から分布を要約する。
//   { found, missing, unverified, bareRefSkipped }
// bareRefSkipped: 裸#N(repo曖昧)で検証先が特定できずスキップした件数(false-negative露出の可視化)。
function summarizeClaims(claims) {
  const out = { found: 0, missing: 0, unverified: 0, bareRefSkipped: 0 };
  for (const c of claims || []) {
    if (c.status === 'found') out.found++;
    else if (c.status === 'missing') out.missing++;
    else if (c.status === 'unverified') {
      out.unverified++;
      // 裸#N(type:'ref' かつ repo未特定)はスキップ扱い
      if (c.type === 'ref' && !c.repo) out.bareRefSkipped++;
    }
  }
  return out;
}

// 1レコード追記。record例: { kind:'verdict', taskId, agentId, verdict, claim:{...}, reworkCount }
function recordQaMetric(baseDir, record) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n';
    fs.appendFileSync(path.join(baseDir || process.cwd(), FILE), line);
  } catch { /* メトリクスは副作用 */ }
}

// 集計: verdict件数・LLMフラグ率・claim分布・裸#Nスキップ累計。
function summarizeQaMetrics(baseDir) {
  const acc = {
    total: 0, pass: 0, suspect: 0,
    llmReviews: 0, llmFlagged: 0,
    claimsFound: 0, claimsMissing: 0, claimsUnverified: 0, bareRefSkipped: 0,
  };
  let lines = [];
  try { lines = fs.readFileSync(path.join(baseDir || process.cwd(), FILE), 'utf-8').split('\n').filter(Boolean); }
  catch { return acc; }
  for (const l of lines) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (r.kind === 'verdict') {
      acc.total++;
      if (r.verdict === 'pass') acc.pass++;
      else if (r.verdict === 'suspect') acc.suspect++;
      if (r.claim) {
        acc.claimsFound += r.claim.found || 0;
        acc.claimsMissing += r.claim.missing || 0;
        acc.claimsUnverified += r.claim.unverified || 0;
        acc.bareRefSkipped += r.claim.bareRefSkipped || 0;
      }
    } else if (r.kind === 'llm_review') {
      acc.llmReviews++;
      if (r.flagged) acc.llmFlagged++;
    }
  }
  return acc;
}

module.exports = { recordQaMetric, summarizeQaMetrics, summarizeClaims };
