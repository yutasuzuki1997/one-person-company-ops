import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import SetupWizard from './components/SetupWizard/index.jsx';
import Dashboard from './components/Dashboard/index.jsx';
import CompanyManager from './components/CompanyManager/index.jsx';
import RoutineManager from './components/RoutineManager/index.jsx';

// ── 設定画面 ────────────────────────────────────────────────────────────────
function IntegrationAccountCard({ account, color, label, tokenField, tokenPlaceholder, onUpdate, onDelete, onTest }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState(account.name || '');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await onTest?.(account, token || account[tokenField]);
      setTestResult(r);
    } catch {
      setTestResult({ ok: false, error: '接続エラー' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{
      background: 'rgba(6,13,26,0.5)', border: `1px solid ${color}30`,
      borderRadius: 8, padding: '12px 14px', marginBottom: 10,
    }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onUpdate(account.id, { name })}
          placeholder="表示名（例：個人Notion）"
          style={{ ...inputStyle, flex: 1, fontSize: 12 }}
        />
        <button
          onClick={() => onDelete(account.id)}
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
        >削除</button>
      </div>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onBlur={() => { if (token) onUpdate(account.id, { [tokenField]: token }); }}
        placeholder={account[tokenField] === '****' ? '（設定済み）変更する場合のみ入力' : tokenPlaceholder}
        style={{ ...inputStyle, marginBottom: 8, fontSize: 12 }}
      />
      {onTest && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={handleTest}
            disabled={testing}
            style={{ background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 6, padding: '4px 12px', color, fontSize: 11, cursor: 'pointer' }}
          >
            {testing ? '確認中...' : '接続テスト'}
          </button>
          {testResult && (
            <span style={{ fontSize: 11, color: testResult.ok ? '#22c55e' : '#ef4444' }}>
              {testResult.ok ? `✓ 接続成功（${testResult.user || 'OK'}）` : `✗ ${testResult.error}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsPage({ onNavigate }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [personalToken, setPersonalToken] = useState('');
  const [companyToken, setCompanyToken] = useState('');
  const [model, setModel] = useState('auto');
  const [anthropicTest, setAnthropicTest] = useState(null);
  const [wsOwner, setWsOwner] = useState('yutasuzuki1997');
  const [wsRepo, setWsRepo] = useState('Workspace');
  const [wsTest, setWsTest] = useState(null);

  // 複数アカウント用integrations
  const [notionAccounts, setNotionAccounts] = useState([]);
  const [sheetsAccounts, setSheetsAccounts] = useState([]);
  const [gaAccounts, setGaAccounts] = useState([]);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setModel(data.model || 'claude-sonnet-4-20250514');

        const intg = data.integrations || {};
        // 配列形式に移行（旧形式との後方互換）
        if (Array.isArray(intg.notion)) {
          setNotionAccounts(intg.notion);
        } else if (intg.notion?.token) {
          setNotionAccounts([{ id: 'notion-001', name: '個人Notion', token: intg.notion.token }]);
        } else {
          setNotionAccounts([]);
        }

        if (Array.isArray(intg.googleSheets)) {
          setSheetsAccounts(intg.googleSheets);
        } else {
          setSheetsAccounts([]);
        }

        if (Array.isArray(intg.googleAnalytics)) {
          setGaAccounts(intg.googleAnalytics);
        } else if (intg.googleAnalytics?.propertyId) {
          setGaAccounts([{ id: 'ga-001', name: '個人サイトGA4', propertyId: intg.googleAnalytics.propertyId }]);
        } else {
          setGaAccounts([]);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    const body = { model };
    if (anthropicKey.trim()) body.anthropicApiKey = anthropicKey.trim();
    if (geminiKey.trim()) body.geminiApiKey = geminiKey.trim();
    if (openaiKey.trim()) body.openaiApiKey = openaiKey.trim();
    if (personalToken.trim()) body.githubPersonalToken = personalToken.trim();
    if (companyToken.trim()) body.githubCompanyToken = companyToken.trim();
    if (wsOwner.trim()) body.workspaceOwner = wsOwner.trim();
    if (wsRepo.trim()) body.workspaceRepo = wsRepo.trim();
    body.integrations = {
      notion: notionAccounts,
      googleSheets: sheetsAccounts,
      googleAnalytics: gaAccounts,
    };
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testAnthropicKey = async () => {
    setAnthropicTest('testing');
    try {
      const r = await fetch('/api/settings/test-anthropic', { headers: { 'x-api-key': anthropicKey || 'current' } });
      const d = await r.json();
      setAnthropicTest(d.ok ? 'ok' : 'ng');
    } catch { setAnthropicTest('ng'); }
  };

  const testWorkspace = async () => {
    setWsTest('testing');
    try {
      const r = await fetch('/api/workspace/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: wsOwner, repo: wsRepo }) });
      const d = await r.json();
      setWsTest(d.ok ? 'ok' : 'ng');
    } catch { setWsTest('ng'); }
  };

  const addAccount = (setter, template) => setter((prev) => [...prev, { ...template, id: template.prefix + Date.now() }]);
  const updateAccount = (setter, id, patch) => setter((prev) => prev.map((a) => a.id === id ? { ...a, ...patch } : a));
  const deleteAccount = (setter, id) => setter((prev) => prev.filter((a) => a.id !== id));

  const handleNotionTest = async (account, token) => {
    const r = await fetch('/api/integrations/notion/test', {
      headers: token ? { 'x-notion-token': token } : {},
    });
    return r.json();
  };

  const navBtnStyle = {
    background: 'transparent', border: '1px solid rgba(51,65,85,0.4)',
    borderRadius: 6, padding: '5px 12px', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
  };
  const sectionTitle = { fontSize: 13, fontWeight: 700, color: '#7dd3fc', marginBottom: 14, marginTop: 28, borderBottom: '1px solid rgba(51,65,85,0.4)', paddingBottom: 8 };
  const serviceHeader = (color, title) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color }}>{title}</span>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#060810', color: '#e2e8f0', fontFamily: "'Inter', sans-serif" }}>
      <header style={{ padding: '12px 20px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 16, background: '#060d1a' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#7dd3fc' }}>One-Company Ops</span>
        <div style={{ flex: 1 }} />
        <nav style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onNavigate('dashboard')} style={navBtnStyle}>ダッシュボード</button>
          <button onClick={() => onNavigate('companies')} style={navBtnStyle}>エージェント管理</button>
          <button style={{ ...navBtnStyle, borderColor: 'rgba(56,189,248,0.3)', color: '#38bdf8', background: 'rgba(56,189,248,0.1)' }}>設定</button>
        </nav>
      </header>

      <div style={{ padding: 24, maxWidth: 600 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 700, marginBottom: 24 }}>設定</h2>

        {/* セクション1: AI接続設定 */}
        <div style={sectionTitle}>AI接続設定</div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Anthropic API Key</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="password" value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} placeholder="sk-ant-api03-..." style={{ ...inputStyle, flex: 1 }} />
            <button onClick={testAnthropicKey} style={{ ...navBtnStyle, flexShrink: 0, color: anthropicTest === 'ok' ? '#22c55e' : anthropicTest === 'ng' ? '#ef4444' : '#94a3b8' }}>
              {anthropicTest === 'testing' ? '確認中...' : anthropicTest === 'ok' ? '✓ 接続OK' : anthropicTest === 'ng' ? '✗ 失敗' : '接続テスト'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Google Gemini API Key（任意）</label>
          <input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="AIza..." style={inputStyle} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>OpenAI API Key（任意）</label>
          <input type="password" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} placeholder="sk-..." style={inputStyle} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>デフォルトモデル</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
            <option value="auto">自動（推奨）</option>
            <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4.5</option>
            <option value="gemini-flash">gemini-flash</option>
            <option value="gpt-4o">gpt-4o</option>
          </select>
        </div>

        {/* セクション2: GitHub連携 */}
        <div style={sectionTitle}>GitHub連携</div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>個人用トークン</label>
          <input type="password" value={personalToken} onChange={(e) => setPersonalToken(e.target.value)} placeholder="ghp_..." style={inputStyle} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>会社用トークン（任意）</label>
          <input type="password" value={companyToken} onChange={(e) => setCompanyToken(e.target.value)} placeholder="ghp_..." style={inputStyle} />
        </div>

        {/* セクション3: ワークスペース設定 */}
        <div style={sectionTitle}>ワークスペース設定</div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>owner</label>
            <input value={wsOwner} onChange={(e) => setWsOwner(e.target.value)} placeholder="yutasuzuki1997" style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>repo</label>
            <input value={wsRepo} onChange={(e) => setWsRepo(e.target.value)} placeholder="Workspace" style={inputStyle} />
          </div>
          <button onClick={testWorkspace} style={{ ...navBtnStyle, alignSelf: 'flex-end', flexShrink: 0, color: wsTest === 'ok' ? '#22c55e' : wsTest === 'ng' ? '#ef4444' : '#94a3b8' }}>
            {wsTest === 'testing' ? '確認中...' : wsTest === 'ok' ? '✓ 接続OK' : wsTest === 'ng' ? '✗ 失敗' : '接続テスト'}
          </button>
        </div>

        {/* セクション4-6: 連携設定 */}
        <div style={sectionTitle}>外部サービス連携</div>

        {/* Notion */}
        <div style={{ marginBottom: 20, padding: '14px', background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 10 }}>
          {serviceHeader('#a5b4fc', 'Notion')}
          {notionAccounts.map((account) => (
            <IntegrationAccountCard
              key={account.id}
              account={account}
              color="#a5b4fc"
              tokenField="token"
              tokenPlaceholder="secret_..."
              onUpdate={(id, patch) => updateAccount(setNotionAccounts, id, patch)}
              onDelete={(id) => deleteAccount(setNotionAccounts, id)}
              onTest={handleNotionTest}
            />
          ))}
          <button
            onClick={() => addAccount(setNotionAccounts, { prefix: 'notion-', name: 'Notion', token: '' })}
            style={{ background: 'rgba(165,180,252,0.08)', border: '1px solid rgba(165,180,252,0.25)', color: '#a5b4fc', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
          >＋ Notionアカウントを追加</button>
        </div>

        {/* Google Sheets */}
        <div style={{ marginBottom: 20, padding: '14px', background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 10 }}>
          {serviceHeader('#86efac', 'Google Sheets')}
          {sheetsAccounts.map((account) => (
            <div key={account.id} style={{ background: 'rgba(6,13,26,0.5)', border: '1px solid rgba(134,239,172,0.2)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={account.name || ''}
                  onChange={(e) => updateAccount(setSheetsAccounts, account.id, { name: e.target.value })}
                  placeholder="表示名"
                  style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                />
                <button
                  onClick={() => deleteAccount(setSheetsAccounts, account.id)}
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                >削除</button>
              </div>
              <textarea
                value={typeof account.credentials === 'string' ? account.credentials : (account.credentials ? JSON.stringify(account.credentials) : '')}
                onChange={(e) => {
                  let parsed = e.target.value;
                  try { parsed = JSON.parse(e.target.value); } catch {}
                  updateAccount(setSheetsAccounts, account.id, { credentials: parsed });
                }}
                placeholder="サービスアカウントJSON（{...}）"
                rows={3}
                style={{ ...inputStyle, fontSize: 11, marginBottom: 8, resize: 'vertical' }}
              />
              <input
                value={account.spreadsheetId || ''}
                onChange={(e) => updateAccount(setSheetsAccounts, account.id, { spreadsheetId: e.target.value })}
                placeholder="スプレッドシートID"
                style={{ ...inputStyle, fontSize: 12, marginBottom: 8 }}
              />
              <button
                onClick={async () => {
                  const r = await fetch(`/api/integrations/sheets/test?accountId=${account.id}`);
                  const d = await r.json();
                  updateAccount(setSheetsAccounts, account.id, { testResult: d.ok ? 'ok' : 'ng' });
                }}
                style={{ background: 'rgba(134,239,172,0.08)', border: '1px solid rgba(134,239,172,0.25)', color: '#86efac', borderRadius: 6, padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}
              >接続テスト</button>
              {account.testResult && <span style={{ fontSize: 11, marginLeft: 8, color: account.testResult === 'ok' ? '#22c55e' : '#ef4444' }}>{account.testResult === 'ok' ? '✓ 接続成功' : '✗ 失敗'}</span>}
            </div>
          ))}
          <button
            onClick={() => addAccount(setSheetsAccounts, { prefix: 'sheets-', name: 'スプレッドシート', credentials: null, sheets: {} })}
            style={{ background: 'rgba(134,239,172,0.08)', border: '1px solid rgba(134,239,172,0.25)', color: '#86efac', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
          >＋ Google Sheetsアカウントを追加</button>
        </div>

        {/* GA4 */}
        <div style={{ marginBottom: 24, padding: '14px', background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(51,65,85,0.4)', borderRadius: 10 }}>
          {serviceHeader('#fca5a5', 'Google Analytics 4')}
          {gaAccounts.map((account) => (
            <div key={account.id} style={{ background: 'rgba(6,13,26,0.5)', border: '1px solid rgba(252,165,165,0.2)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={account.name}
                  onChange={(e) => updateAccount(setGaAccounts, account.id, { name: e.target.value })}
                  placeholder="表示名"
                  style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                />
                <button
                  onClick={() => deleteAccount(setGaAccounts, account.id)}
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                >削除</button>
              </div>
              <textarea
                value={typeof account.credentials === 'string' ? account.credentials : (account.credentials ? JSON.stringify(account.credentials) : '')}
                onChange={(e) => {
                  let parsed = e.target.value;
                  try { parsed = JSON.parse(e.target.value); } catch {}
                  updateAccount(setGaAccounts, account.id, { credentials: parsed });
                }}
                placeholder="サービスアカウントJSON（{...}）"
                rows={3}
                style={{ ...inputStyle, fontSize: 11, marginBottom: 8, resize: 'vertical' }}
              />
              <input
                value={account.propertyId || ''}
                onChange={(e) => updateAccount(setGaAccounts, account.id, { propertyId: e.target.value })}
                placeholder="Property ID (例: 123456789)"
                style={{ ...inputStyle, fontSize: 12, marginBottom: 8 }}
              />
              <button
                onClick={async () => {
                  const config = { credentials: account.credentials, propertyId: account.propertyId };
                  if (!config.credentials || !config.propertyId) return;
                  const r = await fetch(`/api/integrations/ga4/test?accountId=${account.id}`);
                  const d = await r.json();
                  updateAccount(setGaAccounts, account.id, { testResult: d.ok ? 'ok' : 'ng' });
                }}
                style={{ background: 'rgba(252,165,165,0.08)', border: '1px solid rgba(252,165,165,0.25)', color: '#fca5a5', borderRadius: 6, padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}
              >接続テスト</button>
              {account.testResult && <span style={{ fontSize: 11, marginLeft: 8, color: account.testResult === 'ok' ? '#22c55e' : '#ef4444' }}>{account.testResult === 'ok' ? '✓ 接続成功' : '✗ 失敗'}</span>}
            </div>
          ))}
          <button
            onClick={() => addAccount(setGaAccounts, { prefix: 'ga-', name: 'GA4', propertyId: '' })}
            style={{ background: 'rgba(252,165,165,0.08)', border: '1px solid rgba(252,165,165,0.25)', color: '#fca5a5', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer' }}
          >＋ GA4プロパティを追加</button>
        </div>

        <button
          onClick={handleSave}
          style={{ background: saved ? '#22c55e' : '#38bdf8', border: 'none', borderRadius: 8, padding: '9px 24px', color: '#0c1a2e', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
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
  const [ready, setReady] = useState(null);
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#6b7280', background: '#060810' }}>
        読み込み中...
      </div>
    );
  }

  if (!ready) return <SetupWizard onComplete={() => setReady(true)} />;
  if (page === 'companies') return <CompanyManager onNavigate={setPage} />;
  if (page === 'routines') return <RoutineManager onNavigate={setPage} />;
  if (page === 'settings') return <SettingsPage onNavigate={setPage} />;
  return <Dashboard onNavigate={setPage} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
