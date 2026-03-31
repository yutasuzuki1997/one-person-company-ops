import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import SetupWizard from './components/SetupWizard/index.jsx';
import Dashboard from './components/Dashboard/index.jsx';
import CompanyManager from './components/CompanyManager/index.jsx';

// 設定画面（シンプルなインライン実装）
function SettingsPage({ onNavigate }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [personalToken, setPersonalToken] = useState('');
  const [companyToken, setCompanyToken] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setModel(data.model || 'claude-sonnet-4-20250514');
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    const body = { model };
    if (anthropicKey.trim()) body.anthropicApiKey = anthropicKey.trim();
    if (personalToken.trim()) body.githubPersonalToken = personalToken.trim();
    if (companyToken.trim()) body.githubCompanyToken = companyToken.trim();
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const navBtnStyle = {
    background: 'transparent', border: '1px solid rgba(51,65,85,0.4)',
    borderRadius: 6, padding: '5px 12px', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#060810', color: '#e2e8f0', fontFamily: "'Inter', sans-serif" }}>
      <header style={{
        padding: '12px 20px', borderBottom: '1px solid #1e293b',
        display: 'flex', alignItems: 'center', gap: 16, background: '#060d1a',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#7dd3fc' }}>One-Company Ops</span>
        <div style={{ flex: 1 }} />
        <nav style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onNavigate('dashboard')} style={navBtnStyle}>ダッシュボード</button>
          <button onClick={() => onNavigate('companies')} style={navBtnStyle}>エージェント管理</button>
          <button style={{ ...navBtnStyle, borderColor: 'rgba(56,189,248,0.3)', color: '#38bdf8', background: 'rgba(56,189,248,0.1)' }}>設定</button>
        </nav>
      </header>

      <div style={{ padding: 24, maxWidth: 560 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, marginBottom: 24 }}>設定</h2>

        {settings && (
          <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
            Anthropic APIキー：{settings.anthropicApiKey || '未設定'}&nbsp;/&nbsp;
            GitHubトークン(personal)：{settings.githubPersonalToken || '未設定'}
          </div>
        )}

        {[
          { label: 'Anthropic APIキー（変更する場合のみ入力）', value: anthropicKey, onChange: setAnthropicKey, placeholder: 'sk-ant-api03-...' },
          { label: 'GitHub Personalトークン（変更する場合のみ）', value: personalToken, onChange: setPersonalToken, placeholder: 'ghp_...' },
          { label: 'GitHub Companyトークン（変更する場合のみ）', value: companyToken, onChange: setCompanyToken, placeholder: 'ghp_...' },
        ].map(({ label, value, onChange, placeholder }) => (
          <div key={label} style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{label}</label>
            <input
              type="password"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              style={inputStyle}
            />
          </div>
        ))}

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>モデル</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
            <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</option>
            <option value="claude-opus-4-20250514">claude-opus-4-20250514</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</option>
          </select>
        </div>

        <button onClick={handleSave} style={{ background: saved ? '#22c55e' : '#38bdf8', border: 'none', borderRadius: 8, padding: '9px 24px', color: '#0c1a2e', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          {saved ? '保存しました ✓' : '保存'}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', background: 'rgba(6,13,26,0.8)',
  border: '1px solid rgba(51,65,85,0.6)', borderRadius: 8,
  padding: '8px 12px', color: '#e2e8f0', fontSize: 13,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};

function App() {
  // null = 確認中, true = セットアップ済み, false = 未セットアップ
  const [ready, setReady] = useState(null);
  // "dashboard" | "companies" | "settings"
  const [page, setPage] = useState('dashboard');

  useEffect(() => {
    fetch('/api/settings/status')
      .then((r) => r.json())
      .then((data) => setReady(!!data.isConfigured))
      .catch(() => setReady(false));

    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        const name = data.userName && data.userName.trim();
        document.title = name ? `One-Company-Ops [${name}]` : 'One-Company-Ops';
      })
      .catch(() => {});
  }, []);

  if (ready === null) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontFamily: 'sans-serif', color: '#6b7280',
        background: '#060810',
      }}>
        読み込み中...
      </div>
    );
  }

  if (!ready) {
    return <SetupWizard onComplete={() => setReady(true)} />;
  }

  if (page === 'companies') {
    return <CompanyManager onNavigate={setPage} />;
  }

  if (page === 'settings') {
    return <SettingsPage onNavigate={setPage} />;
  }

  return <Dashboard onNavigate={setPage} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
