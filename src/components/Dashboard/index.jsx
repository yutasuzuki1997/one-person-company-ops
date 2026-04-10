import { useState, useEffect, useRef, useCallback } from 'react';
import './Dashboard.css';
import Background from './Background';
import SecretaryPanel from './SecretaryPanel';
import AgentPanel from './AgentPanel';
import AgentDetailModal from './AgentDetailModal';
import AgentChat from './AgentChat';

// ###DELEGATE等の制御ブロックを除去してdisplay用テキストにする
function stripControlBlocks(text) {
  return text
    .replace(/###DELEGATE[^#]*###/g, '')
    .replace(/###COMPLETED[^#]*###/g, '')
    .replace(/###PROGRESS[^#]*###/g, '')
    .replace(/###IDLE[^#]*###/g, '')
    .replace(/###WAITING[^#]*###/g, '')
    .replace(/###PR_REQUEST[^#]*###/g, '')
    .replace(/###PR_MERGE[^#]*###/g, '')
    .split('\n')
    .filter((l) => !l.startsWith('###'))
    .join('\n')
    .trim();
}

// Markdown記号を除去
function stripMarkdown(text) {
  return (text || '').replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/`/g, '').trim();
}

function formatTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs > 0 ? rs + 's' : ''}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm > 0 ? rm + 'm' : ''}`;
}

function ElapsedTime({ since, style }) {
  const [elapsed, setElapsed] = useState(() => since ? Date.now() - new Date(since).getTime() : 0);
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setElapsed(Date.now() - new Date(since).getTime()), 1000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return null;
  return <span style={style}>{formatElapsed(elapsed)}</span>;
}

// チャットバブルを生成
function buildBubbles(messages) {
  const bubbles = [];
  for (const msg of messages) {
    const ts = formatTimestamp(msg.timestamp || Date.now());
    if (msg.role === 'user') {
      bubbles.push({ type: 'user', ts, text: msg.content });
    } else if (msg.role === 'secretary') {
      const clean = stripControlBlocks(msg.content);
      if (clean) bubbles.push({ type: 'secretary', ts, text: clean });
      // DELEGATEブロック（agent IDのみの場合は非表示）
      const delegateRe = /###DELEGATE\s+agentId="([^"]+)"\s+task="([^"]+)"[^#]*###/g;
      let m;
      while ((m = delegateRe.exec(msg.content)) !== null) {
        // agent IDのみの場合は非表示（displayName付きのdelegationsで表示される）
        if (/^agent-\d+$/.test(m[1])) continue;
        bubbles.push({ type: 'delegate', ts, agentId: m[1], text: m[2] });
      }
      if (msg.delegations?.length) {
        // DELEGATEブロックで既に出したagentIdと重複しない委託のみ表示
        const alreadyDelegated = new Set();
        const delegateRe2 = /###DELEGATE\s+agentId="([^"]+)"/g;
        let mm;
        while ((mm = delegateRe2.exec(msg.content)) !== null) alreadyDelegated.add(mm[1]);
        msg.delegations.forEach((d) => {
          // agent IDのみ（displayNameなし）の場合は非表示
          if (!d.agentName || /^agent-\d+$/.test(d.agentName)) return;
          // DELEGATEブロックと重複する場合は非表示
          if (alreadyDelegated.has(d.agentId)) return;
          bubbles.push({ type: 'delegate', ts, agentName: d.agentName, text: d.task });
        });
      }
    } else if (msg.role === 'direct') {
      bubbles.push({ type: 'direct', ts, agentName: msg.agentName, text: msg.content });
    } else if (msg.role === 'confirm') {
      bubbles.push({
        type: 'confirm',
        ts,
        pendingId: msg.pendingId,
        agentName: msg.agentName,
        action: msg.action,
        destinationName: msg.destinationName,
        destinationPath: msg.destinationPath,
        summary: msg.summary,
        resolved: msg.resolved,
        approved: msg.approved,
      });
    } else if (msg.role === 'agent') {
      bubbles.push({ type: 'agent', ts, agentId: msg.agentId, agentName: msg.agentName, agentAvatar: msg.agentAvatar, text: msg.content });
    } else if (msg.role === 'error') {
      bubbles.push({ type: 'error', ts, text: msg.content });
    } else if (msg.type === 'save') {
      bubbles.push({ type: 'save', ts, text: msg.content, url: msg.url });
    } else if (msg.type === 'warning') {
      bubbles.push({ type: 'warning', ts, text: msg.content });
    }
  }
  return bubbles;
}

// チャットバブルを描画
function ChatBubble({ bubble, onConfirm }) {
  const ts = bubble.ts;

  if (bubble.type === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <div style={{ maxWidth: '70%' }}>
          <div style={{ textAlign: 'right', fontSize: 10, color: '#888', marginBottom: 3 }}>{ts}</div>
          <div style={{
            background: '#1e3a5f',
            borderRadius: '18px 18px 4px 18px',
            padding: '10px 14px',
            color: '#ffffff',
            fontSize: 14,
            lineHeight: 1.55,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}>{bubble.text}</div>
        </div>
      </div>
    );
  }

  if (bubble.type === 'secretary') {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 24, flexShrink: 0, lineHeight: 1 }}>🤖</span>
        <div style={{ maxWidth: '85%' }}>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>
            ジェニー（統括秘書） <span style={{ marginLeft: 4 }}>{ts}</span>
          </div>
          <div style={{
            background: 'rgba(0,255,136,0.06)',
            border: '1px solid rgba(0,255,136,0.2)',
            borderRadius: '3px 18px 18px 18px',
            padding: '10px 14px',
            color: '#d4d4d4',
            fontSize: 14,
            lineHeight: 1.6,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}>{bubble.text}</div>
        </div>
      </div>
    );
  }

  if (bubble.type === 'delegate') {
    return (
      <div style={{
        margin: '6px 0',
        padding: '7px 12px',
        background: 'rgba(251,191,36,0.07)',
        border: '1px solid rgba(251,191,36,0.2)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}>
        <span style={{ color: '#fbbf24', fontSize: 12, flexShrink: 0, marginTop: 1 }}>▶</span>
        <div style={{ flex: 1 }}>
          <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>
            {bubble.agentName || bubble.agentId || 'AGENT'}
          </span>
          <span style={{ color: '#94a3b8', fontSize: 11 }}> に委託</span>
          <div style={{ color: '#d4d4d4', fontSize: 12, marginTop: 2 }}>{bubble.text}</div>
        </div>
        <span style={{ color: '#334155', fontSize: 10, flexShrink: 0, marginTop: 1 }}>{ts}</span>
      </div>
    );
  }

  if (bubble.type === 'direct') {
    return (
      <div style={{
        margin: '6px 0',
        padding: '7px 12px',
        background: 'rgba(244,114,182,0.07)',
        border: '1px solid rgba(244,114,182,0.2)',
        borderRadius: 8,
      }}>
        <div style={{ fontSize: 11, color: '#f472b6', marginBottom: 3, fontWeight: 700 }}>
          直接指示 → {bubble.agentName} <span style={{ color: '#334155', fontWeight: 400 }}>{ts}</span>
        </div>
        <div style={{ color: '#d4d4d4', fontSize: 12, whiteSpace: 'pre-wrap' }}>{bubble.text}</div>
      </div>
    );
  }

  if (bubble.type === 'confirm') {
    const isResolved = bubble.resolved;
    return (
      <div style={{
        margin: '8px 0',
        padding: '10px 13px',
        background: isResolved
          ? (bubble.approved ? 'rgba(0,255,136,0.05)' : 'rgba(71,85,105,0.1)')
          : 'rgba(239,68,68,0.07)',
        border: `1px solid ${isResolved ? (bubble.approved ? 'rgba(0,255,136,0.2)' : 'rgba(71,85,105,0.3)') : 'rgba(239,68,68,0.3)'}`,
        borderRadius: 10,
      }}>
        <div style={{ fontSize: 11, color: isResolved ? '#475569' : '#ef4444', marginBottom: 6, fontWeight: 700 }}>
          {isResolved ? (bubble.approved ? '✅ 承認済み' : '❌ 却下済み') : '⚠️ 確認が必要です'}
          <span style={{ color: '#334155', fontWeight: 400, marginLeft: 6 }}>{ts}</span>
        </div>
        <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 4 }}>{bubble.summary}</div>
        {bubble.destinationName && (
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
            {bubble.destinationName}{bubble.destinationPath ? ` / ${bubble.destinationPath}` : ''}
          </div>
        )}
        {!isResolved && onConfirm && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onConfirm(bubble.pendingId, true)}
              style={{
                background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.35)',
                color: '#00ff88', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontWeight: 700,
              }}
            >✓ 承認</button>
            <button
              onClick={() => onConfirm(bubble.pendingId, false)}
              style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)',
                color: '#ef4444', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer',
              }}
            >✕ 却下</button>
          </div>
        )}
      </div>
    );
  }

  if (bubble.type === 'agent') {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1.2 }}>{bubble.agentAvatar || '🤖'}</span>
        <div style={{ maxWidth: '80%' }}>
          <div style={{ fontSize: 10, color: '#aaaaff', marginBottom: 3 }}>
            {bubble.agentName || 'エージェント'} <span style={{ marginLeft: 4 }}>{ts}</span>
          </div>
          <div style={{
            background: '#1a1a2e',
            borderRadius: '3px 18px 18px 18px',
            padding: '10px 14px',
            color: '#ccccff',
            fontSize: 13,
            lineHeight: 1.5,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}>{bubble.text}</div>
        </div>
      </div>
    );
  }

  if (bubble.type === 'save') {
    return (
      <div style={{ margin: '6px 0', padding: '8px 12px', background: '#0a1a0a', borderRadius: 4 }}>
        <span style={{ color: '#44ff88', fontSize: 13 }}>💾 {bubble.text}</span>
        {bubble.url && (
          <span
            onClick={() => { try { window.electronAPI?.openExternal(bubble.url); } catch { window.open(bubble.url); } }}
            style={{ color: '#44aaff', fontSize: 12, marginLeft: 8, cursor: 'pointer', textDecoration: 'underline' }}
          >リンクを開く</span>
        )}
      </div>
    );
  }

  if (bubble.type === 'warning') {
    return (
      <div style={{ margin: '6px 0', padding: '8px 12px', background: '#1a1500', borderRadius: 4 }}>
        <span style={{ color: '#ffaa00', fontSize: 13 }}>⚠️ {bubble.text}</span>
        <span style={{ color: '#334155', fontSize: 10, marginLeft: 6 }}>{ts}</span>
      </div>
    );
  }

  if (bubble.type === 'error') {
    return (
      <div style={{
        margin: '6px 0', padding: '8px 12px',
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: 8, color: '#fca5a5', fontSize: 12,
      }}>
        <span style={{ fontWeight: 700 }}>エラー: </span>{bubble.text}
        <span style={{ color: '#334155', marginLeft: 6 }}>{ts}</span>
      </div>
    );
  }

  return null;
}

