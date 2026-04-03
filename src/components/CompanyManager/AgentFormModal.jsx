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

export default function AgentFormModal({ agent, section, sections, companyId, onClose, onSave, onDelete }) {
  const [name, setName] = useState(agent?.name || '');
  const [role, setRole] = useState(agent?.role || 'engineer');
  const [sectionId, setSectionId] = useState(section?.id || sections?.[0]?.id || '');
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

  const toggleSkill = (id) => setSelectedSkills((p) => p.includes(id) ? p.filter((s) => s !== id) : [...p, id]);
  const toggleRepo = (id) => {
    const sid = String(id);
    setSelectedRepos((p) => p.includes(sid) ? p.filter((r) => r !== sid) : [...p, sid]);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      role,
      jobDescription: jobDescription.trim(),
      skills: selectedSkills,
      repositories: selectedRepos,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 560, maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 700, marginBottom: 20, marginTop: 0 }}>
          {agent ? 'エージェントを編集' : 'エージェントを追加'}
        </h3>

        {/* 名前 */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>エージェント名 *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：田中エンジニア" style={inputStyle} />
        </div>

        {/* 役割 */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>役割 *</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
            {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* 所属セクション */}
        {sections?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>所属セクション</label>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={inputStyle}>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {/* JD */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>ジョブディスクリプション</label>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="職務内容を記述してください"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 90 }}
          />
        </div>

        {/* スキルファイル */}
        {skills.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>スキルファイル（複数選択可）</label>
            <div style={checkboxContainer}>
              {skills.map((s) => (
                <label key={s.id} style={checkboxLabel}>
                  <input type="checkbox" checked={selectedSkills.includes(s.id)} onChange={() => toggleSkill(s.id)} style={{ accentColor: '#38bdf8' }} />
                  <span style={{ color: '#94a3b8' }}>{s.name}</span>
                  <span style={{ color: '#475569', fontSize: 10 }}>{s.path}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* リポジトリ */}
        {repos.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>関連リポジトリ（複数選択可）</label>
            <div style={checkboxContainer}>
              {repos.map((r) => (
                <label key={r.id} style={checkboxLabel}>
                  <input type="checkbox" checked={selectedRepos.includes(String(r.id))} onChange={() => toggleRepo(r.id)} style={{ accentColor: '#38bdf8' }} />
                  <span style={{ color: '#94a3b8' }}>{r.name}</span>
                  <span style={{ color: '#475569', fontSize: 10 }}>({r.owner}/{r.repo})</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <div>
            {onDelete && (
              <button
                onClick={onDelete}
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}
              >削除</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} className="btn-ghost">キャンセル</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={!name.trim()}>
              {agent ? '保存' : '追加'}
            </button>
          </div>
        </div>
      </div>
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
const checkboxContainer = {
  background: 'rgba(6,13,26,0.6)', border: '1px solid rgba(51,65,85,0.5)',
  borderRadius: 8, padding: '8px 12px', maxHeight: 140, overflowY: 'auto',
};
const checkboxLabel = { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: 'pointer', fontSize: 12 };
