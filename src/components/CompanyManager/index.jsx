import { useState, useEffect } from 'react';
import CompanyForm from './CompanyForm';
import AgentManager from './AgentManager';

export default function CompanyManager({ onNavigate }) {
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [showAgents, setShowAgents] = useState(false);

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    const res = await fetch('/api/companies');
    const data = await res.json();
    if (Array.isArray(data)) setCompanies(data);
  };

  const handleCreate = async (form) => {
    await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setShowForm(false);
    loadCompanies();
  };

  const handleUpdate = async (id, form) => {
    await fetch(`/api/companies/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setEditingCompany(null);
    loadCompanies();
  };

  const handleDelete = async (id) => {
    if (!confirm('この会社を削除しますか？（最後の1社は削除できません）')) return;
    const res = await fetch(`/api/companies/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '削除できませんでした');
      return;
    }
    loadCompanies();
  };

  // エージェント管理画面
  if (showAgents && selectedCompanyId) {
    const company = companies.find((c) => c.id === selectedCompanyId);
    if (company) {
      return (
        <AgentManager
          company={company}
          onBack={() => setShowAgents(false)}
          onNavigate={onNavigate}
        />
      );
    }
  }

  // 会社フォーム
  if (showForm || editingCompany) {
    return (
      <CompanyForm
        company={editingCompany}
        onSubmit={editingCompany ? (form) => handleUpdate(editingCompany.id, form) : handleCreate}
        onCancel={() => { setShowForm(false); setEditingCompany(null); }}
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
          <button style={{ ...navBtnStyle, borderColor: 'rgba(56,189,248,0.3)', color: '#38bdf8', background: 'rgba(56,189,248,0.1)' }}>
            エージェント管理
          </button>
          <button onClick={() => onNavigate('settings')} style={navBtnStyle}>設定</button>
        </nav>
      </header>

      <div style={{ padding: 24 }}>
        {/* タイトル＋追加ボタン */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, margin: 0 }}>会社一覧</h2>
          <button
            onClick={() => setShowForm(true)}
            style={{
              background: '#38bdf8', border: 'none', borderRadius: 8,
              padding: '8px 18px', color: '#0c1a2e', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
          >＋ 会社を追加</button>
        </div>

        {/* 会社カード一覧 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {companies.map((company) => (
            <div key={company.id} style={{
              background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(51,65,85,0.6)',
              borderRadius: 12, padding: 20,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
                {company.name}
              </div>
              {company.description && (
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
                  {company.description}
                </div>
              )}
              <div style={{ color: '#334155', fontSize: 11, marginBottom: 14 }}>
                ID: {company.id}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setSelectedCompanyId(company.id); setShowAgents(true); }}
                  style={{
                    background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)',
                    color: '#38bdf8', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                  }}
                >エージェント管理</button>
                <button
                  onClick={() => setEditingCompany(company)}
                  style={{
                    background: 'rgba(71,85,105,0.3)', border: '1px solid rgba(71,85,105,0.5)',
                    color: '#94a3b8', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                  }}
                >編集</button>
                <button
                  onClick={() => handleDelete(company.id)}
                  style={{
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#ef4444', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                  }}
                >削除</button>
              </div>
            </div>
          ))}
        </div>

        {companies.length === 0 && (
          <div style={{ textAlign: 'center', color: '#475569', padding: '60px 0', fontSize: 14 }}>
            会社がありません。「会社を追加」から作成してください。
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
