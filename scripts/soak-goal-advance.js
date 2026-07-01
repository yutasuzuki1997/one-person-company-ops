#!/usr/bin/env node
// 連続稼働テスト(soak)＋コスト上限ガード実発火の検証スクリプト。
// 起動済みサーバー(既定 http://localhost:3000)に対して:
//   (a) /api/goal-advance/run {dryRun:true} を N回ループ → クラッシュ無し/注入文生成/currentState検証を集計(課金ゼロ)
//   (b) app-settings.json を一時パッチ(dailyBudgetJpy=1)してコスト上限ガードの発火(reason:'daily_budget')を確認 → 必ず復元
//   (c) 短い実走を1回(dryRun:false)。ジェニー未起動なら理由を記録してスキップ。
// 結果を reports/soak-goal-advance-<日付>.md に保存する。
//
// 使い方: node scripts/soak-goal-advance.js   (環境変数 SOAK_BASE, SOAK_N で上書き可)

const fs = require('fs');
const path = require('path');

const BASE = process.env.SOAK_BASE || 'http://localhost:3000';
const N = parseInt(process.env.SOAK_N, 10) || 20;
const SETTINGS_PATH = path.join(__dirname, '..', 'app-settings.json');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

async function post(pathname, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ms: Date.now() - t0, json };
}
async function getJson(pathname) {
  const res = await fetch(BASE + pathname);
  return res.json().catch(() => ({}));
}

async function main() {
  const out = { startedAt: new Date().toISOString(), base: BASE, n: N, dryRuns: [], errors: [] };

  // 前提: サーバー疎通
  try { await getJson('/api/cost/today'); }
  catch (e) { console.error(`サーバーに到達できません(${BASE})。先に起動してください: ${e.message}`); process.exit(1); }

  // (a) 連続dryRun
  console.log(`[soak] (a) 連続dryRun x${N} ...`);
  const projects = {};
  let maxMs = 0;
  for (let i = 0; i < N; i++) {
    let r;
    try { r = await post('/api/goal-advance/run', { dryRun: true }); }
    catch (e) { out.errors.push(`dryRun#${i}: fetch失敗 ${e.message}`); continue; }
    if (!r.ok && r.status >= 500) out.errors.push(`dryRun#${i}: HTTP ${r.status}`);
    const j = r.json || {};
    maxMs = Math.max(maxMs, r.ms);
    const proj = j.project || `(${j.reason || 'no_project'})`;
    projects[proj] = (projects[proj] || 0) + 1;
    out.dryRuns.push({ i, project: j.project, reason: j.reason, dryRun: !!j.dryRun, fabricated: !!j.currentStateFabricated, hasInstruction: !!j.instruction, ms: r.ms });
  }
  out.projectsCovered = projects;
  out.maxDryRunMs = maxMs;
  // 異常検知: 注入文が組まれず reason も無い回(=想定外)
  out.malformed = out.dryRuns.filter((d) => !d.hasInstruction && !d.reason).length;

  // (b) コスト上限ガード実発火(設定を一時パッチ→必ず復元)
  console.log('[soak] (b) コスト上限ガード検証 ...');
  const backup = fs.readFileSync(SETTINGS_PATH, 'utf-8');
  try {
    const s = JSON.parse(backup);
    // 当日実績が¥0でも確実に発火させるため日次・月次の両方を1円に絞る(どちらかが既存実績を超過する)
    s.dailyBudgetJpy = 1;
    s.monthlyBudgetJpy = 1;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
    // dryRun:true でも上限チェックは委託前に走る(=委託ゼロのまま発火確認できる)
    const r = await post('/api/goal-advance/run', { dryRun: true, ignoreRateLimit: true });
    out.budgetGuard = { reason: r.json && r.json.reason, fired: !!(r.json && r.json.fired), raw: r.json };
    out.budgetGuardPass = out.budgetGuard.reason === 'daily_budget' || out.budgetGuard.reason === 'monthly_budget';
    console.log(`[soak]   guard reason=${out.budgetGuard.reason} (expected daily_budget|monthly_budget) → ${out.budgetGuardPass ? 'PASS' : 'CHECK'}`);
  } finally {
    fs.writeFileSync(SETTINGS_PATH, backup); // 必ず元に戻す
    out.settingsRestored = fs.readFileSync(SETTINGS_PATH, 'utf-8') === backup;
    console.log(`[soak]   settings restored: ${out.settingsRestored}`);
  }

  // (c) 短い実走1回
  console.log('[soak] (c) 実走1回 ...');
  const costBefore = await getJson('/api/cost/today');
  const real = await post('/api/goal-advance/run', { dryRun: false, ignoreRateLimit: true });
  out.realRun = { fired: !!(real.json && real.json.fired), reason: real.json && real.json.reason, project: real.json && real.json.project };
  // 委託は非同期。少し待ってコスト差分を見る(発火した場合のみ意味がある)
  if (out.realRun.fired) await new Promise((r) => setTimeout(r, 8000));
  const costAfter = await getJson('/api/cost/today');
  out.cost = {
    beforeJpy: Math.round(costBefore.costJpy || 0),
    afterJpy: Math.round(costAfter.costJpy || 0),
    deltaJpy: Math.round((costAfter.costJpy || 0) - (costBefore.costJpy || 0)),
  };

  // レポート保存
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(REPORTS_DIR, `soak-goal-advance-${date}.md`);
  const crashFree = out.errors.length === 0 && out.malformed === 0;
  const md = `# 自走ループ soak テスト ${date}

要点:
- 連続dryRun ${N}回: ${crashFree ? 'クラッシュ無し' : `異常${out.errors.length}件/malformed${out.malformed}件`}、最大応答 ${out.maxDryRunMs}ms、巡回プロジェクト ${Object.keys(out.projectsCovered).length}種
- コスト上限ガード: reason=\`${out.budgetGuard?.reason}\`(期待 daily_budget|monthly_budget) → ${out.budgetGuardPass ? '✅発火' : '⚠要確認'} / 設定復元 ${out.settingsRestored ? '✅' : '❌'}
- 実走1回: ${out.realRun.fired ? `発火(${out.realRun.project})・コスト差分 ¥${out.cost.deltaJpy}` : `スキップ(${out.realRun.reason})`}

## 連続dryRun 巡回内訳
${Object.entries(out.projectsCovered).map(([p, c]) => `- ${p}: ${c}回`).join('\n')}

## currentState捏造検出（dryRun中）
${out.dryRuns.filter((d) => d.fabricated).map((d) => `- #${d.i} ${d.project}: 捏造主張あり→是正注入`).join('\n') || '- 検出なし'}

## エラー
${out.errors.map((e) => `- ${e}`).join('\n') || '- なし'}

---
生成: ${out.startedAt} / base=${BASE}
`;
  fs.writeFileSync(file, md);
  console.log(`\n[soak] レポート保存: ${path.relative(path.join(__dirname, '..'), file)}`);
  console.log(`[soak] 判定: ${crashFree && out.budgetGuardPass && out.settingsRestored ? '✅ PASS' : '⚠️ 要確認(レポート参照)'}`);
  console.log(JSON.stringify({ crashFree, budgetGuardPass: out.budgetGuardPass, settingsRestored: out.settingsRestored, realRun: out.realRun, cost: out.cost }, null, 2));
}

main().catch((e) => { console.error('[soak] fatal:', e); process.exit(1); });
