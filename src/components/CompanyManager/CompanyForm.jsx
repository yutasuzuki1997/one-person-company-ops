import { useState } from 'react';

export default function CompanyForm({ company, onSubmit, onCancel }) {
  const [name, setName] = useState(company?.name || '');
  const [description, setDescription] = useState(company?.description || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() });
  };

  return (
    <div style={{ minHeight: '100vh', background: '#060810', color: '#e2e8f0', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(51,65,85,0.6)',
        borderRadius: 14, padding: 32, width: 460,
      }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, marginBottom: 24, marginTop: 0 }}>
          {company ? '会社を編集' : '会社を追加'}
        </h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>会社名 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：wein company"
              style={inputStyle}
              required
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>説明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="会社の説明（任意）"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} style={cancelBtnStyle}>キャンセル</button>
            <button type="submit" style={submitBtnStyle}>
              {company ? '更新' : '作成'}
            </button>
          </div>
        </form>
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
