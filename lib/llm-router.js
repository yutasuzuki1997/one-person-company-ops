'use strict';

const fetch = require('node-fetch');
const { completeAnthropic } = require('./anthropic-stream');

// タスクタイプ → { provider, model } のルーティングテーブル
const ROUTING = {
  classify:   { provider: 'gemini',    model: 'gemini-2.0-flash' },
  title:      { provider: 'gemini',    model: 'gemini-2.0-flash' },
  ambiguity:  { provider: 'gemini',    model: 'gemini-2.0-flash' },
  instant:    { provider: 'gemini',    model: 'gemini-2.0-flash' },
  briefing:   { provider: 'gemini',    model: 'gemini-1.5-pro' },
  light:      { provider: 'gemini',    model: 'gemini-1.5-pro' },
  heavy:      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  complex:    { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  secretary:  { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  agent:      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
};

// Anthropic fallback モデル（タスクタイプ別）
const ANTHROPIC_FALLBACK = {
  classify: 'claude-haiku-4-5-20251001',
  title:    'claude-haiku-4-5-20251001',
  ambiguity:'claude-haiku-4-5-20251001',
  instant:  'claude-haiku-4-5-20251001',
  briefing: 'claude-sonnet-4-20250514',
  light:    'claude-haiku-4-5-20251001',
};

function selectModel(taskType) {
  return ROUTING[taskType] || { provider: 'anthropic', model: 'claude-sonnet-4-20250514' };
}

async function callGemini(model, systemPrompt, messages, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
  };
  if (systemPrompt) {
    body.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeout: 30000,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOpenAI(model, systemPrompt, messages, apiKey) {
  const openaiMessages = [];
  if (systemPrompt) openaiMessages.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    openaiMessages.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    });
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: openaiMessages, max_tokens: 4096, temperature: 0.7 }),
    timeout: 30000,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * マルチプロバイダー補完。Gemini/OpenAIが利用可能ならそちらを使い、
 * キー未設定またはエラー時はAnthropicにフォールバックする。
 *
 * @param {string} taskType - 'classify' | 'briefing' | 'light' | 'heavy' | ...
 * @param {string} systemPrompt
 * @param {Array}  messages   - [{ role, content }]
 * @param {Object} settings   - app-settings.json の内容（geminiApiKey, openaiApiKey, anthropicApiKey）
 * @returns {Promise<string>}
 */
async function complete(taskType, systemPrompt, messages, settings) {
  const { provider, model } = selectModel(taskType);
  const geminiKey   = settings?.geminiApiKey;
  const openaiKey   = settings?.openaiApiKey;
  const anthropicKey = settings?.anthropicApiKey || settings?.apiKey || '';

  console.log(`[llm-router] taskType=${taskType} → ${provider}/${model}`);

  try {
    if (provider === 'gemini' && geminiKey) {
      return await callGemini(model, systemPrompt, messages, geminiKey);
    }
    if (provider === 'openai' && openaiKey) {
      return await callOpenAI(model, systemPrompt, messages, openaiKey);
    }
    // プロバイダーキー未設定 → Anthropicフォールバック
    if (provider !== 'anthropic') {
      const fallbackModel = ANTHROPIC_FALLBACK[taskType] || 'claude-haiku-4-5-20251001';
      console.log(`[llm-router] ${provider} key missing → Anthropic/${fallbackModel}`);
      return await completeAnthropic({ apiKey: anthropicKey, model: fallbackModel, system: systemPrompt, messages, maxTokens: 4096 });
    }
    // Anthropicタスク
    return await completeAnthropic({ apiKey: anthropicKey, model, system: systemPrompt, messages, maxTokens: 4096 });
  } catch (e) {
    const fallbackModel = ANTHROPIC_FALLBACK[taskType] || 'claude-haiku-4-5-20251001';
    console.error(`[llm-router] ${provider} error: ${e.message} → Anthropic/${fallbackModel}`);
    return await completeAnthropic({ apiKey: anthropicKey, model: fallbackModel, system: systemPrompt, messages, maxTokens: 4096 });
  }
}

module.exports = { selectModel, complete };
