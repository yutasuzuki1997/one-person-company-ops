import { useState } from 'react';

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    overflowY: 'auto', padding: '24px 16px',
  },
  card: {
    background: '#fff', borderRadius: 14, padding: '36px 44px',
    width: 660, maxWidth: '98vw', boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
    margin: 'auto',
  },
  stepRow: { display: 'flex', alignItems: 'center', marginBottom: 32, gap: 0 },
  dot: (active, done) => ({
    width: 30, height: 30, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, flexShrink: 0,
    background: done ? '#22c55e' : active ? '#6366f1' : '#e5e7eb',
    color: done || active ? '#fff' : '#6b7280',
  }),
  line: (done) => ({ flex: 1, height: 2, background: done ? '#22c55e' : '#e5e7eb' }),
  title: { fontSize: 20, fontWeight: 700, marginBottom: 6, color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', marginBottom: 24 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 5 },
  input: {
    width: '100%', padding: '9px 12px', border: '1px solid #d1d5db',
    borderRadius: 7, fontSize: 14, outline: 'none', boxSizing: 'border-box',
    color: '#111827',
  },
  inputSm: {
    padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6,
    fontSize: 13, outline: 'none', color: '#111827', boxSizing: 'border-box', width: '100%',
  },
  row: { display: 'flex', alignItems: 'center', gap: 10 },
  btnPrimary: {
    padding: '9px 20px', background: '#6366f1', color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  },
  btnSecondary: {
    padding: '9px 18px', background: '#f3f4f6', color: '#374151', border: 'none',
    borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  },
  btnSmall: {
    padding: '6px 13px', background: '#e0e7ff', color: '#4338ca', border: 'none',
    borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  },
  btnDanger: {
    padding: '6px 12px', background: '#fee2e2', color: '#dc2626', border: 'none',
    borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
  },
  btnSuccess: {
    padding: '12px 28px', background: '#22c55e', color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', width: '100%',
  },
  ok: { fontSize: 13, color: '#16a34a', fontWeight: 600 },
  ng: { fontSize: 13, color: '#dc2626', fontWeight: 600 },
  info: { fontSize: 13, color: '#6366f1', fontWeight: 600 },
  footer: { display: 'flex', justifyContent: 'space-between', marginTop: 16 },
  repoList: {
    maxHeight: 220, overflowY: 'auto', border: '1px solid #e5e7eb',
    borderRadius: 8, padding: '8px 12px', marginTop: 8, marginBottom: 4,
  },
  repoItem: { padding: '6px 0', borderBottom: '1px solid #f3f4f6' },
  repoInputs: { display: 'flex', gap: 8, marginTop: 6, marginLeft: 22 },
  sectionBox: {
    border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 18px', marginBottom: 16,
  },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 12 },
  tag: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 12,
    fontSize: 12, fontWeight: 600, background: '#e0e7ff', color: '#4338ca', marginLeft: 6,
  },
  tagCompany: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 12,
    fontSize: 12, fontWeight: 600, background: '#fef3c7', color: '#92400e', marginLeft: 6,
  },
};

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(1);

  // ── Step 1 ──
  const [userName, setUserName] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicStatus, setAnthropicStatus] = useState(null); // null | 'ok' | 'ng'
  const [anthropicMsg, setAnthropicMsg] = useState('');
  const [anthropicLoading, setAnthropicLoading] = useState(false);

  // ── Step 2: 個人トークン ──
  const [personalToken, setPersonalToken] = useState('');
  const [personalRepos, setPersonalRepos] = useState(null);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [personalError, setPersonalError] = useState('');
  // { [repoId]: { checked, displayName, description } }
  const [personalSel, setPersonalSel] = useState({});

  // ── Step 2: 会社用トークン（複数） ──
  // [ { token: string } ]
  const [companyTokens, setCompanyTokens] = useState([{ token: '' }]);
  // { [idx]: repos[] }
  const [companyRepos, setCompanyRepos] = useState({});
  // { [idx]: boolean }
  const [companyLoading, setCompanyLoading] = useState({});
  // { [idx]: string }
  const [companyErrors, setCompanyErrors] = useState({});
  // { [`${idx}-${repoId}`]: { checked, displayName, description } }
  const [companySel, setCompanySel] = useState({});

  // ── Step 3: ワークスペース設定 ──
  const [wsOwner, setWsOwner] = useState('yutasuzuki1997');
  const [wsRepo, setWsRepo] = useState('Workspace');
  const [wsStatus, setWsStatus] = useState(null); // null | 'ok' | 'ng'
  const [wsMsg, setWsMsg] = useState('');
  const [wsLoading, setWsLoading] = useState(false);

  // ── Step 4: Notion設定（任意） ──
  const [notionToken, setNotionToken] = useState('');
  const [notionTest, setNotionTest] = useState(null);
  const [notionDatabases, setNotionDatabases] = useState([]);
  const [notionSelectedDbs, setNotionSelectedDbs] = useState({});

  // ── Step 5: Google Sheets設定（任意） ──
  const [sheetsCredentials, setSheetsCredentials] = useState('');
  const [sheetsSpreadsheetId, setSheetsSpreadsheetId] = useState('');
  const [sheetsTest, setSheetsTest] = useState(null);

  // ── Step 6 ──
  const [selectedRepos, setSelectedRepos] = useState([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ── Helpers ──

  const testAnthropic = async () => {
    setAnthropicLoading(true);
    setAnthropicStatus(null);
    setAnthropicMsg('');
    try {
      const res = await fetch('/api/settings/test-anthropic', {
        headers: { 'x-api-key': anthropicKey },
      });
      const data = await res.json();
      if (data.ok) {
        setAnthropicStatus('ok');
        setAnthropicMsg('接続成功');
      } else {
        setAnthropicStatus('ng');
        setAnthropicMsg(data.error || '接続失敗');
      }
    } catch {
      setAnthropicStatus('ng');
      setAnthropicMsg('接続エラー');
    } finally {
      setAnthropicLoading(false);
    }
  };

  const fetchPersonalRepos = async () => {
    if (!personalToken.trim()) return;
    setPersonalLoading(true);
    setPersonalError('');
    try {
      const res = await fetch(`/api/github/repos?token=${encodeURIComponent(personalToken)}&tokenType=personal`);
      const data = await res.json();
      if (res.ok && data.repos) {
        setPersonalRepos(data.repos);
      } else {
        setPersonalError(data.error || 'リポジトリ取得に失敗しました');
        setPersonalRepos([]);
      }
    } catch {
      setPersonalError('接続エラー');
      setPersonalRepos([]);
    } finally {
      setPersonalLoading(false);
    }
  };

  const fetchCompanyRepos = async (idx) => {
    const tok = companyTokens[idx]?.token;
    if (!tok?.trim()) return;
    setCompanyLoading((p) => ({ ...p, [idx]: true }));
    setCompanyErrors((p) => ({ ...p, [idx]: '' }));
    try {
      const res = await fetch(`/api/github/repos?token=${encodeURIComponent(tok)}&tokenType=company`);
      const data = await res.json();
      if (res.ok && data.repos) {
        setCompanyRepos((p) => ({ ...p, [idx]: data.repos }));
      } else {
        setCompanyErrors((p) => ({ ...p, [idx]: data.error || 'リポジトリ取得に失敗しました' }));
        setCompanyRepos((p) => ({ ...p, [idx]: [] }));
      }
    } catch {
      setCompanyErrors((p) => ({ ...p, [idx]: '接続エラー' }));
      setCompanyRepos((p) => ({ ...p, [idx]: [] }));
    } finally {
      setCompanyLoading((p) => ({ ...p, [idx]: false }));
    }
  };

  const setPersonalSelField = (repoId, field, value) => {
    setPersonalSel((p) => ({
      ...p,
      [repoId]: { ...p[repoId], [field]: value },
    }));
  };

  const setCompanySelField = (key, field, value) => {
    setCompanySel((p) => ({
      ...p,
      [key]: { ...p[key], [field]: value },
    }));
  };

  const buildSelectedRepos = () => {
    const result = [];
    if (personalRepos) {
      for (const repo of personalRepos) {
        const sel = personalSel[repo.id];
        if (!sel?.checked) continue;
        const [owner] = repo.full_name.split('/');
        result.push({
          id: String(repo.id),
          name: sel.displayName?.trim() || repo.name,
          owner,
          repo: repo.name,
          tokenType: 'personal',
          description: sel.description?.trim() || repo.description || '',
          permission: sel.permission || 'read',
        });
      }
    }
    companyTokens.forEach((_, idx) => {
      const repos = companyRepos[idx];
      if (!repos) return;
      for (const repo of repos) {
        const key = `${idx}-${repo.id}`;
        const sel = companySel[key];
        if (!sel?.checked) continue;
        const [owner] = repo.full_name.split('/');
        result.push({
          id: String(repo.id),
          name: sel.displayName?.trim() || repo.name,
          owner,
          repo: repo.name,
          tokenType: 'company',
          description: sel.description?.trim() || repo.description || '',
          permission: sel.permission || 'read',
        });
      }
    });
    return result;
  };

  const testWorkspaceInit = async () => {
    setWsLoading(true);
    setWsStatus(null);
    setWsMsg('');
    try {
      const res = await fetch('/api/workspace/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: wsOwner, repo: wsRepo }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setWsStatus('ok');
        setWsMsg('Workspaceリポジトリに接続しました');
      } else {
        setWsStatus('ng');
        setWsMsg(data.error || '接続に失敗しました');
      }
    } catch {
      setWsStatus('ng');
      setWsMsg('接続エラー');
    } finally {
      setWsLoading(false);
    }
  };

  const goToStep3 = () => {
    setStep(3);
  };

  const testNotionToken = async () => {
    setNotionTest('testing');
    try {
      const r = await fetch('/api/integrations/notion/test', { headers: { 'x-notion-token': notionToken } });
      const d = await r.json();
      setNotionTest(d.ok ? 'ok' : 'ng');
      if (d.ok) {
        // データベースを取得
        const r2 = await fetch('/api/integrations/notion/databases', { headers: { 'x-notion-token': notionToken } });
        const d2 = await r2.json();
        if (d2.success) setNotionDatabases(d2.databases || []);
      }
    } catch { setNotionTest('ng'); }
  };

  const testSheetsConnection = async () => {
    setSheetsTest('testing');
    try {
      // 一時的にsettingsに保存して接続テスト
      const r = await fetch('/api/integrations/sheets/test');
      const d = await r.json();
      setSheetsTest(d.ok ? 'ok' : 'ng');
    } catch { setSheetsTest('ng'); }
  };

  const saveSettings = async () => {
    setSaveLoading(true);
    setSaveError('');
    try {
      const integrations = {};
      if (notionToken.trim()) {
        const selectedDbs = Object.entries(notionSelectedDbs).filter(([, v]) => v).map(([id]) => id);
        integrations.notion = [{ id: 'notion-001', name: 'Notion', token: notionToken, selectedDatabases: selectedDbs }];
      }
      if (sheetsCredentials.trim()) {
        let creds = sheetsCredentials;
        try { creds = JSON.parse(sheetsCredentials); } catch {}
        integrations.googleSheets = [{ id: 'sheets-001', name: 'スプレッドシート', credentials: creds, spreadsheetId: sheetsSpreadsheetId }];
      }
      const settingsRes = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anthropicApiKey: anthropicKey,
          githubPersonalToken: personalToken,
          githubCompanyToken: companyTokens[0]?.token || '',
          userName,
          integrations,
        }),
      });
      if (!settingsRes.ok) {
        const d = await settingsRes.json().catch(() => ({}));
        throw new Error(d.error || '設定保存に失敗しました');
      }
      const reposRes = await fetch('/api/github/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositories: selectedRepos }),
      });
      if (!reposRes.ok) {
        const d = await reposRes.json().catch(() => ({}));
        throw new Error(d.error || 'リポジトリ保存に失敗しました');
      }
      if (wsOwner.trim() && wsRepo.trim()) {
        await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owner: wsOwner.trim(), repo: wsRepo.trim(), tokenType: 'personal', localPath: '' }),
        });
      }
      onComplete();
    } catch (e) {
      setSaveError(e.message || '保存中にエラーが発生しました');
    } finally {
      setSaveLoading(false);
    }
  };

  const canNext1 = anthropicKey.trim() !== '';
  const canNext2 = personalToken.trim() !== '' || companyTokens.some((t) => t.token.trim() !== '');

  // ── Repo list render helper ──
  const renderRepoList = (repos, selMap, onCheck, onNameChange, onDescChange, onPermChange) => {
    if (!repos || repos.length === 0) return null;
    return (
      <div style={s.repoList}>
        {repos.map((repo) => {
          const sel = selMap[repo.id] || {};
          return (
            <div key={repo.id} style={s.repoItem}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!!sel.checked}
                  onChange={(e) => onCheck(repo.id, e.target.checked)}
                  style={{ width: 15, height: 15, flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: '#111827', fontWeight: sel.checked ? 600 : 400 }}>
                  {repo.full_name}
                </span>
                {repo.private && <span style={{ fontSize: 11, color: '#9ca3af' }}>private</span>}
              </label>
              {sel.checked && (
                <div style={s.repoInputs}>
                  <input
                    type="text"
                    placeholder="表示名（例：営業管理）"
                    value={sel.displayName || ''}
                    onChange={(e) => onNameChange(repo.id, e.target.value)}
                    style={{ ...s.inputSm, flex: 1 }}
                  />
                  <input
                    type="text"
                    placeholder="説明（任意）"
                    value={sel.description || ''}
                    onChange={(e) => onDescChange(repo.id, e.target.value)}
                    style={{ ...s.inputSm, flex: 1.4 }}
                  />
                  <select
                    value={sel.permission || 'read'}
                    onChange={(e) => onPermChange(repo.id, e.target.value)}
                    style={{ ...s.inputSm, flex: '0 0 auto', padding: '7px 6px', cursor: 'pointer' }}
                  >
                    <option value="read">読むだけ</option>
                    <option value="write">ファイル編集まで</option>
                    <option value="pr">PR作成まで</option>
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Render ──

  return (
    <div style={s.overlay}>
      <div style={s.card}>

        {/* ステップインジケーター */}
        <div style={s.stepRow}>
          {[1, 2, 3, 4, 5, 6].map((n, i) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', flex: i < 5 ? 1 : 'none' }}>
              <div style={s.dot(step === n, step > n)}>{step > n ? '✓' : n}</div>
              {i < 5 && <div style={s.line(step > n)} />}
            </div>
          ))}
        </div>

        {/* ── STEP 1: Anthropic APIキー ── */}
        {step === 1 && (
          <div>
            <div style={s.title}>基本設定</div>
            <div style={s.subtitle}>表示名とAnthropicのAPIキーを設定してください。</div>
            <label style={s.label}>表示名</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="表示名（例：Yuta Suzuki）"
              style={{ ...s.input, marginBottom: 16 }}
              autoComplete="off"
            />
            <label style={s.label}>Anthropic APIキー</label>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder="sk-ant-..."
              style={{ ...s.input, marginBottom: 14 }}
              autoComplete="off"
            />
            <div style={{ ...s.row, marginBottom: 4 }}>
              <button
                style={s.btnSmall}
                onClick={testAnthropic}
                disabled={!anthropicKey.trim() || anthropicLoading}
              >
                {anthropicLoading ? '確認中...' : '接続テスト'}
              </button>
              {anthropicStatus === 'ok' && <span style={s.ok}>✓ {anthropicMsg}</span>}
              {anthropicStatus === 'ng' && <span style={s.ng}>✗ {anthropicMsg}</span>}
            </div>
            <div style={s.footer}>
              <span />
              <button
                style={{ ...s.btnPrimary, opacity: canNext1 ? 1 : 0.45 }}
                onClick={() => setStep(2)}
                disabled={!canNext1}
              >
                次へ →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: GitHubトークン ── */}
        {step === 2 && (
          <div>
            <div style={s.title}>GitHubトークンの設定</div>
            <div style={s.subtitle}>
              リポジトリへのアクセスに使うトークンを入力し、使用するリポジトリを選択してください。
            </div>

            {/* 個人用 */}
            <div style={s.sectionBox}>
              <div style={s.sectionTitle}>個人用トークン</div>
              <div style={{ ...s.row, marginBottom: 8 }}>
                <input
                  type="password"
                  value={personalToken}
                  onChange={(e) => setPersonalToken(e.target.value)}
                  placeholder="ghp_..."
                  style={{ ...s.input, marginBottom: 0, flex: 1 }}
                  autoComplete="off"
                />
                <button
                  style={s.btnSmall}
                  onClick={fetchPersonalRepos}
                  disabled={!personalToken.trim() || personalLoading}
                >
                  {personalLoading ? '取得中...' : 'リポジトリを取得'}
                </button>
              </div>
              {personalError && <div style={s.ng}>{personalError}</div>}
              {personalRepos && personalRepos.length === 0 && (
                <div style={{ fontSize: 13, color: '#9ca3af' }}>リポジトリが見つかりませんでした</div>
              )}
              {renderRepoList(
                personalRepos,
                personalSel,
                (id, checked) => setPersonalSelField(id, 'checked', checked),
                (id, v) => setPersonalSelField(id, 'displayName', v),
                (id, v) => setPersonalSelField(id, 'description', v),
                (id, v) => setPersonalSelField(id, 'permission', v),
              )}
              {personalRepos && (
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                  {personalRepos.length} 件取得 ／ チェックしたリポジトリを登録します
                </div>
              )}
            </div>

            {/* 会社用（複数） */}
            {companyTokens.map((ct, idx) => (
              <div key={idx} style={s.sectionBox}>
                <div style={{ ...s.row, marginBottom: 12, justifyContent: 'space-between' }}>
                  <div style={s.sectionTitle}>会社用トークン {companyTokens.length > 1 ? idx + 1 : ''}</div>
                  {companyTokens.length > 1 && (
                    <button
                      style={s.btnDanger}
                      onClick={() => {
                        setCompanyTokens((p) => p.filter((_, i) => i !== idx));
                        setCompanyRepos((p) => {
                          const n = { ...p };
                          delete n[idx];
                          return n;
                        });
                      }}
                    >
                      削除
                    </button>
                  )}
                </div>
                <div style={{ ...s.row, marginBottom: 8 }}>
                  <input
                    type="password"
                    value={ct.token}
                    onChange={(e) =>
                      setCompanyTokens((p) =>
                        p.map((t, i) => (i === idx ? { ...t, token: e.target.value } : t))
                      )
                    }
                    placeholder="ghp_..."
                    style={{ ...s.input, marginBottom: 0, flex: 1 }}
                    autoComplete="off"
                  />
                  <button
                    style={s.btnSmall}
                    onClick={() => fetchCompanyRepos(idx)}
                    disabled={!ct.token.trim() || !!companyLoading[idx]}
                  >
                    {companyLoading[idx] ? '取得中...' : 'リポジトリを取得'}
                  </button>
                </div>
                {companyErrors[idx] && <div style={s.ng}>{companyErrors[idx]}</div>}
                {companyRepos[idx] && companyRepos[idx].length === 0 && (
                  <div style={{ fontSize: 13, color: '#9ca3af' }}>リポジトリが見つかりませんでした</div>
                )}
                {renderRepoList(
                  companyRepos[idx],
                  Object.fromEntries(
                    Object.entries(companySel)
                      .filter(([k]) => k.startsWith(`${idx}-`))
                      .map(([k, v]) => [k.slice(`${idx}-`.length), v])
                  ),
                  (repoId, checked) => setCompanySelField(`${idx}-${repoId}`, 'checked', checked),
                  (repoId, v) => setCompanySelField(`${idx}-${repoId}`, 'displayName', v),
                  (repoId, v) => setCompanySelField(`${idx}-${repoId}`, 'description', v),
                  (repoId, v) => setCompanySelField(`${idx}-${repoId}`, 'permission', v),
                )}
                {companyRepos[idx] && (
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>
                    {companyRepos[idx].length} 件取得 ／ チェックしたリポジトリを登録します
                  </div>
                )}
              </div>
            ))}

            <button
              style={{ ...s.btnSmall, marginBottom: 8 }}
              onClick={() => setCompanyTokens((p) => [...p, { token: '' }])}
            >
              ＋ 会社用トークンを追加
            </button>

            <div style={s.footer}>
              <button style={s.btnSecondary} onClick={() => setStep(1)}>← 戻る</button>
              <button
                style={{ ...s.btnPrimary, opacity: canNext2 ? 1 : 0.45 }}
                onClick={goToStep3}
                disabled={!canNext2}
              >
                次へ →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: ワークスペース設定 ── */}
        {step === 3 && (
          <div>
            <div style={s.title}>ワークスペース設定</div>
            <div style={s.subtitle}>
              データを同期するWorkspaceリポジトリを設定してください。
            </div>
            <div style={s.sectionBox}>
              <div style={s.sectionTitle}>ワークスペースリポジトリ</div>
              <label style={s.label}>オーナー（owner）</label>
              <input
                type="text"
                value={wsOwner}
                onChange={(e) => setWsOwner(e.target.value)}
                placeholder="yutasuzuki1997"
                style={{ ...s.input, marginBottom: 12 }}
                autoComplete="off"
              />
              <label style={s.label}>リポジトリ名（repo）</label>
              <input
                type="text"
                value={wsRepo}
                onChange={(e) => setWsRepo(e.target.value)}
                placeholder="Workspace"
                style={{ ...s.input, marginBottom: 14 }}
                autoComplete="off"
              />
              <div style={{ ...s.row, marginBottom: 4 }}>
                <button
                  style={s.btnSmall}
                  onClick={testWorkspaceInit}
                  disabled={!wsOwner.trim() || !wsRepo.trim() || wsLoading}
                >
                  {wsLoading ? '接続中...' : '接続テスト'}
                </button>
                {wsStatus === 'ok' && <span style={s.ok}>✓ {wsMsg}</span>}
                {wsStatus === 'ng' && <span style={s.ng}>✗ {wsMsg}</span>}
              </div>
            </div>
            <div style={s.footer}>
              <button style={s.btnSecondary} onClick={() => setStep(2)}>← 戻る</button>
              <button style={s.btnPrimary} onClick={() => setStep(4)}>次へ →</button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Notion設定（任意） ── */}
        {step === 4 && (
          <div>
            <div style={s.title}>Notion連携（任意）</div>
            <div style={s.subtitle}>NotionのIntegration Tokenを入力してデータベースを選択してください。</div>
            <div style={s.sectionBox}>
              <label style={s.label}>Integration Token</label>
              <div style={{ ...s.row, marginBottom: 8 }}>
                <input
                  type="password"
                  value={notionToken}
                  onChange={(e) => setNotionToken(e.target.value)}
                  placeholder="secret_..."
                  style={{ ...s.input, marginBottom: 0, flex: 1 }}
                />
                <button
                  style={s.btnSmall}
                  onClick={testNotionToken}
                  disabled={!notionToken.trim() || notionTest === 'testing'}
                >
                  {notionTest === 'testing' ? '確認中...' : '接続テスト'}
                </button>
              </div>
              {notionTest === 'ok' && <span style={s.ok}>✓ 接続成功</span>}
              {notionTest === 'ng' && <span style={s.ng}>✗ 接続失敗</span>}
              {notionDatabases.length > 0 && (
                <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>使用するデータベース：</div>
                  {notionDatabases.map((db) => (
                    <label key={db.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!notionSelectedDbs[db.id]}
                        onChange={(e) => setNotionSelectedDbs((p) => ({ ...p, [db.id]: e.target.checked }))}
                      />
                      <span style={{ fontSize: 13, color: '#111827' }}>{db.title}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div style={s.footer}>
              <button style={s.btnSecondary} onClick={() => setStep(3)}>← 戻る</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={s.btnSecondary} onClick={() => setStep(5)}>スキップ</button>
                <button style={s.btnPrimary} onClick={() => setStep(5)}>次へ →</button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 5: Google Sheets設定（任意） ── */}
        {step === 5 && (
          <div>
            <div style={s.title}>Google Sheets連携（任意）</div>
            <div style={s.subtitle}>サービスアカウントJSONとスプレッドシートIDを入力してください。</div>
            <div style={s.sectionBox}>
              <label style={s.label}>サービスアカウントJSON</label>
              <textarea
                value={sheetsCredentials}
                onChange={(e) => setSheetsCredentials(e.target.value)}
                placeholder='{"type":"service_account","project_id":"...","client_email":"...",...}'
                rows={4}
                style={{ ...s.input, resize: 'vertical', fontFamily: 'monospace', fontSize: 11, marginBottom: 12 }}
              />
              <label style={s.label}>スプレッドシートID</label>
              <div style={{ ...s.row, marginBottom: 8 }}>
                <input
                  value={sheetsSpreadsheetId}
                  onChange={(e) => setSheetsSpreadsheetId(e.target.value)}
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                  style={{ ...s.input, marginBottom: 0, flex: 1 }}
                />
                <button
                  style={s.btnSmall}
                  onClick={testSheetsConnection}
                  disabled={!sheetsCredentials.trim() || sheetsTest === 'testing'}
                >
                  {sheetsTest === 'testing' ? '確認中...' : '接続テスト'}
                </button>
              </div>
              {sheetsTest === 'ok' && <span style={s.ok}>✓ 接続成功</span>}
              {sheetsTest === 'ng' && <span style={s.ng}>✗ 接続失敗</span>}
            </div>
            <div style={s.footer}>
              <button style={s.btnSecondary} onClick={() => setStep(4)}>← 戻る</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={s.btnSecondary} onClick={() => { setSelectedRepos(buildSelectedRepos()); setStep(6); }}>スキップ</button>
                <button style={s.btnPrimary} onClick={() => { setSelectedRepos(buildSelectedRepos()); setStep(6); }}>次へ →</button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 6: 確認・完了 ── */}
        {step === 6 && (
          <div>
            <div style={{ fontSize: 52, textAlign: 'center', marginBottom: 12 }}>🎉</div>
            <div style={s.title}>セットアップ完了</div>
            <div style={{ ...s.subtitle, marginBottom: 16 }}>設定内容を確認して保存してください。</div>

            <div style={s.sectionBox}>
              <div style={s.sectionTitle}>設定サマリー</div>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
                <div>Anthropic API: {anthropicKey ? '✓ 設定済み' : '✗ 未設定'}</div>
                <div>GitHub Personal: {personalToken ? '✓ 設定済み' : '✗ 未設定'}</div>
                <div>Workspace: {wsOwner}/{wsRepo}</div>
                <div>Notion: {notionToken ? '✓ 設定済み' : 'スキップ'}</div>
                <div>Google Sheets: {sheetsCredentials ? '✓ 設定済み' : 'スキップ'}</div>
                {selectedRepos.length > 0 && <div>登録リポジトリ: {selectedRepos.length} 件</div>}
              </div>
            </div>

            {saveError && (
              <div style={{ ...s.ng, marginBottom: 14, textAlign: 'center' }}>{saveError}</div>
            )}
            <button
              style={{ ...s.btnSuccess, opacity: saveLoading ? 0.7 : 1 }}
              onClick={saveSettings}
              disabled={saveLoading}
            >
              {saveLoading ? '保存中...' : 'セットアップ完了'}
            </button>
            <div style={{ ...s.footer, marginTop: 16 }}>
              <button style={s.btnSecondary} onClick={() => setStep(5)}>← 戻る</button>
              <span />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
