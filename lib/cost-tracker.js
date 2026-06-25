const fs = require('fs')
const path = require('path')

/**
 * トークン使用量とコストを日次×エージェント別で記録する。
 * 真値のコストは Claude CLI の result.total_cost_usd(ドル)。
 * サブエージェントは token のみ取れる場合があるので、コスト合算は costUsd を持つ
 * エントリ(=ターン全体, agentId='jenny')の総和を当日コストとして扱う。
 */

let LEDGER_PATH = path.join(__dirname, '..', 'data', 'cost-ledger.json')

// モデル別 $/MTok [input, output]。API直叩き経路はコストが返らないので概算に使う。
// (CLI経由は result.total_cost_usd が真値なので概算不要)
const PRICING = {
  'claude-opus': [15, 75],
  'claude-sonnet': [3, 15],
  'claude-haiku': [1, 5],
  'gemini': [0.15, 0.6],
  'gpt': [2.5, 10],
}
function priceFor(model = '') {
  const m = String(model).toLowerCase()
  for (const key of Object.keys(PRICING)) if (m.includes(key.replace('claude-', '')) || m.includes(key)) return PRICING[key]
  return PRICING['claude-sonnet'] // 不明はSonnet相当で安全側
}
// usage(input_tokens/output_tokens)とモデルからドル概算
function estimateCostUsd(model, usage) {
  if (!usage) return 0
  const [inP, outP] = priceFor(model)
  const inTok = usage.input_tokens || 0
  const outTok = usage.output_tokens || 0
  return (inTok * inP + outTok * outP) / 1e6
}

function configure(dataDir) {
  if (dataDir) LEDGER_PATH = path.join(dataDir, 'cost-ledger.json')
}

// JST基準の YYYY-MM-DD
function jstDate(d = new Date()) {
  const jst = new Date(d.getTime() + 9 * 3600 * 1000)
  return jst.toISOString().slice(0, 10)
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function save(ledger) {
  try {
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true })
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf-8')
  } catch (e) {
    console.error('[cost-tracker] save error:', e.message)
  }
}

/**
 * @param {object} rec { agentId, sessionId, usage, costUsd, companyId }
 *   usage: Anthropic usage オブジェクト(input_tokens/output_tokens 等) または { total_tokens }
 *   costUsd: ドルコスト(取れない場合 null)
 */
function recordUsage({ agentId = 'unknown', usage = null, costUsd = null } = {}) {
  const date = jstDate()
  const ledger = load()
  if (!ledger[date]) ledger[date] = {}
  if (!ledger[date][agentId]) ledger[date][agentId] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, calls: 0 }
  const e = ledger[date][agentId]
  e.calls += 1
  if (usage) {
    e.inputTokens += usage.input_tokens || 0
    e.outputTokens += usage.output_tokens || 0
    e.totalTokens += usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0))
  }
  if (costUsd != null) e.costUsd += costUsd
  save(ledger)
  return e
}

// 当日のドルコスト合計(costUsdを持つエントリの総和)
function getDailyCostUsd(date = jstDate()) {
  const ledger = load()
  const day = ledger[date] || {}
  return Object.values(day).reduce((s, e) => s + (e.costUsd || 0), 0)
}

// 当月(YYYY-MM, JST)のドルコスト合計
function jstMonth(d = new Date()) { return jstDate(d).slice(0, 7) }
function getMonthlyCostUsd(ym = jstMonth()) {
  const ledger = load()
  let sum = 0
  for (const [date, day] of Object.entries(ledger)) {
    if (!date.startsWith(ym)) continue
    sum += Object.values(day).reduce((s, e) => s + (e.costUsd || 0), 0)
  }
  return sum
}
function getMonthlyCostJpy(usdJpyRate = 160, ym = jstMonth()) {
  return getMonthlyCostUsd(ym) * usdJpyRate
}
function isOverMonthlyBudget(monthlyBudgetJpy, usdJpyRate = 160) {
  if (!monthlyBudgetJpy || monthlyBudgetJpy <= 0) return false
  return getMonthlyCostJpy(usdJpyRate) >= monthlyBudgetJpy
}

function getDailyCostJpy(usdJpyRate = 160, date = jstDate()) {
  return getDailyCostUsd(date) * usdJpyRate
}

function getDailyBreakdown(date = jstDate()) {
  const ledger = load()
  return ledger[date] || {}
}

function getAgentCost(agentId, date = jstDate()) {
  const ledger = load()
  return (ledger[date] && ledger[date][agentId]) || null
}

/**
 * 当日のエージェント別内訳に、当日総USDをトークン按分した推定USD(costUsdApportioned)を付与したビュー。
 * ネイティブ委託ではターン全体の真値USDが jenny に集約され、サブエージェントは token のみ(USD=0)になる。
 * そのため内訳の目安として、当日の総USD(=真値の合計)を各エージェントの totalTokens 比で割り当てる。
 * Σ costUsdApportioned == getDailyCostUsd(date) を厳密に満たす(再配分であって加算ではない=二重計上なし)。
 * 真値の合計・予算ガードは従来どおり costUsd(getDailyCostUsd) 側を使うこと。
 */
function getDailyBreakdownApportioned(date = jstDate()) {
  const day = getDailyBreakdown(date)
  const agents = Object.keys(day)
  const totalUsd = agents.reduce((s, a) => s + (day[a].costUsd || 0), 0)
  const totalTok = agents.reduce((s, a) => s + (day[a].totalTokens || 0), 0)
  const out = {}
  for (const a of agents) {
    const e = day[a]
    const share = totalTok > 0 ? (e.totalTokens || 0) / totalTok : 0
    out[a] = { ...e, costUsdApportioned: totalUsd * share }
  }
  return out
}

/**
 * 当日のコストが上限(円)を超えたか。
 * dailyBudgetJpy <= 0 / 未設定 なら上限なし(false)。
 */
function isOverBudget(dailyBudgetJpy, usdJpyRate = 160) {
  if (!dailyBudgetJpy || dailyBudgetJpy <= 0) return false
  return getDailyCostJpy(usdJpyRate) >= dailyBudgetJpy
}

module.exports = {
  configure,
  recordUsage,
  estimateCostUsd,
  getDailyCostUsd,
  getDailyCostJpy,
  getDailyBreakdown,
  getDailyBreakdownApportioned,
  getAgentCost,
  isOverBudget,
  jstDate,
  jstMonth,
  getMonthlyCostUsd,
  getMonthlyCostJpy,
  isOverMonthlyBudget,
}
