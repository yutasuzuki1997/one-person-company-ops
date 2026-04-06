import { useState, useEffect } from 'react';

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs > 0 ? rs + 's' : ''}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm > 0 ? rm + 'm' : ''}`;
}

function ElapsedTime({ since, style }) {
  const [elapsed, setElapsed] = useState(() => since ? Date.now() - new Date(since).getTime() : 0);
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setElapsed(Date.now() - new Date(since).getTime()), 1000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return null;
  return <span style={style}>{formatElapsed(elapsed)}</span>;
}
import AgentDetailModal from './AgentDetailModal';

const STATUS_LABELS = { idle: '待機中', working: '作業中', review: 'FB依頼あり', waiting: '承認待ち', error: 'エラー', completed: 'FB依頼あり', preparing: '準備中' };

// エージェントのroleから事業部を判定
function getDept(role) {
  if (!role) return 'その他';
  if (role.includes('社長室')) return '社長室';
  if (role.includes('BACKSTAGE')) return 'BACKSTAGE事業部';
  if (role.includes('個人')) return '個人事業部';
  if (role.includes('音楽')) return '音楽事業部';
  if (role.includes('委託')) return '業務委託事業部';
  if (role.includes('統括')) return '統括';
  return 'その他';
}

const DEPT_ORDER = ['社長室', 'BACKSTAGE事業部', '個人事業部', '音楽事業部', '業務委託事業部', '統括', 'その他'];
const DEPT_COLORS = {
  '社長室': '#38bdf8',
  'BACKSTAGE事業部': '#818cf8',
  '個人事業部': '#34d399',
  '音楽事業部': '#f472b6',
  '業務委託事業部': '#fb923c',
  '統括': '#fbbf24',
  'その他': '#64748b',
};

function AgentMiniCard({ agent, onClick, isStreaming }) {
  const status = agent.status || 'idle';
  return (
    <div
      onClick={onClick}
      style={{
        padding: '7px 9px', borderRadius: 7, cursor: 'pointer',
        background: 'rgba(15,23,42,0.5)',
        border: '1px solid rgba(51,65,85,0.3)',
        transition: 'all 0.15s',
        marginBottom: 3,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(100,150,255,0.4)'; e.currentTarget.style.background = 'rgba(15,23,42,0.8)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(51,65,85,0.3)'; e.currentTarget.style.background = 'rgba(15,23,42,0.5)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>{agent.avatar || '🤖'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.displayName || agent.name}
          </div>
          {status === 'working' && agent.currentTask && (
            <div style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agent.currentTask}
            </div>
          )}
        </div>
        <span className={`status-badge status-badge--${status}`} style={{ fontSize: 9, padding: '1px 5px' }}>
          <span className={`status-dot status-dot--${status}`} style={{ width: 5, height: 5 }} />
          {STATUS_LABELS[status] || status}
        </span>
      </div>
      {(status === 'working' || isStreaming) && agent.lastActiveAt && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ElapsedTime
            since={agent.lastActiveAt}
            style={{ fontSize: 9, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}
          />
          {isStreaming && (
            <span style={{ display: 'flex', gap: 2 }}>
              {[0, 0.15, 0.3].map((delay, i) => (
                <span key={i} style={{
                  width: 3, height: 3, borderRadius: '50%', background: '#38bdf8', display: 'inline-block',
                  animation: `stream-dot-panel 1s ease-in-out ${delay}s infinite`,
                }} />
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function DeptGroup({ deptName, agents, color, onAgentClick, activeAgents }) {
  const [collapsed, setCollapsed] = useState(false);
  const workingCount = agents.filter((a) => a.status === 'working').length;

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={() => setCollapsed((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 2px', marginBottom: collapsed ? 0 : 5,
        }}
      >
        <span style={{ fontSize: 9, color: collapsed ? '#475569' : '#334155' }}>{collapsed ? '▶' : '▼'}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1, textAlign: 'left' }}>
          {deptName}
        </span>
        <span style={{ fontSize: 10, color: '#475569' }}>{agents.length}名</span>
        {workingCount > 0 && (
          <span style={{ fontSize: 9, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>
            {workingCount}作業中
          </span>
        )}
      </button>
      {!collapsed && agents.map((a) => (
        <AgentMiniCard key={a.id} agent={a} onClick={() => onAgentClick(a)} isStreaming={activeAgents?.has(a.id)} />
      ))}
    </div>
  );
}

function ConfirmPanel({ confirms, onConfirm }) {
  if (!confirms?.length) return null;
  return (
    <div style={{
      margin: '0 10px 10px',
      borderRadius: 10,
      border: '1px solid rgba(239,68,68,0.3)',
      background: 'rgba(239,68,68,0.06)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '7px 10px',
        fontSize: 10, fontWeight: 700, color: '#ef4444',
        borderBottom: '1px solid rgba(239,68,68,0.2)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', animation: 'blink-dot 0.4s ease-in-out infinite', flexShrink: 0 }} />
        FB依頼 ({confirms.length})
      </div>
      {confirms.map((c) => (
        <div key={c.pendingId} style={{ padding: '8px 10px', borderBottom: '1px solid rgba(51,65,85,0.2)' }}>
          <div style={{ fontSize: 11, color: '#e2e8f0', marginBottom: 3 }}>{c.summary}</div>
          {c.agentName && <div style={{ fontSize: 10, color: '#64748b', marginBottom: 5 }}>{c.agentName}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onConfirm(c.pendingId, true)}
              style={{
                flex: 1, background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)',
                color: '#00cc6a', borderRadius: 5, padding: '4px 0', fontSize: 10, cursor: 'pointer', fontWeight: 700,
              }}
            >✓ 承認</button>
            <button
              onClick={() => onConfirm(c.pendingId, false)}
              style={{
                flex: 1, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#ef4444', borderRadius: 5, padding: '4px 0', fontSize: 10, cursor: 'pointer',
              }}
            >✕ 却下</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AgentPanel({ agents, companyId, activeAgents, onJdApprove, onJdReject, onAgentClick, pendingConfirms, onConfirm }) {
  const [selectedAgent, setSelectedAgent] = useState(null);

  const handleAgentClick = (agent) => {
    setSelectedAgent(agent);
    onAgentClick?.(agent);
  };

  // 事業部でグループ化（order順にソート）
  const grouped = {};
  for (const a of [...agents].sort((x, y) => (x.order ?? 999) - (y.order ?? 999))) {
    const dept = getDept(a.role);
    if (!grouped[dept]) grouped[dept] = [];
    grouped[dept].push(a);
  }

  const workingTotal = agents.filter((a) => a.status === 'working').length;

  return (
    <>
      <div className="dashboard-right">
        {/* ヘッダー */}
        <div style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid rgba(51,65,85,0.35)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#7dd3fc', flex: 1 }}>
              エージェント
            </span>
            <span style={{ fontSize: 11, color: '#475569' }}>{agents.length}名</span>
            {workingTotal > 0 && (
              <span style={{ fontSize: 11, background: 'rgba(56,189,248,0.12)', color: '#38bdf8', borderRadius: 5, padding: '2px 7px', fontWeight: 600 }}>
                {workingTotal}作業中
              </span>
            )}
          </div>
        </div>

        {/* FB依頼パネル */}
        {pendingConfirms?.length > 0 && (
          <div style={{ padding: '8px 0 0' }}>
            <ConfirmPanel confirms={pendingConfirms} onConfirm={onConfirm} />
          </div>
        )}

        {/* エージェントリスト（組織別） */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
          {agents.length === 0 ? (
            <div style={{ color: '#334155', fontSize: 12, textAlign: 'center', marginTop: 32 }}>
              エージェントがいません
            </div>
          ) : (
            DEPT_ORDER.filter((d) => grouped[d]?.length > 0).map((dept) => (
              <DeptGroup
                key={dept}
                deptName={dept}
                agents={grouped[dept]}
                color={DEPT_COLORS[dept] || '#64748b'}
                onAgentClick={handleAgentClick}
                activeAgents={activeAgents}
              />
            ))
          )}
        </div>
      </div>

      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          companyId={companyId}
          onClose={() => setSelectedAgent(null)}
          onJdApprove={(id) => { onJdApprove(id); setSelectedAgent(null); }}
          onJdReject={(id) => { onJdReject(id); setSelectedAgent(null); }}
        />
      )}
    </>
  );
}
