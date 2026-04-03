import { useState, useEffect, useRef, useCallback } from 'react';
import './Dashboard.css';
import Background from './Background';
import SecretaryPanel from './SecretaryPanel';
import AgentPanel from './AgentPanel';
import AgentDetailModal from './AgentDetailModal';

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

function formatTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
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
      // DELEGATEブロック
      const delegateRe = /###DELEGATE\s+agentId="([^"]+)"\s+task="([^"]+)"[^#]*###/g;
      let m;
      while ((m = delegateRe.exec(msg.content)) !== null) {
        bubbles.push({ type: 'delegate', ts, agentId: m[1], text: m[2] });
      }
      if (msg.delegations?.length) {
        msg.delegations.forEach((d) => {
          bubbles.push({ type: 'delegate', ts, agentName: d.agentName || d.agentId, text: d.task });
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
    } else if (msg.role === 'error') {
      bubbles.push({ type: 'error', ts, text: msg.content });
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
        <div style={{ maxWidth: '80%' }}>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>
            統括秘書 <span style={{ marginLeft: 4 }}>{ts}</span>
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
function TaskTerminal({ task, streamContent, agents, onConfirm }) {
  const bottomRef = useRef(null);

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
          <TaskStatusBadge status={task.status} />
        </div>

        {/* 進捗バー（常に表示） */}
        <div style={{ marginBottom: isWaiting ? 8 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: '#475569' }}>
              {workingAgents.length > 0 ? workingAgents.map((a) => a.name).join(', ') + ' が作業中' : (task.status === 'working' ? '処理中...' : '')}
            </span>
            <span style={{ fontSize: 10, color: '#475569' }}>{task.progress || 0}%</span>
          </div>
          <div style={{ height: 3, background: 'rgba(51,65,85,0.4)', borderRadius: 2 }}>
            <div style={{
              height: '100%',
              background: task.status === 'waiting'
                ? '#fbbf24'
                : task.status === 'review' ? '#a78bfa'
                : '#38bdf8',
              width: `${task.progress || 0}%`,
              borderRadius: 2,
              transition: 'width 0.5s',
            }} />
          </div>
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
            💬 統括秘書があなたの返答を待っています
          </div>
        )}
      </div>

      {/* チャットエリア */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px 16px',
        background: 'rgba(6,10,18,0.6)',
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
            <div style={{ maxWidth: '80%' }}>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>
                統括秘書 <span style={{ marginLeft: 4 }}>{formatTimestamp(new Date())}</span>
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
    </div>
  );
}

// タスクステータスバッジ（タスクレベル用）
function TaskStatusBadge({ status }) {
  const map = {
    done:     { label: '完了',          cls: 'idle' },
    waiting:  { label: '返答待ち ⬆',   cls: 'waiting' },
  };
  // waiting/done 以外はすべて「進行中」グリーン
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
  const [isSending, setIsSending] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [secretaryStatus, setSecretaryStatus] = useState('idle');

  const [selectedAgent, setSelectedAgent] = useState(null);

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
      } else if (msg.type === 'jd_proposal') {
        setAgents((prev) => prev.map((a) =>
          a.id === msg.agentId ? { ...a, pendingJdUpdate: msg.proposedJd } : a
        ));
      } else if (msg.type === 'agents_reloaded') {
        loadAgents(companyId);
      }
    };

    return () => { ws.onclose = null; ws.close(); };
  }, [companyId, loadAgents]);

  // タスク作成
  const handleCreateTask = useCallback((name) => {
    const id = 'task-' + Date.now();
    const task = { id, name, status: 'pending', progress: 0, messages: [], lastMessage: '' };
    setTasks((prev) => [...prev, task]);
    setSelectedTaskId(id);
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
      const taskName = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      const task = {
        id, name: taskName, status: 'working', progress: 0,
        messages: [], lastMessage: text.slice(0, 40),
      };
      setTasks((prev) => [...prev, task]);
      setSelectedTaskId(id);
      taskId = id;
    } else {
      setTasks((prev) => prev.map((t) =>
        t.id === taskId ? { ...t, status: 'working', lastMessage: text.slice(0, 40) } : t
      ));
    }

    const userMsg = { id: 'msg-' + Date.now(), role: 'user', content: text, timestamp: new Date().toISOString() };
    setTasks((prev) => prev.map((t) =>
      t.id === taskId ? { ...t, messages: [...t.messages, userMsg] } : t
    ));

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
      : delegations.length > 0 ? 'working' : 'review';

    setTasks((prev) => prev.map((t) =>
      t.id === taskId ? {
        ...t,
        messages: [...t.messages, secretaryMsg],
        status: nextStatus,
        lastMessage: stripControlBlocks(accumulatedContent).slice(0, 50),
      } : t
    ));
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
        onSelectTask={setSelectedTaskId}
        onCreateTask={handleCreateTask}
        onSendMessage={handleSendMessage}
        isSending={isSending}
        secretaryStatus={secretaryStatus}
      />

      {/* 中央カラム：チャット */}
      <div className="dashboard-center" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TaskTerminal
          task={selectedTask}
          streamContent={selectedTaskId === selectedTask?.id ? streamContent : ''}
          agents={agents}
          onConfirm={handleConfirm}
        />
      </div>

      {/* 右カラム：エージェント一覧 */}
      <AgentPanel
        agents={agents}
        companyId={companyId}
        onJdApprove={handleJdApprove}
        onJdReject={handleJdReject}
        onAgentClick={setSelectedAgent}
        pendingConfirms={pendingConfirms}
        onConfirm={handleConfirm}
      />

      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          companyId={companyId}
          onClose={() => setSelectedAgent(null)}
          onJdApprove={(id) => { handleJdApprove(id); setSelectedAgent(null); }}
          onJdReject={(id) => { handleJdReject(id); setSelectedAgent(null); }}
          onDirectInstruction={handleDirectInstruction}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink-cur { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes blink-waiting { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
        select option { background: #0f172a; }
      `}</style>
    </div>
  );
}
