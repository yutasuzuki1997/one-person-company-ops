import { useState, useEffect } from 'react';

const ROLE_OPTIONS = [
  { value: 'engineer', label: '⚙️ エンジニア (engineer)' },
  { value: 'designer', label: '🎨 デザイナー (designer)' },
  { value: 'marketer', label: '📣 マーケター (marketer)' },
  { value: 'researcher', label: '🔍 リサーチャー (researcher)' },
  { value: 'accountant', label: '💰 経理 (accountant)' },
  { value: 'legal', label: '⚖️ 法務 (legal)' },
  { value: 'project-manager', label: '📋 PM (project-manager)' },
  { value: 'custom', label: '🤖 カスタム (custom)' },
];

export default function AgentForm({ agent, onSubmit, onCancel }) {
  const [name, setName] = useState(agent?.name || '');
  const [role, setRole] = useState(agent?.role || 'engineer');
  const [jobDescription, setJobDescription] = useState(agent?.jobDescription || '');
  const [selectedSkills, setSelectedSkills] = useState(agent?.skills || []);
  const [selectedRepos, setSelectedRepos] = useState(agent?.repositories || []);
  const [skills, setSkills] = useState([]);
  const [repos, setRepos] = useState([]);

  useEffect(() => {
    fetch('/api/skills')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data.skills)) setSkills(data.skills); })
      .catch(() => {});

    fetch('/api/github/repositories')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data.repositories)) setRepos(data.repositories); })
      .catch(() => {});
  }, []);

  const toggleSkill = (skillId) => {
    setSelectedSkills((prev) =>
      prev.includes(skillId) ? prev.filter((s) => s !== skillId) : [...prev, skillId]
    );
  };

  const toggleRepo = (repoId) => {
    const id = String(repoId);
    setSelectedRepos((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !role) return;
    onSubmit({
      name: name.trim(),
      role,
      jobDescription: jobDescription.trim(),
      skills: selectedSkills,
      repositories: selectedRepos,
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: '#060810', color: '#e2e8f0', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{
        background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(51,65,85,0.6)',
        borderRadius: 14, padding: 32, width: '100%', maxWidth: 540,
      }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, marginBottom: 24, marginTop: 0 }}>
          {agent ? 'エージェントを編集' : 'エージェントを追加'}
        </h2>

        <form onSubmit={handleSubmit}>
          {/* 名前 */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>エージェント名 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：田中エンジニア"
              style={inputStyle}
              required
            />
          </div>

          {/* 役割 */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>役割 *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={inputStyle}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* ジョブディスクリプション */}
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>ジョブディスクリプション</label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="このエージェントの職務内容を記述してください"
              rows={4}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 100 }}
            />
          </div>

          {/* スキルファイル */}
          {skills.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>スキルファイル（複数選択可）</label>
              <div style={{
                background: 'rgba(6,13,26,0.6)', border: '1px solid rgba(51,65,85,0.5)',
                borderRadius: 8, padding: '10px 12px', maxHeight: 160, overflowY: 'auto',
              }}>
                {skills.map((s) => (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={selectedSkills.includes(s.id)}
                      onChange={() => toggleSkill(s.id)}
                      style={{ accentColor: '#38bdf8' }}
                    />
                    <span style={{ color: '#94a3b8' }}>{s.name}</span>
                    <span style={{ color: '#475569', fontSize: 11 }}>{s.path}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* リポジトリ */}
          {repos.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>関連リポジトリ（複数選択可）</label>
              <div style={{
                background: 'rgba(6,13,26,0.6)', border: '1px solid rgba(51,65,85,0.5)',
                borderRadius: 8, padding: '10px 12px', maxHeight: 160, overflowY: 'auto',
              }}>
                {repos.map((r) => (
                  <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={selectedRepos.includes(String(r.id))}
                      onChange={() => toggleRepo(r.id)}
                      style={{ accentColor: '#38bdf8' }}
                    />
                    <span style={{ color: '#94a3b8' }}>{r.name}</span>
                    <span style={{ color: '#475569', fontSize: 11 }}>({r.owner}/{r.repo})</span>
                    <span style={{ color: '#334155', fontSize: 10, marginLeft: 'auto' }}>{r.permission}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} style={cancelBtnStyle}>キャンセル</button>
            <button type="submit" style={submitBtnStyle}>
              {agent ? '更新' : '追加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 };

const inputStyle = {
  width: '100%', background: 'rgba(6,13,26,0.8)',
  border: '1px solid rgba(51,65,85,0.6)', borderRadius: 8,
  padding: '8px 12px', color: '#e2e8f0', fontSize: 13,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};

const submitBtnStyle = {
  background: '#38bdf8', border: 'none', borderRadius: 8,
  padding: '8px 20px', color: '#0c1a2e', fontWeight: 700,
  fontSize: 13, cursor: 'pointer',
};

const cancelBtnStyle = {
  background: 'rgba(71,85,105,0.3)', border: '1px solid rgba(71,85,105,0.5)',
  borderRadius: 8, padding: '8px 20px', color: '#94a3b8',
  fontSize: 13, cursor: 'pointer',
};
