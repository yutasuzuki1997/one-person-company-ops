import { useEffect, useRef, useState } from 'react';

/**
 * AgentChat — 特定エージェントとの1:1チャット用スライドインパネル
 * MVP: 直近メッセージ表示 + 直接指示入力。詳細(JD等)は onSwitchToDetail へ。
 */
export default function AgentChat({ agent, companyId, activeAgents = [], onClose, onSwitchToDetail }) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!agent?.id || !companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/companies/${companyId}/agents/${agent.id}/messages`);
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled && Array.isArray(d.messages)) setMessages(d.messages);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [agent?.id, companyId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setMessages((prev) => [...prev, { role: 'user', content: text, timestamp: new Date().toISOString() }]);
    setInput('');
    try {
      const r = await fetch(`/api/companies/${companyId}/agents/${agent.id}/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const d = await r.json().catch(() => ({}));
      if (d?.reply) {
        setMessages((prev) => [...prev, { role: 'agent', content: d.reply, timestamp: new Date().toISOString() }]);
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'error', content: '送信エラー: ' + e.message }]);
    } finally {
      setSending(false);
    }
  }

  const status = agent?.status || 'idle';
  const isWorking = status === 'working';

  return (
    <div className="agent-chat-overlay" onClick={onClose}>
      <div className="agent-chat" onClick={(e) => e.stopPropagation()}>
        <div className="agent-chat__header">
          <div className="agent-chat__title">
            <span className="agent-chat__avatar">{agent?.avatar || '🤖'}</span>
            <div>
              <div className="agent-chat__name">{agent?.name}{isWorking && <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 11 }}>🟢 作業中</span>}</div>
              <div className="agent-chat__role">{agent?.role}{agent?.project ? ` · ${agent.project}` : ''}</div>
            </div>
          </div>
          <div className="agent-chat__actions">
            <button className="agent-chat__btn" onClick={onSwitchToDetail}>詳細</button>
            <button className="agent-chat__btn agent-chat__btn--close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="agent-chat__body">
          {messages.length === 0 && (
            <div className="agent-chat__empty">まだメッセージはありません。<br />下の入力欄から直接指示できます。</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`agent-chat__msg agent-chat__msg--${m.role}`}>
              <div className="agent-chat__msg-text">{m.content}</div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="agent-chat__input-wrap">
          <textarea
            className="agent-chat__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
            placeholder={`${agent?.name || 'エージェント'}へ指示…  (Cmd+Enterで送信)`}
            rows={2}
            disabled={sending}
          />
          <button className="agent-chat__send" onClick={handleSend} disabled={sending || !input.trim()}>
            {sending ? '…' : '送信'}
          </button>
        </div>

        <style>{`
          .agent-chat-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000;
            display: flex; justify-content: flex-end;
          }
          .agent-chat {
            width: min(480px, 100vw); height: 100vh; background: #0f172a;
            border-left: 1px solid rgba(51,65,85,0.6); display: flex; flex-direction: column;
            color: #e2e8f0;
          }
          .agent-chat__header {
            display: flex; justify-content: space-between; align-items: center;
            padding: 14px 18px; border-bottom: 1px solid rgba(51,65,85,0.6);
          }
          .agent-chat__title { display: flex; gap: 10px; align-items: center; }
          .agent-chat__avatar { font-size: 24px; }
          .agent-chat__name { font-weight: 700; font-size: 14px; }
          .agent-chat__role { font-size: 11px; color: #64748b; margin-top: 2px; }
          .agent-chat__actions { display: flex; gap: 6px; }
          .agent-chat__btn {
            background: rgba(51,65,85,0.5); color: #e2e8f0; border: 1px solid rgba(100,116,139,0.4);
            border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer;
          }
          .agent-chat__btn:hover { background: rgba(51,65,85,0.8); }
          .agent-chat__btn--close { font-size: 16px; padding: 2px 8px; }
          .agent-chat__body { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
          .agent-chat__empty { color: #64748b; text-align: center; margin-top: 40px; font-size: 13px; line-height: 1.7; }
          .agent-chat__msg {
            max-width: 85%; padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5;
            white-space: pre-wrap; word-break: break-word;
          }
          .agent-chat__msg--user {
            align-self: flex-end; background: rgba(56,189,248,0.2);
            border: 1px solid rgba(56,189,248,0.35); color: #e0f2fe;
          }
          .agent-chat__msg--agent {
            align-self: flex-start; background: rgba(51,65,85,0.4);
            border: 1px solid rgba(100,116,139,0.3); color: #e2e8f0;
          }
          .agent-chat__msg--error {
            align-self: center; background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.3); color: #fca5a5;
          }
          .agent-chat__input-wrap {
            display: flex; gap: 8px; padding: 12px 18px;
            border-top: 1px solid rgba(51,65,85,0.6);
          }
          .agent-chat__input {
            flex: 1; background: rgba(30,41,59,0.8); border: 1px solid rgba(71,85,105,0.5);
            border-radius: 8px; color: #e2e8f0; font-size: 13px; padding: 8px 10px;
            resize: none; font-family: inherit;
          }
          .agent-chat__input:focus { outline: none; border-color: rgba(56,189,248,0.5); }
          .agent-chat__send {
            background: rgba(56,189,248,0.25); border: 1px solid rgba(56,189,248,0.4);
            color: #e0f2fe; border-radius: 8px; padding: 0 16px; font-size: 13px;
            cursor: pointer; white-space: nowrap;
          }
          .agent-chat__send:disabled { opacity: 0.4; cursor: not-allowed; }
        `}</style>
      </div>
    </div>
  );
}
