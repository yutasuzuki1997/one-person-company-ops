import { useState, useEffect, useCallback } from 'react';

const TRIGGER_LABELS = { daily: '毎日', hourly: '毎時', weekly: '毎週', custom: 'カスタム' };
const TRIGGER_OPTIONS = [
  { value: 'daily', label: '毎日' },
  { value: 'hourly', label: '毎時' },
  { value: 'weekly', label: '毎週' },
];

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10, cursor: 'pointer', flexShrink: 0,
        background: checked ? '#38bdf8' : '#334155',
        position: 'relative', transition: 'background 0.2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2,
        left: checked ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
      }} />
    </div>
  );
}

function RoutineModal({ routine, agents, onClose, onSave }) {
  const isNew = !routine;
  const [name, setName] = useState(routine?.name || '新しいルーティン');
  const [trigger, setTrigger] = useState(routine?.trigger || 'daily');
  const [triggerTime, setTriggerTime] = useState(routine?.triggerTime || '09:00');
  const [enabled, setEnabled] = useState(routine?.enabled !== false);
  const [tasks, setTasks] = useState(routine?.tasks || [{ agentId: 'secretary', action: '' }]);

  const addTask = () => setTasks((p) => [...p, { agentId: agents[0]?.id || 'auto', action: '' }]);
  const removeTask = (i) => setTasks((p) => p.filter((_, idx) => idx !== i));
  const updateTask = (i, patch) => setTasks((p) => p.map((t, idx) => idx === i ? { ...t, ...patch } : t));

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), trigger, triggerTime, enabled, tasks: tasks.filter((t) => t.action.trim()) });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700, marginBottom: 20, marginTop: 0 }}>
          {isNew ? 'ルーティンを追加' : 'ルーティンを編集'}
        </h3>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>ルーティン名</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>トリガー</label>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} style={inputStyle}>
              {TRIGGER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {(trigger === 'daily' || trigger === 'weekly') && (
            <div style={{ flex: '0 0 120px' }}>
              <label style={labelStyle}>実行時刻（JST）</label>
              <input type="time" value={triggerTime} onChange={(e) => setTriggerTime(e.target.value)} style={inputStyle} />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Toggle checked={enabled} onChange={setEnabled} />
          <span style={{ fontSize: 12, color: enabled ? '#38bdf8' : '#64748b' }}>
            {enabled ? '有効' : '無効'}
          </span>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#7dd3fc', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            タスク
          </div>
          {tasks.map((task, i) => (
            <div key={i} style={{ background: 'rgba(6,13,26,0.6)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select
                  value={task.agentId}
                  onChange={(e) => updateTask(i, { agentId: e.target.value })}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="secretary">🤖 ジェニー（秘書）</option>
                  <option value="auto">⚡ 自律稼働（auto）</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.avatar || '👤'} {a.displayName || a.name}</option>
                  ))}
                </select>
                {tasks.length > 1 && (
                  <button
                    onClick={() => removeTask(i)}
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
                  >削除</button>
                )}
              </div>
              <textarea
                value={task.action}
                onChange={(e) => updateTask(i, { action: e.target.value })}
                placeholder="作業内容を記述してください"
                rows={2}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 56 }}
              />
            </div>
          ))}
          <button
            onClick={addTask}
            style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)', color: '#38bdf8', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
          >+ タスクを追加</button>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="btn-ghost">キャンセル</button>
          <button className="btn-primary" onClick={handleSave} disabled={!name.trim()}>
            {isNew ? '追加' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoutineCard({ routine, onEdit, onDelete, onRun, onToggle }) {
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    await onRun(routine.id);
    setTimeout(() => setRunning(false), 2000);
  };

  return (
    <div style={{
      background: 'rgba(15,23,42,0.8)', border: `1px solid ${routine.enabled ? 'rgba(56,189,248,0.25)' : 'rgba(51,65,85,0.4)'}`,
      borderRadius: 12, padding: '16px 18px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Toggle checked={routine.enabled} onChange={(v) => onToggle(routine.id, v)} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{routine.name}</span>
            <span style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
              background: routine.enabled ? 'rgba(56,189,248,0.12)' : 'rgba(71,85,105,0.3)',
              color: routine.enabled ? '#38bdf8' : '#475569',
            }}>
              {TRIGGER_LABELS[routine.trigger] || routine.trigger}
              {routine.triggerTime ? ` ${routine.triggerTime}` : ''}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#475569' }}>
              最終実行: {formatDate(routine.lastRun)}
            </div>
            <div style={{ fontSize: 10, color: '#475569' }}>
              次回: {formatDate(routine.nextRun)}
            </div>
          </div>

          {routine.tasks?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {routine.tasks.map((task, i) => (
                <div key={i} style={{
                  background: 'rgba(6,13,26,0.6)', border: '1px solid rgba(51,65,85,0.35)',
                  borderRadius: 6, padding: '3px 8px', fontSize: 11, color: '#94a3b8',
                  maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {task.agentId === 'auto' ? '⚡' : task.agentId === 'secretary' ? '🤖' : '👤'} {task.action.slice(0, 30)}{task.action.length > 30 ? '…' : ''}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={handleRun}
            disabled={running}
            style={{
              background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)',
              color: '#38bdf8', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
            }}
          >{running ? '実行中...' : '▶ 実行'}</button>
          <button
            onClick={() => onEdit(routine)}
            style={{ background: 'rgba(71,85,105,0.2)', border: '1px solid rgba(71,85,105,0.4)', color: '#94a3b8', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
          >編集</button>
          <button
            onClick={() => onDelete(routine.id)}
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
          >削除</button>
        </div>
      </div>
    </div>
  );
}

export default function RoutineManager({ onNavigate }) {
  const [routines, setRoutines] = useState([]);
  const [agents, setAgents] = useState([]);
  const [modal, setModal] = useState(null); // null | 'new' | routine object

  const load = useCallback(async () => {
    const [rRes, aRes] = await Promise.all([
      fetch('/api/routines').then((r) => r.json()).catch(() => ({ routines: [] })),
      fetch('/api/companies').then((r) => r.json()).then(async (companies) => {
        const cid = companies[0]?.id;
        if (!cid) return [];
        return fetch(`/api/companies/${cid}/agents`).then((r) => r.json()).catch(() => []);
      }).catch(() => []),
    ]);
    setRoutines(rRes.routines || []);
    setAgents(Array.isArray(aRes) ? aRes : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data) => {
    if (modal && modal !== 'new') {
      await fetch(`/api/routines/${modal.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
    } else {
      await fetch('/api/routines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
    }
    load();
  };

  const handleDelete = async (id) => {
    if (!confirm('このルーティンを削除しますか？')) return;
    await fetch(`/api/routines/${id}`, { method: 'DELETE' });
    load();
  };

  const handleRun = async (id) => {
    await fetch(`/api/routines/${id}/run`, { method: 'POST' });
  };

  const handleToggle = async (id, enabled) => {
    await fetch(`/api/routines/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    });
    load();
  };

  const navBtnStyle = {
    background: 'transparent', border: '1px solid rgba(51,65,85,0.4)',
    borderRadius: 6, padding: '5px 12px', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#060810', color: '#e2e8f0', fontFamily: "'Inter', sans-serif" }}>
      <header style={{ padding: '12px 20px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 16, background: '#060d1a' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#7dd3fc' }}>One-Company Ops</span>
        <div style={{ flex: 1 }} />
        <nav style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onNavigate('dashboard')} style={navBtnStyle}>ダッシュボード</button>
          <button onClick={() => onNavigate('companies')} style={navBtnStyle}>エージェント管理</button>
          <button style={{ ...navBtnStyle, borderColor: 'rgba(56,189,248,0.3)', color: '#38bdf8', background: 'rgba(56,189,248,0.1)' }}>ルーティン</button>
          <button onClick={() => onNavigate('settings')} style={navBtnStyle}>設定</button>
        </nav>
      </header>

      <div style={{ padding: 24, maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>ルーティン管理</h2>
            <p style={{ color: '#475569', fontSize: 12, margin: 0 }}>定期タスクの設定・有効/無効管理</p>
          </div>
          <button
            onClick={() => setModal('new')}
            style={{
              background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)',
              borderRadius: 8, padding: '8px 18px', color: '#38bdf8',
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >+ ルーティンを追加</button>
        </div>

        {routines.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#334155', padding: '60px 0', fontSize: 14 }}>
            ルーティンがありません。「+ ルーティンを追加」から作成してください。
          </div>
        ) : (
          routines.map((r) => (
            <RoutineCard
              key={r.id}
              routine={r}
              onEdit={(routine) => setModal(routine)}
              onDelete={handleDelete}
              onRun={handleRun}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>

      {modal && (
        <RoutineModal
          routine={modal === 'new' ? null : modal}
          agents={agents}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 5 };
const inputStyle = {
  width: '100%', background: 'rgba(6,13,26,0.8)',
  border: '1px solid rgba(51,65,85,0.6)', borderRadius: 8,
  padding: '7px 11px', color: '#e2e8f0', fontSize: 13,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};