// タスクターミナル（中央エリア）
function TaskTerminal({ task, streamContent, agents, onConfirm, onSendMessage, isSending, selectedTaskId }) {
  const bottomRef = useRef(null);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [task?.messages, streamContent]);

  if (!task) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#1e293b',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.3 }}>💬</div>
        <div style={{ fontSize: 14, color: '#334155', marginBottom: 6 }}>タスクを選択してください</div>
        <div style={{ fontSize: 12, color: '#1e293b' }}>左パネルから指示を送るか、既存タスクを選択してください</div>
      </div>
    );
  }

  const bubbles = buildBubbles(task.messages || []);
  const workingAgents = agents.filter((a) => a.status === 'working');
  const isWaiting = task.status === 'waiting';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ヘッダー */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid rgba(51,65,85,0.3)',
        background: 'rgba(6,13,26,0.7)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{task.name}</span>
          <ProjectBadge name={task.name} />
          <TaskStatusBadge status={task.status} />
        </div>

        {/* 経過時間表示 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isWaiting ? 8 : 0 }}>
          <span style={{ fontSize: 10, color: '#475569', flex: 1 }}>
            {workingAgents.length > 0 ? workingAgents.map((a) => a.displayName || a.name).join(', ') + ' が作業中' : (task.status === 'working' ? '処理中...' : '')}
          </span>
          {task.startedAt && (task.status === 'working' || task.status === 'waiting') && (
            <ElapsedTime
              since={task.startedAt}
              style={{ fontSize: 10, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}
            />
          )}
        </div>

        {/* waitingバナー */}
        {isWaiting && (
          <div style={{
            marginTop: 8,
            padding: '6px 10px',
            background: 'rgba(251,191,36,0.1)',
            border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: 7,
            fontSize: 12,
            color: '#fbbf24',
            fontWeight: 600,
            animation: 'blink-waiting 1.5s ease-in-out infinite',
          }}>
            💬 ジェニーがあなたの返答を待っています
          </div>
        )}
      </div>

      {/* チャットエリア */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 24px',
        background: 'rgba(6,10,18,0.6)',
        maxWidth: '100%', width: '100%', boxSizing: 'border-box',
      }}>
        {bubbles.length === 0 && !streamContent && (
          <div style={{ color: '#1e3a2a', fontSize: 12, textAlign: 'center', marginTop: 32 }}>
            まだメッセージがありません
          </div>
        )}

        {bubbles.map((bubble, i) => (
          <ChatBubble key={i} bubble={bubble} onConfirm={onConfirm} />
        ))}

        {/* ストリーミング中のライブ表示 */}
        {streamContent && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 24, flexShrink: 0, lineHeight: 1 }}>🤖</span>
            <div style={{ maxWidth: '85%' }}>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>
                ジェニー（統括秘書） <span style={{ marginLeft: 4 }}>{formatTimestamp(new Date())}</span>
              </div>
              <div style={{
                background: 'rgba(0,255,136,0.06)',
                border: '1px solid rgba(0,255,136,0.2)',
                borderRadius: '3px 18px 18px 18px',
                padding: '10px 14px',
                color: '#d4d4d4',
                fontSize: 14,
                lineHeight: 1.6,
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}>
                {stripControlBlocks(streamContent)}
                <span style={{
                  display: 'inline-block', width: 7, height: 13,
                  background: '#00ff88', marginLeft: 2, verticalAlign: 'middle',
                  animation: 'blink-cur 0.7s ease-in-out infinite',
                }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── 入力エリア（中央下部固定） ── */}
      {task && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.1)',
          padding: '12px 16px',
          background: 'rgba(15,17,23,0.95)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (!inputText.trim() || isSending) return;
                  onSendMessage(inputText.trim(), selectedTaskId);
                  setInputText('');
                }
              }}
              placeholder="ジェニーに指示を送る...（Cmd+Enterで送信）"
              style={{
                flex: 1,
                background: '#1a1f2e',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 12,
                color: 'white',
                fontSize: 14,
                padding: '10px 14px',
                resize: 'none',
                minHeight: 48,
                maxHeight: 200,
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.5,
                boxSizing: 'border-box',
              }}
              rows={1}
            />
            <button
              onClick={() => {
                if (!inputText.trim() || isSending) return;
                onSendMessage(inputText.trim(), selectedTaskId);
                setInputText('');
              }}
              disabled={!inputText.trim() || isSending}
              style={{
                background: inputText.trim() && !isSending ? '#2a5caa' : '#333',
                color: 'white',
                border: 'none',
                borderRadius: 12,
                padding: '10px 20px',
                cursor: inputText.trim() && !isSending ? 'pointer' : 'default',
                fontSize: 14,
                flexShrink: 0,
                height: 48,
              }}
            >
              {isSending ? '...' : '送信'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 6, textAlign: 'right' }}>
            Cmd+Enter で送信
          </div>
        </div>
      )}
    </div>
  );
}

