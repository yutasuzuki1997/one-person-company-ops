import { useState, useEffect, useCallback } from 'react';
import AgentFormModal from './AgentFormModal';

const DEPT_COLORS = {
  '社長室': '#6366f1',
  'BACKSTAGE事業部': '#f59e0b',
  '個人事業部': '#10b981',
  '音楽事業部': '#a855f7',
  '業務委託事業部': '#06b6d4',
  '統括': '#fbbf24',
  'その他': '#64748b',
};

const STATUS_LABELS = {
  idle: '待機中', working: '作業中', review: 'FB待ち',
  waiting: '承認待ち', error: 'エラー', completed: 'FB待ち',
};
const STATUS_COLORS = {
  idle: '#475569', working: '#38bdf8', review: '#a78bfa',
  waiting: '#fbbf24', error: '#ef4444', completed: '#a78bfa',
};

function AgentMiniCard({ agent, onEdit }) {
  const status = agent.status || 'idle';
  return (
    <div
      onClick={() => onEdit(agent)}
      style={{
        background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(51,65,85,0.5)',
        borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
        minWidth: 130, maxWidth: 160,
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(56,189,248,0.4)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(51,65,85,0.5)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 16 }}>{agent.avatar || '🤖'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.name}
          </div>
          <div style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.role}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[status] || '#475569', flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: STATUS_COLORS[status] || '#64748b' }}>{STATUS_LABELS[status] || status}</span>
      </div>
    </div>
  );
}

