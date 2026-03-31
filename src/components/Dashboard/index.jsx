import { useState, useEffect, useRef } from 'react';
import Background from './Background';
import AgentList from './AgentList';
import SecretaryChat from './SecretaryChat';

export default function Dashboard({ onNavigate }) {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [agents, setAgents] = useState([]);
  const [wsStatus, setWsStatus] = useState('connecting');
  const wsRef = useRef(null);

  // 会社一覧取得
  useEffect(() => {
    fetch('/api/companies')
      .then((r) => r.json())
      .then((list) => {
        if (!Array.isArray(list)) return;
        setCompanies(list);
        if (list.length > 0) setCompanyId((prev) => prev || list[0].id);
      })
      .catch(() => {});
  }, []);

  // エージェント一覧取得
  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/companies/${companyId}/agents`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAgents(data); })
      .catch(() => {});
  }, [companyId]);

  // WebSocket接続（リアルタイム更新）
  useEffect(() => {
    if (!companyId) return;
    if (wsRef.current) wsRef.current.close();

    setWsStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // Vite dev server（5173）の場合はバックエンドの3000ポートに直接接続
    const wsHost = (import.meta.env.DEV && location.port === '5173')
      ? `${location.hostname}:3000`
      : location.host;
    const ws = new WebSocket(`${proto}://${wsHost}?companyId=${companyId}`);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('open');
    ws.onclose = () => setWsStatus('closed');
    ws.onerror = () => setWsStatus('closed');

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'agents') {
        setAgents(msg.agents || []);
      } else if (msg.type === 'agent_status') {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === msg.agentId
              ? {
                  ...a,
                  status: msg.status ?? a.status,
                  progress: msg.progress ?? a.progress,
                  estimatedMinutes: msg.estimatedMinutes !== undefined ? msg.estimatedMinutes : a.estimatedMinutes,
                  currentTask: msg.currentTask ?? a.currentTask,
                  lastMessage: msg.lastMessage ?? a.lastMessage,
                  lastActiveAt: msg.lastActiveAt ?? a.lastActiveAt,
                }
              : a
          )
        );
      } else if (msg.type === 'jd_proposal') {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === msg.agentId ? { ...a, pendingJdUpdate: msg.proposedJd } : a
          )
        );
      }
    };

    return () => {
      ws.onclose = null;
      ws.close();
    };
  }, [companyId]);

  const handleJdApprove = async (agentId) => {
    await fetch(`/api/agents/${agentId}/jd-approve`, { method: 'POST' });
    setAgents((prev) =>
      prev.map((a) =>
        a.id === agentId ? { ...a, jobDescription: a.pendingJdUpdate, pendingJdUpdate: null } : a
      )
    );
  };

  const handleJdReject = async (agentId) => {
    await fetch(`/api/agents/${agentId}/jd-reject`, { method: 'POST' });
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, pendingJdUpdate: null } : a))
    );
  };

  const wsStatusColor = { connecting: '#f59e0b', open: '#22c55e', closed: '#ef4444' }[wsStatus];

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      color: '#e2e8f0', fontFamily: "'Inter', 'Helvetica Neue', sans-serif",
      position: 'relative', overflow: 'hidden',
    }}>
      <Background />

      {/* ヘッダー */}
      <header style={{
        padding: '10px 20px', borderBottom: '1px solid rgba(51,65,85,0.45)',
        display: 'flex', alignItems: 'center', gap: 14,
        background: 'rgba(6,13,26,0.88)', backdropFilter: 'blur(10px)',
        flexShrink: 0, zIndex: 2, position: 'relative',
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#7dd3fc', whiteSpace: 'nowrap' }}>
          One-Company Ops
        </span>

        {/* 会社セレクタ */}
        {companies.length > 0 && (
          <select
            value={companyId || ''}
            onChange={(e) => setCompanyId(e.target.value)}
            style={{
              background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(51,65,85,0.55)',
              borderRadius: 6, color: '#e2e8f0', padding: '4px 10px',
              fontSize: 12, cursor: 'pointer', outline: 'none',
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.id}</option>
            ))}
          </select>
        )}

        <span style={{ color: '#475569', fontSize: 11 }}>
          {agents.length} エージェント
        </span>

        {/* WS ステータス */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b' }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: wsStatusColor,
            boxShadow: wsStatus === 'open' ? `0 0 4px ${wsStatusColor}` : 'none',
          }} />
          {wsStatus === 'open' ? '接続済み' : wsStatus === 'connecting' ? '接続中' : '切断'}
        </div>

        <div style={{ flex: 1 }} />

        {/* ナビゲーション */}
        <nav style={{ display: 'flex', gap: 6 }}>
          <button style={activeNavBtn}>ダッシュボード</button>
          <button
            onClick={() => onNavigate('companies')}
            style={navBtn}
          >エージェント管理</button>
          <button
            onClick={() => onNavigate('settings')}
            style={navBtn}
          >設定</button>
        </nav>
      </header>

      {/* メインコンテンツ：左70% エージェント一覧 / 右30% 秘書チャット */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        {/* 左カラム */}
        <div style={{ flex: '0 0 70%', overflowY: 'auto' }}>
          <AgentList
            agents={agents}
            onJdApprove={handleJdApprove}
            onJdReject={handleJdReject}
          />
        </div>

        {/* 右カラム */}
        <div style={{ flex: '0 0 30%', overflow: 'hidden' }}>
          <SecretaryChat companyId={companyId} />
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
        select option { background: #0f172a; }
      `}</style>
    </div>
  );
}

const navBtn = {
  background: 'transparent',
  border: '1px solid rgba(51,65,85,0.4)',
  borderRadius: 6, padding: '5px 12px',
  color: '#94a3b8', fontSize: 12, cursor: 'pointer',
};

const activeNavBtn = {
  background: 'rgba(56,189,248,0.1)',
  border: '1px solid rgba(56,189,248,0.35)',
  borderRadius: 6, padding: '5px 12px',
  color: '#38bdf8', fontSize: 12, cursor: 'default',
};
