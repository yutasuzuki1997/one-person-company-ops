import { useState, useEffect, useRef } from 'react';

function MessageBubble({ msg, onJdApprove, onJdReject, onMergeApprove }) {
  const isUser = msg.role === 'user';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '88%',
        background: isUser
          ? 'rgba(255,255,255,0.08)'
          : 'rgba(56,189,248,0.06)',
        border: `1px solid ${isUser ? 'rgba(255,255,255,0.12)' : 'rgba(56,189,248,0.18)'}`,
        borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        padding: '10px 14px',
        color: '#e2e8f0',
        fontSize: 13,
        lineHeight: 1.6,
      }}>
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>

        {/* Delegation badges */}
        {msg.delegations && msg.delegations.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {msg.delegations.map((d, i) => (
              <div key={i} style={{
                background: 'rgba(56,189,248,0.1)',
                border: '1px solid rgba(56,189,248,0.25)',
                borderRadius: 6, padding: '4px 8px',
                fontSize: 11, color: '#38bdf8', marginTop: 4,
              }}>
                → {d.agentName || d.agentId}に委譲：{d.task}
              </div>
            ))}
          </div>
        )}

        {/* JD proposals */}
        {msg.jdProposals && msg.jdProposals.map((jd, i) => (
          <div key={i} style={{
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 8, padding: '8px 10px', marginTop: 8,
          }}>
            <div style={{ color: '#fbbf24', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
              📋 {jd.agentName}のJD更新提案
            </div>
            <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
              {jd.proposedJd}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => onJdApprove(jd.agentId)}
                style={{
                  background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)',
                  color: '#22c55e', borderRadius: 6, padding: '3px 10px',
                  fontSize: 11, cursor: 'pointer',
                }}
              >承認</button>
              <button
                onClick={() => onJdReject(jd.agentId)}
                style={{
                  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                  color: '#ef4444', borderRadius: 6, padding: '3px 10px',
                  fontSize: 11, cursor: 'pointer',
                }}
              >却下</button>
            </div>
          </div>
        ))}

        {/* PR created */}
        {msg.prCreated && (
          <div style={{
            background: 'rgba(139,92,246,0.08)',
            border: '1px solid rgba(139,92,246,0.25)',
            borderRadius: 8, padding: '8px 10px', marginTop: 8,
          }}>
            <div style={{ color: '#a78bfa', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
              🔀 PR作成：{msg.prCreated.title}
            </div>
            <button
              onClick={() => onMergeApprove(msg.prCreated)}
              style={{
                background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)',
                color: '#a78bfa', borderRadius: 6, padding: '3px 10px',
                fontSize: 11, cursor: 'pointer',
              }}
            >マージ承認</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SecretaryChat({ companyId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // 履歴読み込み
  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/secretary/history?companyId=${companyId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch(() => {});
  }, [companyId]);

  // 自動スクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleJdApprove = async (agentId) => {
    await fetch(`/api/agents/${agentId}/jd-approve`, { method: 'POST' });
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        jdProposals: m.jdProposals?.filter((j) => j.agentId !== agentId),
      }))
    );
  };

  const handleJdReject = async (agentId) => {
    await fetch(`/api/agents/${agentId}/jd-reject`, { method: 'POST' });
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        jdProposals: m.jdProposals?.filter((j) => j.agentId !== agentId),
      }))
    );
  };

  const handleMergeApprove = (prInfo) => {
    sendMessage(
      `${prInfo.owner}/${prInfo.repo} のPR #${prInfo.pullNumber}「${prInfo.title}」をマージしてください`
    );
  };

  const sendMessage = async (overrideText) => {
    const content = (overrideText !== undefined ? overrideText : input).trim();
    if (!content || sending) return;
    if (!overrideText) setInput('');
    setSending(true);

    const userMsg = {
      id: 'msg-' + Date.now(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      delegations: [],
    };
    setMessages((prev) => [...prev, userMsg]);

    let accumulatedContent = '';
    const delegations = [];
    const jdProposals = [];
    let prCreated = null;

    try {
      const resp = await fetch('/api/secretary/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content, companyId }),
      });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'token') {
              accumulatedContent += event.content;
              setStreamingContent(accumulatedContent);
            } else if (event.type === 'delegation') {
              delegations.push({
                agentId: event.agentId,
                agentName: event.agentName,
                task: event.task,
              });
            } else if (event.type === 'jd_proposal') {
              jdProposals.push({
                agentId: event.agentId,
                agentName: event.agentName,
                proposedJd: event.proposedJd,
              });
            } else if (event.type === 'pr_created') {
              prCreated = {
                owner: event.owner,
                repo: event.repo,
                pullNumber: event.pullNumber,
                title: event.title,
              };
            }
          } catch {}
        }
      }
    } catch (e) {
      console.error(e);
    }

    setStreamingContent('');
    setSending(false);

    const secretaryMsg = {
      id: 'msg-' + (Date.now() + 1),
      role: 'secretary',
      content: accumulatedContent,
      timestamp: new Date().toISOString(),
      delegations,
      jdProposals: jdProposals.length > 0 ? jdProposals : undefined,
      prCreated,
    };
    setMessages((prev) => [...prev, secretaryMsg]);
  };

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(200, Math.max(80, el.scrollHeight)) + 'px';
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'rgba(6,8,16,0.75)', backdropFilter: 'blur(12px)',
      borderLeft: '1px solid rgba(51,65,85,0.45)',
    }}>
      {/* タイトル */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid rgba(51,65,85,0.45)',
        fontSize: 14, fontWeight: 700, color: '#7dd3fc',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        📋 Secretary
      </div>

      {/* チャット履歴 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onJdApprove={handleJdApprove}
            onJdReject={handleJdReject}
            onMergeApprove={handleMergeApprove}
          />
        ))}

        {/* ストリーミング中のメッセージ */}
        {streamingContent && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
            <div style={{
              maxWidth: '88%',
              background: 'rgba(56,189,248,0.06)',
              border: '1px solid rgba(56,189,248,0.18)',
              borderRadius: '12px 12px 12px 2px',
              padding: '10px 14px',
              color: '#e2e8f0', fontSize: 13, lineHeight: 1.6,
            }}>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{streamingContent}</div>
              <span style={{
                display: 'inline-block', width: 6, height: 13,
                background: '#38bdf8', marginLeft: 2, verticalAlign: 'middle',
                animation: 'blink-cur 0.8s ease-in-out infinite',
              }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 入力エリア */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid rgba(51,65,85,0.45)',
        background: 'rgba(13,20,36,0.5)', flexShrink: 0,
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="秘書に指示する（Cmd+Enter で送信）"
          rows={3}
          style={{
            width: '100%', minHeight: 80, maxHeight: 200, resize: 'none',
            background: 'rgba(15,23,42,0.8)',
            border: '1px solid rgba(51,65,85,0.55)',
            borderRadius: 8, padding: '8px 12px', color: '#e2e8f0',
            fontSize: 13, outline: 'none', fontFamily: 'inherit',
            lineHeight: 1.5, boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            onClick={() => sendMessage()}
            disabled={sending || !input.trim()}
            style={{
              background: sending || !input.trim() ? '#1e293b' : '#38bdf8',
              border: 'none', borderRadius: 8, padding: '7px 18px',
              color: sending || !input.trim() ? '#475569' : '#0c1a2e',
              fontWeight: 700, fontSize: 12,
              cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 7,
            }}
          >
            {sending ? (
              <>
                <span style={{
                  width: 11, height: 11,
                  border: '2px solid #334155', borderTopColor: '#94a3b8',
                  borderRadius: '50%', display: 'inline-block',
                  animation: 'spin-s 0.8s linear infinite',
                }} />
                送信中
              </>
            ) : '送信'}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blink-cur {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes spin-s {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
