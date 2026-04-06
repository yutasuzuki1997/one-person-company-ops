/**
 * Anthropic Messages API (streaming)
 */
async function streamAnthropic({ apiKey, model, system, messages, onText, signal }) {
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
      model: model || 'claude-sonnet-4-20250514',
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
      } catch {
        /* ignore parse errors for ping lines */
      }
    }
  }
}

async function completeAnthropic({ apiKey, model, system, messages, maxTokens = 4096 }) {
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
      model: model || 'claude-sonnet-4-20250514',
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
  const blocks = j.content || [];
  let text = '';
  for (const b of blocks) {
    if (b.type === 'text' && b.text) text += b.text;
  }
  return text.trim();
}

module.exports = { streamAnthropic, completeAnthropic };