// ジェニーチャットビュー（タスクとは別の会話画面）
function JennyChatView({ messages, streamContent, onSendMessage, isSending }) {
  const bottomRef = useRef(null);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  const bubbles = buildBubbles(messages);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ヘッダー */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid rgba(51,65,85,0.3)',
        background: 'rgba(6,13,26,0.7)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🤖</span>
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>ジェニー</span>
            <span style={{ fontSize: 11, color: '#475569', marginLeft: 8 }}>統括秘書</span>
          </div>
          <span style={{ color: '#22c55e', fontSize: 8, marginLeft: 4 }}>●</span>
        </div>
      </div>

      {/* チャットエリア */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 24px',
        background: 'rgba(6,10,18,0.6)',
      }}>
        {bubbles.length === 0 && !streamContent && (
          <div style={{ color: '#1e3a2a', fontSize: 12, textAlign: 'center', marginTop: 32 }}>
            ジェニーに何でも聞いてください
          </div>
        )}

        {bubbles.map((bubble, i) => (
          <ChatBubble key={i} bubble={bubble} />
        ))}

        {streamContent && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 24, flexShrink: 0, lineHeight: 1 }}>🤖</span>
            <div style={{ maxWidth: '85%' }}>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>
                ジェニー <span style={{ marginLeft: 4 }}>{formatTimestamp(new Date())}</span>
              </div>
              <div style={{
                background: 'rgba(0,255,136,0.06)',
                border: '1px solid rgba(0,255,136,0.2)',
                borderRadius: '3px 18px 18px 18px',
                padding: '10px 14px',
                color: '#d4d4d4',
                fontSize: 14,
                lineHeight: 1.6,
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}>
                {stripControlBlocks(streamContent)}
                <span style={{
                  display: 'inline-block', width: 7, height: 13,
                  background: '#00ff88', marginLeft: 2, verticalAlign: 'middle',
                  animation: 'blink-cur 0.7s ease-in-out infinite',
                }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 入力エリア */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '12px 16px',
        background: 'rgba(15,17,23,0.95)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                if (!inputText.trim() || isSending) return;
                onSendMessage(inputText.trim());
                setInputText('');
              }
            }}
            placeholder="ジェニーに指示を送る...（Cmd+Enterで送信）"
            style={{
              flex: 1, background: '#1a1f2e',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 12, color: 'white', fontSize: 14,
              padding: '10px 14px', resize: 'none',
              minHeight: 48, maxHeight: 200, outline: 'none',
              fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box',
            }}
            rows={1}
          />
          <button
            onClick={() => {
              if (!inputText.trim() || isSending) return;
              onSendMessage(inputText.trim());
              setInputText('');
            }}
            disabled={!inputText.trim() || isSending}
            style={{
              background: inputText.trim() && !isSending ? '#2a5caa' : '#333',
              color: 'white', border: 'none', borderRadius: 12,
              padding: '10px 20px', cursor: inputText.trim() && !isSending ? 'pointer' : 'default',
              fontSize: 14, flexShrink: 0, height: 48,
            }}
          >
            {isSending ? '...' : '送信'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#555', marginTop: 6, textAlign: 'right' }}>
          Cmd+Enter で送信
        </div>
      </div>
    </div>
  );
}

