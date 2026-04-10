import { useState, useRef, useEffect } from 'react';

const STATUS_LABELS = {
  active: '進行中', working: '進行中', review: '確認待ち',
  waiting: '承認待ち', error: 'エラー', done: '完了', pending: '待機中',
  archived: '完了',
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

function ContextMenu({ x, y, onArchive, onDelete, onRename, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left: x, top: y, zIndex: 9999,
        background: '#0f172a', border: '1px solid rgba(51,65,85,0.6)',
        borderRadius: 8, padding: '4px 0', minWidth: 140,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}
    >
      {onRename && (
        <button onClick={onRename} style={menuItemStyle}>
          名前を変更
        </button>
      )}
      {onArchive && (
        <button onClick={onArchive} style={menuItemStyle}>
          完了にする
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} style={{ ...menuItemStyle, color: '#ef4444' }}>
          削除
        </button>
      )}
    </div>
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
  onSelectJennyChat,
  onCreateTask,
  onSendMessage,
  onArchiveTask,
  onDeleteTask,
  onRenameTask,
  isSending,
  secretaryStatus,
  jennySelected,
}) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);

  const adjustTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || isSending) return;
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

  const handleContextMenu = (e, taskId) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  };

  // タスクリストにはheavy/complexのみ表示（ジェニーへの直接会話はjenny chatで表示）
  const activeTasks = tasks.filter(t => t.status !== 'archived');

  return (
    <div className="dashboard-left">
      {/* ── ヘッダー ── */}
      <div style={{
        padding: '14px 14px 10px',
        borderBottom: '1px solid rgba(51,65,85,0.35)',
        flexShrink: 0,
      }}>
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

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button onClick={() => onNavigate('companies')} style={navBtn}>エージェント管理</button>
          <button onClick={() => onNavigate('resources')} style={navBtn}>リソース</button>
          <button onClick={() => onNavigate('routines')} style={navBtn}>ルーティン</button>
          <button onClick={() => onNavigate('settings')} style={navBtn}>設定</button>
        </div>
      </div>

      {/* ── ジェニー固定表示 ── */}
      <div
        onClick={() => onSelectJennyChat && onSelectJennyChat()}
        style={{
          padding: '10px 14px',
          cursor: 'pointer',
          background: jennySelected ? 'rgba(0,255,136,0.08)' : 'transparent',
          borderBottom: '1px solid rgba(51,65,85,0.35)',
          borderLeft: jennySelected ? '3px solid #00ff88' : '3px solid transparent',
          transition: 'all 0.15s',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>🤖</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#7dd3fc' }}>
                ジェニー
              </span>
              <span style={{ color: '#22c55e', fontSize: 8 }}>●</span>
              <span style={{ fontSize: 10, color: '#475569' }}>統括秘書</span>
            </div>
            <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
              {secretaryStatus === 'working' ? '処理中...' : '何でもお申し付けください'}
            </div>
          </div>
        </div>
      </div>

      {/* ── タスクリスト ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            タスク ({activeTasks.length})
          </span>
        </div>

        {activeTasks.length === 0 ? (
          <div style={{ color: '#334155', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
            ジェニーに指示を送ってタスクを開始
          </div>
        ) : (
          activeTasks.map((t) => (
            <div
              key={t.id}
              onClick={() => onSelectTask(t.id)}
              onContextMenu={(e) => handleContextMenu(e, t.id)}
              style={{
                padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                marginBottom: 4,
                opacity: t.status === 'done' ? 0.45 : 1,
                background: selectedTaskId === t.id && !jennySelected
                  ? 'rgba(56,189,248,0.1)'
                  : 'rgba(15,23,42,0.5)',
                border: `1px solid ${selectedTaskId === t.id && !jennySelected ? 'rgba(56,189,248,0.35)' : 'rgba(51,65,85,0.3)'}`,
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

      {/* ── 新規タスク入力エリア ── */}
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
          placeholder="ジェニーに指示...（Cmd+Enter）"
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
          ) : '送信'}
        </button>
      </div>

      {/* コンテキストメニュー */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onArchive={onArchiveTask ? () => { onArchiveTask(contextMenu.taskId); setContextMenu(null); } : null}
          onDelete={onDeleteTask ? () => { onDeleteTask(contextMenu.taskId); setContextMenu(null); } : null}
          onRename={onRenameTask ? () => { onRenameTask(contextMenu.taskId); setContextMenu(null); } : null}
          onClose={() => setContextMenu(null)}
        />
      )}
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

const menuItemStyle = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none',
  padding: '7px 14px', color: '#cbd5e1', fontSize: 12,
  cursor: 'pointer', transition: 'background 0.1s',
};
