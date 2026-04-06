import { useState, useRef, useEffect } from 'react';

const STATUS_LABELS = {
  idle: '待機中', working: '進行中', review: 'FB依頼あり',
  waiting: '返答待ち', error: 'エラー', completed: 'FB依頼あり', pending: '待機中',
};

function StatusBadge({ status }) {
  const s = status || 'pending';
  return (
    <span className={`status-badge status-badge--${s}`}>
      <span className={`status-dot status-dot--${s}`} />
      {STATUS_LABELS[s] || s}
    </span>
  );
}

export default function SecretaryPanel({
  companyId,
  companies,
  onNavigate,
  onCompanyChange,
  tasks,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
  onSendMessage,
  isSending,
  secretaryStatus,
}) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);

  const adjustTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || isSending) return;
    // 左サイドバーからは常に新規タスクとして送信
    onSendMessage(text, null);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="dashboard-left">
      {/* ── ヘッダー ── */}
      <div style={{
        padding: '14px 14px 10px',
        borderBottom: '1px solid rgba(51,65,85,0.35)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#7dd3fc', flex: 1 }}>
            統括秘書
          </span>
          <span className={`status-badge status-badge--${secretaryStatus || 'idle'}`}>
            <span className={`status-dot status-dot--${secretaryStatus || 'idle'}`} />
            {secretaryStatus === 'working' ? '処理中' : '待機中'}
          </span>
        </div>

        {/* 会社セレクタ */}
        {companies.length > 1 && (
          <select
            value={companyId || ''}
            onChange={(e) => onCompanyChange(e.target.value)}
            style={{
              width: '100%', background: 'rgba(6,13,26,0.7)',
              border: '1px solid rgba(51,65,85,0.4)', borderRadius: 6,
              color: '#cbd5e1', padding: '5px 8px', fontSize: 11,
              cursor: 'pointer', outline: 'none', marginBottom: 8,
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.id}</option>
            ))}
          </select>
        )}

        {/* ナビゲーション */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button onClick={() => onNavigate('companies')} style={navBtn}>エージェント管理</button>
          <button onClick={() => onNavigate('routines')} style={navBtn}>ルーティン</button>
          <button onClick={() => onNavigate('settings')} style={navBtn}>設定</button>
        </div>
      </div>

      {/* ── タスクリスト ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            タスク ({tasks.length})
          </span>
        </div>

        {tasks.length === 0 ? (
          <div style={{ color: '#334155', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
            指示を送ってタスクを開始してください
          </div>
        ) : (
          tasks.map((t) => (
            <div
              key={t.id}
              onClick={() => onSelectTask(t.id)}
              style={{
                padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                marginBottom: 4,
                background: selectedTaskId === t.id
                  ? 'rgba(56,189,248,0.1)'
                  : 'rgba(15,23,42,0.5)',
                border: `1px solid ${selectedTaskId === t.id ? 'rgba(56,189,248,0.35)' : 'rgba(51,65,85,0.3)'}`,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.name}
                </span>
                <StatusBadge status={t.status} />
              </div>
              <div className="progress-bar" style={{ marginBottom: 4 }}>
                <div className="progress-fill" style={{ width: `${t.progress || 0}%` }} />
              </div>
              {t.lastMessage && (
                <div style={{ fontSize: 10, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.lastMessage}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── 新規タスク入力エリア（下部固定） ── */}
      <div style={{
        borderTop: '1px solid rgba(51,65,85,0.35)',
        padding: '10px',
        flexShrink: 0,
      }}>
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={input}
          onChange={(e) => { setInput(e.target.value); adjustTextarea(); }}
          onKeyDown={handleKeyDown}
          placeholder="新しいタスクを開始...（Cmd+Enter）"
          rows={2}
          style={{ minHeight: 48, maxHeight: 120, fontSize: 12 }}
        />

        <button
          className="btn-primary"
          onClick={handleSend}
          disabled={!input.trim() || isSending}
          style={{ width: '100%', marginTop: 6, position: 'relative' }}
        >
          {isSending ? (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Spinner /> 処理中...
            </span>
          ) : '＋ 新しいタスク'}
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 12, height: 12,
      border: '2px solid rgba(12,26,46,0.4)',
      borderTopColor: '#0c1a2e',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
    }} />
  );
}

const navBtn = {
  background: 'transparent',
  border: '1px solid rgba(51,65,85,0.35)',
  borderRadius: 5, padding: '4px 8px',
  color: '#64748b', fontSize: 10, cursor: 'pointer',
  transition: 'all 0.15s',
};
