/**
 * 秘書応答の末尾 ###DELEGATE JSON を解析し、各担当エージェントへ転送
 */
function parseDelegateBlock(fullText) {
  const idx = fullText.lastIndexOf('###DELEGATE');
  if (idx === -1) return { cleanReply: fullText, delegations: [] };
  const after = fullText.slice(idx + '###DELEGATE'.length).trim();
  const jsonMatch = after.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { cleanReply: fullText.slice(0, idx).trim(), delegations: [] };
  try {
    const arr = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(arr)) return { cleanReply: fullText.slice(0, idx).trim(), delegations: [] };
    const delegations = arr
      .filter((x) => x && (x.role || x.target) && x.instruction)
      .map((x) => ({
        roleHint: String(x.role || x.target || ''),
        instruction: String(x.instruction || '').trim(),
      }));
    return { cleanReply: fullText.slice(0, idx).trim(), delegations };
  } catch {
    return { cleanReply: fullText.slice(0, idx).trim(), delegations: [] };
  }
}

function matchAgent(roleHint, agents) {
  const h = roleHint.toLowerCase();
  for (const a of agents) {
    const r = (a.role || '').toLowerCase();
    const n = (a.name || '').toLowerCase();
    if (h && (r.includes(h) || h.includes(r.slice(0, 4)) || n.includes(h.slice(0, 3)))) return a;
  }
  const map = {
    開発: '開発',
    エンジニア: '開発',
    engineering: '開発',
    pm: 'PM',
    プロジェクト: 'PM',
    リサーチ: 'リサーチ',
    research: 'リサーチ',
    マーケ: 'マーケ',
    marketing: 'マーケ',
    ナレッジ: 'ナレッジ',
  };
  for (const [k, v] of Object.entries(map)) {
    if (h.includes(k)) {
      const found = agents.find((a) => (a.role || '').includes(v) || (a.name || '').includes(v));
      if (found) return found;
    }
  }
  return null;
}

module.exports = { parseDelegateBlock, matchAgent };
