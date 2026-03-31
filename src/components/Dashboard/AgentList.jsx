import AgentCard from './AgentCard';

export default function AgentList({ agents, onJdApprove, onJdReject }) {
  if (agents.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '60vh', color: '#334155', gap: 12,
      }}>
        <div style={{ fontSize: 40 }}>🤖</div>
        <div style={{ fontSize: 15 }}>エージェントがまだ登録されていません</div>
        <div style={{ fontSize: 12, color: '#1e293b' }}>
          エージェント管理からエージェントを追加してください
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 14,
      padding: 16,
    }}>
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          onJdApprove={onJdApprove}
          onJdReject={onJdReject}
        />
      ))}
    </div>
  );
}
