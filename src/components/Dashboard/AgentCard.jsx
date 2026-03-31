import './AgentCard.css';

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

const STATUS_LABELS = {
  idle: '待機中',
  working: '作業中',
  waiting: '待機待ち',
  error: 'エラー',
  completed: '完了',
};

export default function AgentCard({ agent, onJdApprove, onJdReject }) {
  const status = agent.status || 'idle';
  const progress = agent.progress || 0;
  const roleIcon = ROLE_ICONS[agent.role] || agent.avatar || '🤖';

  return (
    <div className="agent-card">
      {/* Header */}
      <div className="agent-card__header">
        <span className="agent-card__avatar">{roleIcon}</span>
        <div className="agent-card__meta">
          <div className="agent-card__name">{agent.name}</div>
          <div className="agent-card__role">{agent.role}</div>
        </div>
        <span className={`status-badge status-badge--${status}`}>
          <span className={`status-dot status-dot--${status}`} />
          {STATUS_LABELS[status] || status}
        </span>
      </div>

      {/* Progress bar */}
      <div className="agent-card__progress-bar">
        <div
          className="agent-card__progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Task & ETA */}
      <div className="agent-card__task">
        {agent.currentTask || '待機中'}
      </div>
      {agent.estimatedMinutes != null && (
        <div className="agent-card__eta">約{agent.estimatedMinutes}分</div>
      )}

      {/* JD pending banner */}
      {agent.pendingJdUpdate && (
        <div className="agent-card__jd-banner">
          <div className="agent-card__jd-banner-title">JD更新の提案があります</div>
          <div className="agent-card__jd-text">{agent.pendingJdUpdate}</div>
          <div className="agent-card__jd-buttons">
            <button className="btn-approve" onClick={() => onJdApprove(agent.id)}>承認</button>
            <button className="btn-reject" onClick={() => onJdReject(agent.id)}>却下</button>
          </div>
        </div>
      )}
    </div>
  );
}
