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
  working: '🟢 作業中',
  waiting: '待機待ち',
  error: 'エラー',
  completed: '✅ 完了',
};

// プロジェクト名 → 絵文字バッジ（JIGGY BEATS と 音楽事業 を分離）
const PROJECT_EMOJI = {
  'Overdue': '⏰',
  'Overdue.': '⏰',
  'BizSim': '🎮',
  'JIGGY BEATS': '🎺',
  'JIGGY': '🎺',
  'WAVERS': '🌊',
  'あげファンズ アシスタント': '🙌',
  'NoBorder App': '🌐',
  'RealValue App': '💹',
  'AIマーケ（秘匿事業）': '🕵️',
  '目標管理': '🎯',
  'エンジニア': '⚙️',
  '音楽事業': '🎼',
  'SNSマーケター': '📣',
};

function pickProjectEmoji(project) {
  if (!project) return '';
  if (PROJECT_EMOJI[project]) return PROJECT_EMOJI[project];
  for (const key of Object.keys(PROJECT_EMOJI)) {
    if (project.includes(key)) return PROJECT_EMOJI[key];
  }
  return '';
}

function formatElapsed(startedAt) {
  if (!startedAt) return '';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '〜1分';
  if (mins < 60) return `${mins}分`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${h}時間${rem}分`;
}

export default function AgentCard({ agent, onJdApprove, onJdReject }) {
  const status = agent.status || 'idle';
  const progress = agent.progress || 0;
  const roleIcon = ROLE_ICONS[agent.role] || agent.avatar || '🤖';
  const projectEmoji = pickProjectEmoji(agent.project);
  const elapsed = status === 'working' ? formatElapsed(agent.lastActiveAt || agent.startedAt) : '';

  return (
    <div className={`agent-card agent-card--${status}`}>
      {/* Header */}
      <div className="agent-card__header">
        <span className="agent-card__avatar">{roleIcon}</span>
        <div className="agent-card__meta">
          <div className="agent-card__name">
            {agent.name}
            {projectEmoji && <span className="agent-card__project-emoji" title={agent.project}>{projectEmoji}</span>}
          </div>
          <div className="agent-card__role" title={agent.project || ''}>{agent.role}</div>
        </div>
        <span className={`status-badge status-badge--${status}`}>
          <span className={`status-dot status-dot--${status}`} />
          {STATUS_LABELS[status] || status}
          {elapsed && <span className="status-elapsed">（{elapsed}）</span>}
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
