'use strict';

/**
 * モデルルーター
 * タスクの性質・トークン数に応じて最適なモデルを選択する。
 */

const { completeAnthropic } = require('./anthropic-stream');

// 利用可能モデルの定義（コスト順）
const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
};

/**
 * タスクに応じた最適モデルを選択する
 * @param {string} task - タスク内容
 * @param {Object} [opts]
 * @param {number} [opts.estimatedTokens] - 推定トークン数
 * @param {boolean} [opts.requiresReasoning] - 複雑な推論が必要か
 * @returns {string} モデル名
 */
function selectModel(task, opts = {}) {
  const { estimatedTokens = 0, requiresReasoning = false } = opts;

  // 複雑な推論タスクはSonnet
  if (requiresReasoning) return MODELS.sonnet;

  // 短い生成タスク（タイトル、分類、要約）はHaiku
  if (estimatedTokens < 500 || /タイトル|要約|分類|短く/i.test(task)) return MODELS.haiku;

  // デフォルトはSonnet
  return MODELS.sonnet;
}

/**
 * モデルを呼び出してテキストを生成する
 * @param {string} model - モデル名
 * @param {string} systemPrompt - システムプロンプト
 * @param {Array} messages - メッセージ配列
 * @param {Object} apiKeys - { anthropicApiKey }
 * @returns {Promise<string>}
 */
async function callModel(model, systemPrompt, messages, apiKeys) {
  const apiKey = apiKeys?.anthropicApiKey || '';
  if (!apiKey.trim()) throw new Error('APIキーが未設定です');

  return completeAnthropic({
    apiKey,
    model,
    system: systemPrompt,
    messages,
    maxTokens: 4096,
  });
}

module.exports = { selectModel, callModel, MODELS };
