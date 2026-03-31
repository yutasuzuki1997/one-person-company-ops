import { useState, useEffect } from 'react';
import AgentForm from './AgentForm';

const STATUS_COLORS = {
  idle: '#475569',
  working: '#38bdf8',
  waiting: '#fbbf24',
  error: '#ef4444',
  completed: '#22c55e',
};

const ROLE_ICONS = {
  engineer: '⚙️',
  designer: '🎨',
  marketer: '📣',
  researcher: '🔍',
  accountant: '💰',
  legal: '⚖️',
  'project-manager': '📋',
  custom: '🤖',
};

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function AgentManager({ company, onBack, onNavigate }) {
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);

  useEffect(() => {
    loadAgents();
  }, [company.id]);

  const loadAgents = async () => {
    const res = await fetch(`/api/companies/${company.id}/agents`);
    const data = await res.json();
    if (Array.isArray(data)) setAgents(data);
  };

  const handleCreate = async (form) => {
    await fetch(`/api/companies/${company.id}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setShowForm(false);
    loadAgents();
  };

  const handleUpdate = async (agentId, form) => {
    await fetch(`/api/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setEditingAgent(null);
    loadAgents();
  };

  const handleDelete = async (agentId) => {
    if (!confirm('このエージェントを削除しますか？')) return;
    await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    loadAgents();
  };

  if (showForm || editingAgent) {
    return (
      <AgentForm
        agent={editingAgent}
        onSubmit={editingAgent ? (form) => handleUpdate(editingAgent.id, form) : handleCreate}
        onCancel={() => { setShowForm(false); setEditingAgent(null); }}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#060810', color: '#e2e8f0', fontFamily: "'Inter', sans-serif" }}>
      {/* ヘッダー */}
      <header style={{
        padding: '12px 20px', borderBottom: '1px solid #1e293b',
        display: 'flex', alignItems: 'center', gap: 16, background: '#060d1a',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#7dd3fc' }}>One-Company Ops</span>
        <div style={{ flex: 1 }} />
        <nav style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onNavigate('dashboard')} style={navBtnStyle}>ダッシュボード</button>
          <button style={{ ...navBtnStyle, borderColor: 'rgba(56,189,248,0.3)', color: '#38bdf8', background: 'rgba(56,189,248,0.1)' }}>エージェント管理</button>
          <button onClick={() => onNavigate('settings')} style={navBtnStyle}>設定</button>
        </nav>
      </header>

      <div style={{ padding: 24 }}>
        {/* パンくずリスト */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 13, color: '#64748b' }}>
          <button
            onClick={onBack}
            style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: 13, padding: 0 }}
          >← 会社一覧</button>
          <span>/</span>
          <span style={{ color: '#94a3b8' }}>{company.name}</span>
          <span>/</span>
          <span style={{ color: '#e2e8f0' }}>エージェント管理</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, margin: 0 }}>
            {company.name} のエージェント
          </h2>
          <button
            onClick={() => setShowForm(true)}
            style={{ background: '#38bdf8', border: 'none', borderRadius: 8, padding: '8px 18px', color: '#0c1a2e', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >＋ エージェントを追加</button>
        </div>

        {agents.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#475569', padding: '60px 0', fontSize: 14 }}>
            エージェントがまだ登録されていません
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {agents.map((agent) => {
              const status = agent.status || 'idle';
              const roleIcon = ROLE_ICONS[agent.role] || agent.avatar || '🤖';
              return (
                <div key={agent.id} style={{
                  background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(51,65,85,0.55)',
                  borderRadius: 12, padding: '14px 18px',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <span style={{ fontSize: 22 }}>{roleIcon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>{agent.name}</span>
                      <span style={{ fontSize: 11, color: '#64748b' }}>{agent.role}</span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 11, color: STATUS_COLORS[status] || '#64748b',
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[status] || '#475569', display: 'inline-block' }} />
                        {status}
                      </span>
                    </div>
                    {agent.currentTask && (
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {agent.currentTask}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>
                      最終アクティブ：{formatDate(agent.lastActiveAt)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => setEditingAgent(agent)}
                      style={{ background: 'rgba(71,85,105,0.3)', border: '1px solid rgba(71,85,105,0.5)', color: '#94a3b8', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                    >編集</button>
                    <button
                      onClick={() => handleDelete(agent.id)}
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                    >削除</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const navBtnStyle = {
  background: 'transparent', border: '1px solid rgba(51,65,85,0.4)',
  borderRadius: 6, padding: '5px 12px', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
};
