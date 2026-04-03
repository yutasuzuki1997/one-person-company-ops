import { useState } from 'react';

const STATUS_LABELS = { idle: '待機中', working: '作業中', review: 'FB待ち', waiting: '承認待ち', error: 'エラー', completed: 'FB待ち' };

export default function AgentDetailModal({ agent, companyId, onClose, onJdApprove, onJdReject, onDirectInstruction }) {
  const [directInput, setDirectInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState('');
  const [editingJd, setEditingJd] = useState(false);
  const [jdDraft, setJdDraft] = useState(agent.jobDescription || '');
  const [savingJd, setSavingJd] = useState(false);

  const status = agent.status || 'idle';

  const handleDirectSend = async () => {
    const text = directInput.trim();
    if (!text || sending) return;
    setSending(true);
    setSentMsg('');
    try {
      const res = await fetch('/api/secretary/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `[${agent.name}への直接指示] ${text}`,
          companyId,
        }),
      });
      // SSEを消費するだけ（レスポンス無視）
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      onDirectInstruction?.(agent.name, text);
      setSentMsg('送信しました');
      setDirectInput('');
      setTimeout(() => setSentMsg(''), 3000);
    } catch {
      setSentMsg('送信エラー');
    } finally {
      setSending(false);
    }
  };

  const handleSaveJd = async () => {
    setSavingJd(true);
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobDescription: jdDraft }),
      });
      setEditingJd(false);
    } catch {}
    setSavingJd(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        {/* ヘッダー */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 32 }}>{agent.avatar || '🤖'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>{agent.name}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{agent.role}</div>
          </div>
          <span className={`status-badge status-badge--${status}`}>
            <span className={`status-dot status-dot--${status}`} />
            {STATUS_LABELS[status] || status}
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1 }}
          >×</button>
        </div>

        {/* ステータス詳細 */}
        {agent.status === 'working' && (
          <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#7dd3fc', fontWeight: 600 }}>作業中</span>
              {agent.estimatedMinutes != null && (
                <span style={{ fontSize: 11, color: '#64748b' }}>残り約{agent.estimatedMinutes}分</span>
              )}
            </div>
            <div className="progress-bar" style={{ marginBottom: 6 }}>
              <div className="progress-fill" style={{ width: `${agent.progress || 0}%` }} />
            </div>
            {agent.currentTask && (
              <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.currentTask}
              </div>
            )}
          </div>
        )}

        {/* 直接指示 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            直接指示
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, lineHeight: 1.5 }}>
            ※ 通常は統括秘書経由での指示を推奨します。直接指示はログに記録されます。
          </div>
          <textarea
            className="chat-textarea"
            value={directInput}
            onChange={(e) => setDirectInput(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleDirectSend(); } }}
            placeholder={`${agent.name}への指示を入力...`}
            rows={3}
            style={{ fontSize: 12, minHeight: 60 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <button
              className="btn-primary"
              onClick={handleDirectSend}
              disabled={!directInput.trim() || sending}
              style={{ fontSize: 12, padding: '6px 14px' }}
            >
              {sending ? '送信中...' : '送信'}
            </button>
            {sentMsg && <span style={{ fontSize: 11, color: '#22c55e' }}>{sentMsg}</span>}
          </div>
        </div>

        {/* JD */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              ジョブディスクリプション
            </span>
            {!editingJd && (
              <button onClick={() => setEditingJd(true)} className="btn-ghost" style={{ fontSize: 10, padding: '3px 8px' }}>
                編集
              </button>
            )}
          </div>
          {editingJd ? (
            <>
              <textarea
                className="chat-textarea"
                value={jdDraft}
                onChange={(e) => setJdDraft(e.target.value)}
                rows={5}
                style={{ fontSize: 12, minHeight: 100 }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="btn-primary" onClick={handleSaveJd} disabled={savingJd} style={{ fontSize: 11, padding: '5px 12px' }}>
                  {savingJd ? '保存中...' : '保存'}
                </button>
                <button className="btn-ghost" onClick={() => { setEditingJd(false); setJdDraft(agent.jobDescription || ''); }} style={{ fontSize: 11, padding: '5px 10px' }}>
                  キャンセル
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, maxHeight: 120, overflowY: 'auto', background: 'rgba(15,23,42,0.4)', borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
              {agent.jobDescription || '(未設定)'}
            </div>
          )}
        </div>

        {/* JD保留バナー */}
        {agent.pendingJdUpdate && (
          <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 600, marginBottom: 6 }}>JD更新の提案</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, lineHeight: 1.5 }}>{agent.pendingJdUpdate}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { onJdApprove(agent.id); onClose(); }}
                style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                承認
              </button>
              <button onClick={() => { onJdReject(agent.id); onClose(); }}
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                却下
              </button>
            </div>
          </div>
        )}

        {/* 担当リポジトリ */}
        {Array.isArray(agent.repositories) && agent.repositories.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              担当リポジトリ ({agent.repositories.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {agent.repositories.map((r) => (
                <span key={r} style={{ fontSize: 10, background: 'rgba(51,65,85,0.4)', border: '1px solid rgba(51,65,85,0.6)', borderRadius: 4, padding: '2px 7px', color: '#94a3b8' }}>
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