// プロジェクト判定
function detectProjectName(taskName) {
  const name = (taskName || '').toLowerCase();
  if (/wavers/.test(name)) return 'WAVERS';
  if (/あげファンズ/.test(name)) return 'あげファンズ';
  if (/noborder/.test(name)) return 'NoBorder';
  if (/rvc|rvalue/.test(name)) return 'RVC';
  if (/backstage/.test(name)) return 'BACKSTAGE';
  if (/overdue/.test(name)) return 'Overdue.';
  if (/bizsim/.test(name)) return 'BizSim';
  if (/jiggy|jazz|orchestra/.test(name)) return 'JIGGY BEATS';
  if (/band.?os/.test(name)) return 'band-os';
  if (/kos/.test(name)) return 'KOS';
  if (/onecompany/.test(name)) return 'OCO';
  return null;
}

function ProjectBadge({ name }) {
  const project = detectProjectName(name);
  if (!project) return null;
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 4,
      background: 'rgba(99,102,241,0.15)', color: '#818cf8',
      fontWeight: 600, whiteSpace: 'nowrap',
    }}>{project}</span>
  );
}

// タスクステータスバッジ（タスクレベル用）
function TaskStatusBadge({ status }) {
  const map = {
    active:   { label: '進行中',   cls: 'working' },
    working:  { label: '進行中',   cls: 'working' },
    review:   { label: '確認待ち', cls: 'review' },
    waiting:  { label: '承認待ち', cls: 'waiting' },
    done:     { label: '完了',     cls: 'idle' },
  };
  const { label, cls } = map[status] || { label: '進行中', cls: 'working' };
  return (
    <span className={`status-badge status-badge--${cls}`}>
      <span className={`status-dot status-dot--${cls}`} />
      {label}
    </span>
  );
}

// エージェントステータスバッジ（エージェントレベル用）
const STATUS_LABELS = {
  idle: '待機中', working: '作業中', review: 'FB依頼あり',
  waiting: '承認待ち', error: 'エラー', completed: 'FB依頼あり', pending: '待機中',
  preparing: '準備中',
};

function StatusBadge({ status, lastActiveAt, currentTask }) {
  let s = status || 'pending';

  // working かつ currentTask が空 → 準備中
  if (s === 'working' && !currentTask) s = 'preparing';

  const now = Date.now();
  const lastActive = lastActiveAt ? new Date(lastActiveAt).getTime() : null;
  const minutesSinceActive = lastActive ? (now - lastActive) / 60000 : null;

  let warning = null;
  if (s === 'working' && minutesSinceActive !== null && minutesSinceActive > 30) {
    warning = '⚠️ 長時間更新なし';
  }

  return (
    <span className={`status-badge status-badge--${s}`}>
      <span className={`status-dot status-dot--${s}`} />
      {STATUS_LABELS[s] || s}
      {warning && <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.8 }}>{warning}</span>}
    </span>
  );
}

