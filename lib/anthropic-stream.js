let costTracker = null
try { costTracker = require('./cost-tracker') } catch {}
// API直叩きのusageを概算コストで記録(失敗しても本処理は止めない)
function recordApiUsage(model, usage, agentId = 'api-misc') {
  if (!costTracker || !usage) return
  try {
    costTracker.recordUsage({ agentId, usage, costUsd: costTracker.estimateCostUsd(model, usage) })
  } catch {}
}

/**
 * Anthropic Messages API (streaming)
 */
async function streamAnthropic({ apiKey, model, system, messages, onText, signal, agentId }) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('APIキーが設定されていません。設定画面で登録してください。');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: system || 'You are a helpful assistant.',
      messages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    let errText = '';
    try {
      const j = await res.json();
      errText = j.error?.message || JSON.stringify(j);
    } catch {
      errText = await res.text();
    }
    const errLower = (errText || '').toLowerCase();
    if (errLower.includes('credit') || errLower.includes('balance') || errLower.includes('billing')) {
      console.error('[API] クレジット不足: https://console.anthropic.com でチャージしてください');
      const creditErr = new Error('APIクレジットが不足しています。設定画面でAPIキーを確認してください。');
      creditErr.isCredit = true;
      throw creditErr;
    }
    throw new Error(errText || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  const usage = { input_tokens: 0, output_tokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const ev = JSON.parse(data);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          onText(ev.delta.text);
        }
        if (ev.type === 'message_start' && ev.message?.usage) usage.input_tokens = ev.message.usage.input_tokens || 0;
        if (ev.type === 'message_delta' && ev.usage) usage.output_tokens = ev.usage.output_tokens || 0;
      } catch {
        /* ignore parse errors for ping lines */
      }
    }
  }
  recordApiUsage(model, usage, agentId);
}

async function completeAnthropic({ apiKey, model, system, messages, maxTokens = 4096, agentId }) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('APIキーが設定されていません。');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: system || 'You are a helpful assistant.',
      messages,
      stream: false,
    }),
  });
  if (!res.ok) {
    let errText = '';
    try {
      const j = await res.json();
      errText = j.error?.message || JSON.stringify(j);
    } catch {
      errText = await res.text();
    }
    const errLower = (errText || '').toLowerCase();
    if (errLower.includes('credit') || errLower.includes('balance') || errLower.includes('billing')) {
      console.error('[API] クレジット不足: https://console.anthropic.com でチャージしてください');
      const creditErr = new Error('APIクレジットが不足しています。設定画面でAPIキーを確認してください。');
      creditErr.isCredit = true;
      throw creditErr;
    }
    throw new Error(errText || `HTTP ${res.status}`);
  }
  const j = await res.json();
  recordApiUsage(model, j.usage, agentId);
  const blocks = j.content || [];
  let text = '';
  for (const b of blocks) {
    if (b.type === 'text' && b.text) text += b.text;
  }
  return text.trim();
}

/**
 * Web検索ツール対応版（Anthropic built-in web_search_20250305）
 */
async function completeWithTools({ apiKey, model, system, messages, tools, maxTokens = 8192, maxLoops = 5, agentId }) {
  if (!apiKey || !apiKey.trim()) throw new Error('APIキーが設定されていません。');
  const headers = {
    'x-api-key': apiKey.trim(),
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  const hasWebSearch = tools?.some(t => t.type === 'web_search_20250305');
  if (hasWebSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';

  let currentMessages = [...messages];
  let allText = '';
  let searchResults = [];
  const usageAcc = { input_tokens: 0, output_tokens: 0 };

  for (let loop = 0; loop < maxLoops; loop++) {
    const body = { model: model || 'claude-sonnet-4-6', max_tokens: maxTokens, system: system || 'You are a helpful assistant.', messages: currentMessages, stream: false };
    if (tools && tools.length > 0) body.tools = tools;
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const errText = j.error?.message || `HTTP ${res.status}`;
      const e = new Error(errText);
      if ((errText||'').toLowerCase().includes('credit')) e.isCredit = true;
      throw e;
    }
    const j = await res.json();
    if (j.usage) { usageAcc.input_tokens += j.usage.input_tokens || 0; usageAcc.output_tokens += j.usage.output_tokens || 0; }
    const content = j.content || [];
    for (const block of content) {
      if (block.type === 'text' && block.text) allText += block.text;
      if (block.type === 'web_search_tool_result') {
        for (const sr of (block.content || [])) {
          if (sr.type === 'web_search_result') searchResults.push({ title: sr.title, url: sr.url });
        }
      }
    }
    if (j.stop_reason === 'end_turn' || j.stop_reason === 'stop_sequence') break;
    if (j.stop_reason === 'tool_use') {
      currentMessages.push({ role: 'assistant', content });
      const toolResults = content.filter(b => b.type === 'tool_use').map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Tool executed.' }));
      if (toolResults.length > 0) currentMessages.push({ role: 'user', content: toolResults });
      continue;
    }
    break;
  }
  recordApiUsage(model, usageAcc, agentId);
  if (searchResults.length > 0) console.log(`[web_search] 検索実行: ${searchResults.length}件取得 - ${searchResults.slice(0,2).map(r=>r.title||r.url).join(', ')}`);
  return { text: allText.trim(), searchResults };
}

module.exports = { streamAnthropic, completeAnthropic, completeWithTools };