function SectionCard({ section, agents, onEditSection, onDeleteSection, onAddAgent, onEditAgent }) {
  const color = DEPT_COLORS[section.name] || DEPT_COLORS['その他'];
  const sectionAgents = agents.filter((a) => {
    const role = a.role || '';
    if (section.name === '社長室') return role.includes('社長室');
    if (section.name === 'BACKSTAGE事業部') return role.includes('BACKSTAGE');
    if (section.name === '個人事業部') return role.includes('個人');
    if (section.name === '音楽事業部') return role.includes('音楽');
    if (section.name === '業務委託事業部') return role.includes('委託');
    if (section.name === '統括') return role.includes('統括');
    return false;
  });

  return (
    <div style={{
      background: 'rgba(15,23,42,0.85)', border: `1px solid ${color}40`,
      borderRadius: 12, padding: 18, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{section.name}</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>{sectionAgents.length}名</span>
        <button
          onClick={() => onAddAgent(section)}
          style={{
            background: `${color}18`, border: `1px solid ${color}40`,
            color, borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
          }}
        >＋ エージェントを追加</button>
        <button
          onClick={() => onEditSection(section)}
          style={{ background: 'rgba(71,85,105,0.3)', border: '1px solid rgba(71,85,105,0.5)', color: '#94a3b8', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
        >編集</button>
        <button
          onClick={() => onDeleteSection(section.id)}
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}
        >削除</button>
      </div>

      {sectionAgents.length === 0 ? (
        <div style={{ fontSize: 12, color: '#334155', padding: '8px 0' }}>エージェントがいません</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {sectionAgents.map((a) => (
            <AgentMiniCard key={a.id} agent={a} onEdit={onEditAgent} />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionFormModal({ section, onClose, onSubmit }) {
  const [name, setName] = useState(section?.name || '');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>
          {section ? 'セクションを編集' : 'セクションを追加'}
        </h3>
        <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>セクション名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例：社長室、BACKSTAGE事業部"
          autoFocus
          style={{
            width: '100%', background: 'rgba(6,13,26,0.8)',
            border: '1px solid rgba(56,189,248,0.35)', borderRadius: 8,
            padding: '9px 12px', color: '#e2e8f0', fontSize: 14,
            outline: 'none', fontFamily: 'inherit', marginBottom: 16, boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="btn-ghost">キャンセル</button>
          <button
            className="btn-primary"
            disabled={!name.trim()}
            onClick={() => { if (name.trim()) { onSubmit(name.trim()); onClose(); } }}
          >
            {section ? '保存' : '追加'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompanyManager({ onNavigate }) {
  const [sections, setSections] = useState([]);
  const [agents, setAgents] = useState([]);
  const [companyId, setCompanyId] = useState(null);

  // モーダル状態
  const [sectionModal, setSectionModal] = useState(null); // null | 'new' | section object
  const [agentModal, setAgentModal] = useState(null);     // null | { section, agent? }

  const loadData = useCallback(async () => {
    try {
      // 会社一覧からcompanyIdを取得
      const companiesRes = await fetch('/api/companies');
      const companies = await companiesRes.json();
      const cid = companies[0]?.id;
      if (!cid) return;
      setCompanyId(cid);

      // エージェント一覧
      const agentsRes = await fetch(`/api/companies/${cid}/agents`);
      const agentsData = await agentsRes.json();
      if (Array.isArray(agentsData)) setAgents(agentsData);

      // セクション一覧（/api/sectionsがあれば使用、なければ固定リスト）
      try {
        const sectionsRes = await fetch('/api/sections');
        const sectionsData = await sectionsRes.json();
        if (Array.isArray(sectionsData)) {
          setSections(sectionsData);
          return;
        }
      } catch {}

      // フォールバック：固定事業部リスト
      setSections([
        { id: 'president', name: '社長室' },
        { id: 'backstage', name: 'BACKSTAGE事業部' },
        { id: 'personal', name: '個人事業部' },
        { id: 'music', name: '音楽事業部' },
        { id: 'freelance', name: '業務委託事業部' },
        { id: 'general', name: '統括' },
      ]);
    } catch {}
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateSection = async (name) => {
    try {
      await fetch('/api/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch {}
    loadData();
  };

  const handleUpdateSection = async (id, name) => {
    try {
      await fetch(`/api/sections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch {}
    loadData();
  };

  const handleDeleteSection = async (id) => {
    if (!confirm('このセクションを削除しますか？')) return;
    try {
      await fetch(`/api/sections/${id}`, { method: 'DELETE' });
    } catch {}
    loadData();
  };

  const handleSaveAgent = async (agentData) => {
    if (!companyId) return;
    if (agentModal?.agent) {
      await fetch(`/api/agents/${agentModal.agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData),
      });
    } else {
      await fetch(`/api/companies/${companyId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData),
      });
    }
    setAgentModal(null);
    loadData();
  };

  const handleDeleteAgent = async (agentId) => {
    if (!confirm('このエージェントを削除しますか？')) return;
    await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    setAgentModal(null);
    loadData();
  };

  const navBtnStyle = {
    background: 'transparent', border: '1px solid rgba(51,65,85,0.4)',
    borderRadius: 6, padding: '5px 12px', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
  };

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
          <button style={{ ...navBtnStyle, borderColor: 'rgba(56,189,248,0.3)', color: '#38bdf8', background: 'rgba(56,189,248,0.1)' }}>
            エージェント管理
          </button>
          <button onClick={() => onNavigate('settings')} style={navBtnStyle}>設定</button>
        </nav>
      </header>

      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, margin: 0 }}>エージェント管理</h2>
          <button
            onClick={() => setSectionModal('new')}
            style={{
              background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)',
              borderRadius: 8, padding: '7px 16px', color: '#38bdf8',
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >＋ セクションを追加</button>
        </div>

        {sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            agents={agents}
            onEditSection={(s) => setSectionModal(s)}
            onDeleteSection={handleDeleteSection}
            onAddAgent={(s) => setAgentModal({ section: s, agent: null })}
            onEditAgent={(a) => setAgentModal({ section: sections.find((s) => s.name === a.role?.split('/')[0]) || sections[0], agent: a })}
          />
        ))}

        {sections.length === 0 && (
          <div style={{ textAlign: 'center', color: '#475569', padding: '60px 0', fontSize: 14 }}>
            セクション（事業部）がありません。「+ セクションを追加」から作成してください。
          </div>
        )}
      </div>

      {/* セクションモーダル */}
      {sectionModal && (
        <SectionFormModal
          section={sectionModal === 'new' ? null : sectionModal}
          onClose={() => setSectionModal(null)}
          onSubmit={(name) => {
            if (sectionModal === 'new') handleCreateSection(name);
            else handleUpdateSection(sectionModal.id, name);
          }}
        />
      )}

      {/* エージェント編集モーダル */}
      {agentModal && (
        <AgentFormModal
          agent={agentModal.agent}
          section={agentModal.section}
          sections={sections}
          companyId={companyId}
          onClose={() => setAgentModal(null)}
          onSave={handleSaveAgent}
          onDelete={agentModal.agent ? () => handleDeleteAgent(agentModal.agent.id) : null}
        />
      )}
    </div>
  );
}