export default function Dashboard({ onNavigate }) {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [agents, setAgents] = useState([]);
  const wsRef = useRef(null);

  // タスク管理
  const [tasks, setTasks] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const selectedTaskIdRef = useRef(selectedTaskId);
  useEffect(() => { selectedTaskIdRef.current = selectedTaskId; }, [selectedTaskId]);
  const [isSending, setIsSending] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [secretaryStatus, setSecretaryStatus] = useState('idle');
  // agent_completed 通知バナー
  const [completionBanner, setCompletionBanner] = useState(null);

  // ジェニーチャット（タスクとは別の会話）
  const [jennySelected, setJennySelected] = useState(false);
  const [jennyMessages, setJennyMessages] = useState([]);

  // ジェニー会話履歴をAPIから復元
  useEffect(() => {
    fetch('/api/jenny/conversation')
      .then((r) => r.json())
      .then((msgs) => { if (Array.isArray(msgs)) setJennyMessages(msgs); })
      .catch(() => {});
  }, []);

  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentChatOpen, setAgentChatOpen] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  // stream_start/stream_end で管理するアクティブエージェントSet
  const [activeAgents, setActiveAgents] = useState(new Set());

  // タスク一覧をAPIから復元（起動時）
  useEffect(() => {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((list) => {
        if (!Array.isArray(list) || list.length === 0) return;
        setTasks(list);
        // 最後に開いていたタスクを自動選択
        const lastId = localStorage.getItem('lastTaskId');
        if (lastId && list.some((t) => t.id === lastId)) {
          setSelectedTaskId(lastId);
        } else {
          setSelectedTaskId(list[list.length - 1].id);
        }
      })
      .catch(() => {});
  }, []);

  // 選択中タスクIDをlocalStorageに保存
  useEffect(() => {
    if (selectedTaskId) localStorage.setItem('lastTaskId', selectedTaskId);
  }, [selectedTaskId]);

  // 30秒ごとにタスク一覧をリフレッシュ（ステータス同期）
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/tasks')
        .then((r) => r.json())
        .then((list) => {
          if (!Array.isArray(list)) return;
          setTasks((prev) => {
            // サーバーのデータでステータス・メッセージを更新（ローカルのみの変更は保持）
            const serverMap = new Map(list.map(t => [t.id, t]));
            const merged = prev.map(t => {
              const s = serverMap.get(t.id);
              if (!s) return t;
              return { ...t, status: s.status, messages: s.messages, progress: s.progress, lastMessage: s.lastMessage };
            });
            // サーバーに新しいタスクがあれば追加
            for (const s of list) {
              if (!merged.some(t => t.id === s.id)) merged.push(s);
            }
            return merged;
          });
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // 会社一覧取得
  useEffect(() => {
    fetch('/api/companies')
      .then((r) => r.json())
      .then((list) => {
        if (!Array.isArray(list)) return;
        setCompanies(list);
        if (list.length > 0) setCompanyId((prev) => prev || list[0].id);
      })
      .catch(() => {});
  }, []);

  // エージェント取得
  const loadAgents = useCallback((cid) => {
    if (!cid) return;
    fetch(`/api/companies/${cid}/agents`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAgents(data); })
      .catch(() => {});
  }, []);

  useEffect(() => { loadAgents(companyId); }, [companyId, loadAgents]);

  // WebSocket
  useEffect(() => {
    if (!companyId) return;
    if (wsRef.current) wsRef.current.close();

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsHost = (import.meta.env.DEV && location.port === '5173')
      ? `${location.hostname}:3000` : location.host;
    const ws = new WebSocket(`${proto}://${wsHost}?companyId=${companyId}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'agents') {
        setAgents(msg.agents || []);
      } else if (msg.type === 'agent_status') {
        setAgents((prev) => prev.map((a) =>
          a.id === msg.agentId ? {
            ...a,
            status: msg.status ?? a.status,
            progress: msg.progress ?? a.progress,
            estimatedMinutes: msg.estimatedMinutes !== undefined ? msg.estimatedMinutes : a.estimatedMinutes,
            currentTask: msg.currentTask ?? a.currentTask,
            lastMessage: msg.lastMessage ?? a.lastMessage,
            lastActiveAt: msg.lastActiveAt ?? a.lastActiveAt,
          } : a
        ));
        // タスク-エージェント同期：assignedAgentIdが一致するタスクのステータスを連動
        if (msg.taskId && msg.status === 'working') {
          setTasks((prev) => prev.map((t) =>
            t.id === msg.taskId && t.status !== 'review' ? { ...t, status: 'active' } : t
          ));
        }
      } else if (msg.type === 'jd_proposal') {
        setAgents((prev) => prev.map((a) =>
          a.id === msg.agentId ? { ...a, pendingJdUpdate: msg.proposedJd } : a
        ));
      } else if (msg.type === 'agents_reloaded') {
        loadAgents(companyId);
      } else if (msg.type === 'stream_start') {
        if (msg.agentId) {
          setActiveAgents((prev) => { const n = new Set(prev); n.add(msg.agentId); return n; });
        }
      } else if (msg.type === 'stream_end') {
        if (msg.agentId) {
          setActiveAgents((prev) => { const n = new Set(prev); n.delete(msg.agentId); return n; });
        }
      } else if (msg.type === 'agent_progress' && msg.message) {
        // エージェントのリアルタイム発言をチャットに追加
        const agentMsg = {
          id: 'agent-msg-' + Date.now(),
          role: 'agent',
          content: msg.message,
          agentId: msg.agentId,
          agentName: msg.agentName,
          agentAvatar: msg.agentAvatar || '🤖',
          timestamp: new Date().toISOString(),
        };
        setTasks((prev) => {
          const target = prev.find((t) => t.status === 'working') || prev[prev.length - 1];
          if (!target) return prev;
          const updated = prev.map((t) =>
            t.id === target.id ? { ...t, messages: [...(t.messages || []), agentMsg] } : t
          );
          fetch(`/api/tasks/${target.id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(agentMsg),
          }).catch(() => {});
          return updated;
        });
        // 直接報告の場合は通知バナー
        if (msg.isDirect) {
          setCompletionBanner(`🔔 ${msg.agentName}から直接報告が届きました`);
          setTimeout(() => setCompletionBanner(null), 5000);
        }
      } else if (msg.type === 'agent_completed') {
        console.log('[WS] agent_completed受信:', msg.agentName, 'taskId:', msg.taskId);
        if (msg.message) {
          const newMsg = {
            id: `agent-complete-${Date.now()}`,
            role: 'agent',
            content: msg.message,
            agentId: msg.agentId,
            agentName: msg.agentName,
            agentAvatar: msg.agentAvatar || '🤖',
            timestamp: new Date().toISOString()
          };
          // taskIdが一致するタスクに追加し、ステータスをreviewに変更
          setTasks(prev => {
            const targetTask = prev.find(t => t.id === msg.taskId);
            if (targetTask) {
              return prev.map(task => {
                if (task.id !== msg.taskId) return task;
                return { ...task, messages: [...(task.messages || []), newMsg], status: 'review' };
              });
            }
            // taskIdが見つからない場合はselectedTaskIdのタスクに追加
            return prev.map(task => {
              if (task.id !== selectedTaskIdRef?.current) return task;
              return { ...task, messages: [...(task.messages || []), newMsg], status: 'review' };
            });
          });
          // 通知バナー
          setCompletionBanner({
            message: `✅ ${msg.agentName || 'エージェント'}が完了しました`,
            taskId: msg.taskId
          });
          setTimeout(() => setCompletionBanner(null), 8000);
        }
      } else if (msg.type === 'routine_started') {
        console.log(`[routine] Started: ${msg.routineName}`);
      } else if (msg.type === 'routine_completed') {
        console.log(`[routine] Completed: ${msg.routineId}`);
      } else if (msg.type === 'secretary_typing') {
        // 自律タイマーからのメッセージ開始
        const autoTaskId = 'auto-task-' + Date.now();
        const autoTask = {
          id: autoTaskId,
          name: '自律チェック',
          status: 'working',
          progress: 0,
          startedAt: new Date().toISOString(),
          messages: [{ id: 'msg-' + Date.now(), role: 'user', content: msg.text, timestamp: new Date().toISOString() }],
          lastMessage: msg.text?.slice(0, 40) || '',
          _autoTaskId: autoTaskId,
        };
        setTasks((prev) => [...prev, autoTask]);
        setSelectedTaskId(autoTaskId);
        setStreamContent('');
        wsRef.current._pendingAutoTaskId = autoTaskId;
      } else if (msg.type === 'secretary_token') {
        setStreamContent((prev) => (prev || '') + (msg.content || ''));
      } else if (msg.type === 'secretary_done') {
        const autoTaskId = wsRef.current?._pendingAutoTaskId;
        setStreamContent('');
        if (autoTaskId && msg.content) {
          const secretaryMsg = {
            id: 'msg-' + Date.now(),
            role: 'secretary',
            content: msg.content,
            delegations: [],
            timestamp: new Date().toISOString(),
          };
          setTasks((prev) => prev.map((t) =>
            t.id === autoTaskId
              ? { ...t, messages: [...t.messages, secretaryMsg], lastMessage: msg.content.slice(0, 50) }
              : t
          ));
          wsRef.current._pendingAutoTaskId = null;
        }
      } else if (msg.type === 'task_created' && msg.task) {
        setTasks((prev) => {
          if (prev.find((t) => t.id === msg.task.id)) return prev;
          return [...prev, msg.task];
        });
        setCompletionBanner({ message: `新しいタスク「${msg.task.name}」を作成しました`, taskId: msg.task.id });
        setTimeout(() => setCompletionBanner(null), 5000);
      } else if (msg.type === 'task_updated' && msg.task) {
        setTasks((prev) => prev.map((t) => t.id === msg.task.id ? { ...t, ...msg.task } : t));
      } else if (msg.type === 'secretary_report' && msg.message) {
        // ジェニーからの能動的報告をタスクに追加
        setTasks((prev) => prev.map((t) => {
          if (t.id !== msg.taskId) return t;
          const newMsg = { id: 'secretary-report-' + Date.now(), role: 'secretary', content: msg.message, timestamp: new Date().toISOString() };
          return { ...t, messages: [...(t.messages || []), newMsg] };
        }));
        setCompletionBanner({ message: '🤖 ジェニーから報告が届きました', taskId: msg.taskId });
        setTimeout(() => setCompletionBanner(null), 5000);
      }
    };

    return () => { ws.onclose = null; ws.close(); };
  }, [companyId, loadAgents]);

  // タスク作成
  const handleCreateTask = useCallback((name) => {
    const id = 'task-' + Date.now();
    const task = { id, name, status: 'pending', progress: 0, messages: [], lastMessage: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setTasks((prev) => [...prev, task]);
    setSelectedTaskId(id);
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    }).catch(() => {});
    return id;
  }, []);

  // 確認アクション（承認/却下）
  const handleConfirm = useCallback(async (pendingId, approved) => {
    try {
      await fetch('/api/action/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId, approved }),
      });
    } catch {}
    setTasks((prev) => prev.map((t) => ({
      ...t,
      messages: t.messages.map((m) =>
        m.role === 'confirm' && m.pendingId === pendingId
          ? { ...m, resolved: true, approved }
          : m
      ),
    })));
  }, []);

  // メッセージ送信
  const handleSendMessage = useCallback(async (text, existingTaskId) => {
    let taskId = existingTaskId;

    if (!taskId) {
      const id = 'task-' + Date.now();
      const now = new Date().toISOString();
      const task = {
        id, name: '新しいタスク', status: 'working', progress: 0,
        startedAt: now, createdAt: now, updatedAt: now,
        messages: [], lastMessage: text.slice(0, 40),
      };
      setTasks((prev) => [...prev, task]);
      setSelectedTaskId(id);
      taskId = id;
      fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      }).catch(() => {});

      // タイトルをバックグラウンドで生成
      fetch('/api/task/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.title) {
            const cleanTitle = stripMarkdown(data.title);
            setTasks((prev) => prev.map((t) =>
              t.id === id ? { ...t, name: cleanTitle } : t
            ));
            fetch(`/api/tasks/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: cleanTitle }),
            }).catch(() => {});
          }
        })
        .catch(() => {
          setTasks((prev) => prev.map((t) =>
            t.id === id && t.name === '新しいタスク'
              ? { ...t, name: text.slice(0, 20) + (text.length > 20 ? '…' : '') }
              : t
          ));
        });
    } else {
      setTasks((prev) => prev.map((t) =>
        t.id === taskId ? { ...t, status: 'working', lastMessage: text.slice(0, 40) } : t
      ));
    }

    const userMsg = { id: 'msg-' + Date.now(), role: 'user', content: text, timestamp: new Date().toISOString() };
    setTasks((prev) => prev.map((t) =>
      t.id === taskId ? { ...t, messages: [...t.messages, userMsg] } : t
    ));
    // ユーザーメッセージをサーバーに保存
    fetch(`/api/tasks/${taskId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userMsg),
    }).catch(() => {});

    setIsSending(true);
    setSecretaryStatus('working');
    setStreamContent('');

    let accumulatedContent = '';
    const delegations = [];
    let taskBecameWaiting = false;

    try {
      const resp = await fetch('/api/secretary/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, companyId }),
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
              setStreamContent(accumulatedContent);
            } else if (event.type === 'delegation') {
              delegations.push({ agentId: event.agentId, agentName: event.agentName, task: event.task });
            } else if (event.type === 'task_waiting') {
              taskBecameWaiting = true;
            } else if (event.type === 'confirm_required') {
              // confirmメッセージをタスクに追加
              const confirmMsg = {
                id: 'msg-' + Date.now() + '-confirm',
                role: 'confirm',
                pendingId: event.pendingId,
                agentId: event.agentId,
                agentName: event.agentName,
                action: event.action,
                destinationName: event.destinationName,
                destinationPath: event.destinationPath,
                summary: event.summary,
                resolved: false,
                timestamp: new Date().toISOString(),
              };
              setTasks((prev) => prev.map((t) =>
                t.id === taskId ? { ...t, messages: [...t.messages, confirmMsg] } : t
              ));
            }
          } catch {}
        }
      }
    } catch (e) {
      console.error(e);
    }

    setStreamContent('');
    setIsSending(false);
    setSecretaryStatus('idle');

    const secretaryMsg = {
      id: 'msg-' + (Date.now() + 1),
      role: 'secretary',
      content: accumulatedContent,
      delegations,
      timestamp: new Date().toISOString(),
    };

    const nextStatus = taskBecameWaiting
      ? 'waiting'
      : delegations.length > 0 ? 'active' : 'active';

    setTasks((prev) => prev.map((t) =>
      t.id === taskId ? {
        ...t,
        messages: [...t.messages, secretaryMsg],
        status: nextStatus,
        lastMessage: stripControlBlocks(accumulatedContent).slice(0, 50),
      } : t
    ));

    // 秘書メッセージをサーバーに保存
    fetch(`/api/tasks/${taskId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(secretaryMsg),
    }).catch(() => {});
    // タスクステータス更新を保存
    fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus, lastMessage: stripControlBlocks(accumulatedContent).slice(0, 50) }),
    }).catch(() => {});
  }, [companyId]);

  // ジェニーチャット送信（タスクとは別の会話）
  const handleJennySendMessage = useCallback(async (text) => {
    const userMsg = { id: 'msg-' + Date.now(), role: 'user', content: text, timestamp: new Date().toISOString() };
    setJennyMessages((prev) => [...prev, userMsg]);

    setIsSending(true);
    setSecretaryStatus('working');
    setStreamContent('');

    let accumulatedContent = '';

    try {
      const resp = await fetch('/api/secretary/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, companyId }),
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
              setStreamContent(accumulatedContent);
            } else if (event.type === 'task_created' && event.task) {
              // heavy/complexはタスクとして生成された → タスクリストに追加
              setTasks((prev) => {
                if (prev.find((t) => t.id === event.task.id)) return prev;
                return [...prev, event.task];
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      console.error(e);
    }

    setStreamContent('');
    setIsSending(false);
    setSecretaryStatus('idle');

    if (accumulatedContent) {
      const secretaryMsg = {
        id: 'msg-' + (Date.now() + 1),
        role: 'secretary',
        content: accumulatedContent,
        timestamp: new Date().toISOString(),
      };
      setJennyMessages((prev) => [...prev, secretaryMsg]);

      // ジェニー会話をサーバーに保存
      fetch('/api/jenny/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [userMsg, secretaryMsg] }),
      }).catch(() => {});
    }
  }, [companyId]);

  // 直接指示（AgentDetailModalから）→ タスクログに記録
  const handleDirectInstruction = useCallback((agentName, text) => {
    if (!selectedTaskId) return;
    const directMsg = {
      id: 'msg-' + Date.now(),
      role: 'direct',
      content: text,
      agentName,
      timestamp: new Date().toISOString(),
    };
    setTasks((prev) => prev.map((t) =>
      t.id === selectedTaskId ? { ...t, messages: [...t.messages, directMsg] } : t
    ));
  }, [selectedTaskId]);

  const handleJdApprove = async (agentId) => {
    await fetch(`/api/agents/${agentId}/jd-approve`, { method: 'POST' });
    setAgents((prev) => prev.map((a) =>
      a.id === agentId ? { ...a, jobDescription: a.pendingJdUpdate, pendingJdUpdate: null } : a
    ));
  };

  const handleJdReject = async (agentId) => {
    await fetch(`/api/agents/${agentId}/jd-reject`, { method: 'POST' });
    setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, pendingJdUpdate: null } : a)));
  };

  // タスク完了（doneに変更、リストには薄く残る）
  const handleArchiveTask = useCallback((taskId) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'done' } : t));
    fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    }).catch(() => {});
  }, []);

  // タスク削除
  const handleDeleteTask = useCallback((taskId) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (selectedTaskId === taskId) setSelectedTaskId(null);
    fetch(`/api/tasks/${taskId}`, { method: 'DELETE' }).catch(() => {});
  }, [selectedTaskId]);

  // タスク名変更
  const handleRenameTask = useCallback((taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const newName = prompt('タスク名を入力', task.name);
    if (newName && newName.trim()) {
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, name: newName.trim() } : t));
      fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      }).catch(() => {});
    }
  }, [tasks]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;

  // 未解決のconfirmを全タスクから集める → AgentPanelに渡す
  const pendingConfirms = tasks.flatMap((t) =>
    (t.messages || [])
      .filter((m) => m.role === 'confirm' && !m.resolved)
      .map((m) => ({ ...m, taskId: t.id, taskName: t.name }))
  );

  return (
    <div className="dashboard-root">
      <Background />

      {/* 左カラム：統括秘書パネル */}
      <SecretaryPanel
        companyId={companyId}
        companies={companies}
        onNavigate={onNavigate}
        onCompanyChange={setCompanyId}
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={(id) => { setSelectedTaskId(id); setJennySelected(false); }}
        onSelectJennyChat={() => { setJennySelected(true); setSelectedTaskId(null); }}
        onCreateTask={handleCreateTask}
        onSendMessage={handleSendMessage}
        onArchiveTask={handleArchiveTask}
        onDeleteTask={handleDeleteTask}
        onRenameTask={handleRenameTask}
        isSending={isSending}
        secretaryStatus={secretaryStatus}
        jennySelected={jennySelected}
      />

      {/* 中央カラム：チャット */}
      <div className="dashboard-center" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {jennySelected ? (
          <JennyChatView
            messages={jennyMessages}
            streamContent={streamContent}
            onSendMessage={handleJennySendMessage}
            isSending={isSending}
          />
        ) : (
          <TaskTerminal
            task={selectedTask}
            streamContent={selectedTaskId === selectedTask?.id ? streamContent : ''}
            agents={agents}
            onConfirm={handleConfirm}
            onSendMessage={handleSendMessage}
            isSending={isSending}
            selectedTaskId={selectedTaskId}
          />
        )}
      </div>

      {/* 通知バナー */}
      {completionBanner && (
        <div
          onClick={() => {
            if (typeof completionBanner === 'object' && completionBanner.taskId) {
              setSelectedTaskId(completionBanner.taskId);
            }
            setCompletionBanner(null);
          }}
          style={{
            position: 'fixed', top: 16, right: 16, zIndex: 9999,
            background: 'rgba(0,40,20,0.95)', border: '1px solid rgba(0,255,136,0.4)',
            borderRadius: 10, padding: '10px 18px', cursor: 'pointer',
            color: '#00ff88', fontSize: 13, fontWeight: 600,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            animation: 'fadeInDown 0.2s ease',
            maxWidth: 300,
          }}
        >
          {typeof completionBanner === 'object' ? completionBanner.message : completionBanner}
        </div>
      )}

      {/* 右カラム：エージェント一覧 */}
      <AgentPanel
        agents={agents}
        companyId={companyId}
        activeAgents={activeAgents}
        onJdApprove={handleJdApprove}
        onJdReject={handleJdReject}
        onAgentClick={(agent) => { setSelectedAgent(agent); setAgentChatOpen(true); setShowDetailModal(false); }}
        pendingConfirms={pendingConfirms}
        onConfirm={handleConfirm}
      />

      {/* エージェントチャット（スライドインパネル） */}
      {selectedAgent && agentChatOpen && !showDetailModal && (
        <AgentChat
          agent={agents.find((a) => a.id === selectedAgent.id) || selectedAgent}
          companyId={companyId}
          activeAgents={activeAgents}
          onClose={() => { setAgentChatOpen(false); setSelectedAgent(null); }}
          onSwitchToDetail={() => setShowDetailModal(true)}
        />
      )}

      {/* JD詳細モーダル（AgentChatから切り替え） */}
      {selectedAgent && showDetailModal && (
        <AgentDetailModal
          agent={selectedAgent}
          companyId={companyId}
          onClose={() => { setShowDetailModal(false); setAgentChatOpen(false); setSelectedAgent(null); }}
          onJdApprove={(id) => { handleJdApprove(id); setShowDetailModal(false); setSelectedAgent(null); }}
          onJdReject={(id) => { handleJdReject(id); setShowDetailModal(false); setSelectedAgent(null); }}
          onDirectInstruction={handleDirectInstruction}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink-cur { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes blink-waiting { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes fadeInDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        select option { background: #0f172a; }
      `}</style>
    </div>
  );
}
