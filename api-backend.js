const { streamAnthropic } = require('./anthropic-stream');
const { snapshotFromRepo } = require('./company-snapshot');
const { parseDelegateBlock, matchAgent } = require('./secretary-delegate');

function buildSystemPrompt(agent, projects) {
  const proj = agent.projectId ? projects.find((p) => p.id === agent.projectId) : null;
  const parts = [
    `あなたは「${agent.name}」という名前のチームメンバーです。`,
    `担当ロール: ${agent.role}。`,
    'ユーザーからの指示に、ロールに沿った専門的な視点で日本語で答えてください。',
  ];
  if (proj) {
    parts.push(`関連プロジェクト: ${proj.name}。${proj.description || ''}`);
    if (proj.repoPath) parts.push(`作業ディレクトリの目安: ${proj.repoPath}`);
    if (proj.knowledgePath) parts.push(`参照ナレッジ: ${proj.knowledgePath}`);
  }
  if (agent.personality && agent.personality.trim()) {
    parts.push('--- 口調・人格 ---');
    parts.push(agent.personality.trim());
  }
  if (proj && proj.repoPath) {
    const snap = snapshotFromRepo(proj.repoPath.trim(), proj.name);
    if (snap && snap.hasCompany) {
      parts.push('');
      parts.push('## 1人会社（cc-company）との関係');
      parts.push(
        'ユーザーは Claude Code プラグイン「cc-company」で .company/ 配下に秘書・部署を置く運用をしています。'
      );
      if (snap.departments.length) {
        parts.push(`検出された部署ディレクトリ例: ${snap.departments.join(', ')}`);
      }
      parts.push(
        `ダッシュボード上のあなたはそのうちの「${agent.role}」相当として振る舞い、TODO整理・他部署連携の提案などに言及してよいです。`
      );
    }
  }
  return parts.join('\n');
}

function trimMessages(msgs, maxPairs = 24) {
  if (msgs.length <= maxPairs * 2) return msgs;
  return msgs.slice(-maxPairs * 2);
}

class ApiAgentBackend {
  constructor() {
    /** @type {Map<string, { messages: {role:string,content:string}[], display: string, busy: boolean, lastUpdated: number, abort?: AbortController }>} */
    this.sessions = new Map();
  }

  ensureSession(agentId) {
    let s = this.sessions.get(agentId);
    if (!s) {
      s = { messages: [], display: '', busy: false, lastUpdated: Date.now() };
      this.sessions.set(agentId, s);
    }
    return s;
  }

  clearSession(agentId) {
    this.sessions.delete(agentId);
  }

  getPaneStates(agentIds, now) {
    const panes = {};
    for (const id of agentIds) {
      const s = this.sessions.get(id);
      if (!s) {
        panes[id] = {
          content:
            '\x1b[33m(APIモード)\x1b[0m 下の入力欄からメッセージを送ると、登録した Anthropic API 経由で応答します。\n設定は「社員管理」ページ上部の「API・接続」から。',
          lastUpdated: now,
          status: 'idle',
        };
        continue;
      }
      const elapsed = now - s.lastUpdated;
      panes[id] = {
        content: s.display || '(まだやりとりがありません)',
        lastUpdated: s.lastUpdated,
        status: s.busy ? 'working' : elapsed < 4000 ? 'working' : 'idle',
      };
    }
    return panes;
  }

  /**
   * @param {object} opts
   * @param {string} opts.agentId
   * @param {string} opts.text
   * @param {object} opts.agent
   * @param {object[]} opts.projects
   * @param {object} opts.settings
   * @param {function} opts.onUpdate - throttle broadcast
   */
  async sendMessage({ agentId, text, agent, projects, settings, onUpdate }) {
    const s = this.ensureSession(agentId);
    if (s.busy) {
      s.display += '\n\x1b[31m[待機中に別メッセージが来ました。前の応答完了後にもう一度送ってください]\x1b[0m';
      onUpdate();
      return;
    }

    s.display += (s.display ? '\n\n' : '') + `\x1b[36m> ${text}\x1b[0m\n`;
    s.messages.push({ role: 'user', content: text });
    s.busy = true;
    s.lastUpdated = Date.now();
    onUpdate();

    const system = buildSystemPrompt(agent, projects);
    const messages = trimMessages(s.messages).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const abort = new AbortController();
    s.abort = abort;
    let assistant = '';

    try {
      await streamAnthropic({
        apiKey: settings.anthropicApiKey,
        model: settings.model,
        system,
        messages,
        signal: abort.signal,
        onText: (t) => {
          assistant += t;
          s.display += t;
          s.lastUpdated = Date.now();
          onUpdate();
        },
      });
      if (assistant) s.messages.push({ role: 'assistant', content: assistant });
    } catch (e) {
      const msg = e.name === 'AbortError' ? '中断されました' : e.message || String(e);
      s.display += `\n\x1b[31m[エラー] ${msg}\x1b[0m`;
    } finally {
      s.busy = false;
      delete s.abort;
      s.lastUpdated = Date.now();
      onUpdate();
    }
  }

  abortAgent(agentId) {
    const s = this.sessions.get(agentId);
    if (s?.abort) s.abort.abort();
  }

  /** 秘書への一括指示 → 必要なら各担当へ自動転送 */
  async sendSecretaryRouted({ secretaryAgent, text, allAgents, projects, settings, onUpdate }) {
    const sid = secretaryAgent.id;
    const s = this.ensureSession(sid);
    if (s.busy) {
      s.display += '\n\x1b[31m[応答待ちです]\x1b[0m';
      onUpdate();
      return;
    }
    const others = allAgents.filter((a) => a.id !== sid);
    const roster = others.length
      ? others.map((a) => `- ${a.name}（${a.role}）`).join('\n')
      : '(他メンバーなし)';
    const extra = `\n\n## 秘書としての役割\n社長からの指示を受け、一次対応してください。他部署への具体的依頼が必要なとき**だけ**、返答本文の**最後**に次の1ブロックを付けてください（不要なら付けない）。\n###DELEGATE\n[{"role":"開発・運用","instruction":"依頼内容の全文"}\n]\nrole は次のいずれかに近い表記: ${others.map((a) => a.role).join('、')}\n`;
    const system = buildSystemPrompt(secretaryAgent, projects) + extra;

    s.display += (s.display ? '\n\n' : '') + `\x1b[36m> ${text}\x1b[0m\n`;
    s.messages.push({ role: 'user', content: text });
    s.busy = true;
    s.lastUpdated = Date.now();
    onUpdate();

    const messages = trimMessages(s.messages).map((m) => ({ role: m.role, content: m.content }));
    const base = s.display;
    let acc = '';
    const abort = new AbortController();
    s.abort = abort;

    try {
      await streamAnthropic({
        apiKey: settings.anthropicApiKey,
        model: settings.model,
        system,
        messages,
        signal: abort.signal,
        onText: (t) => {
          acc += t;
          s.display = base + acc;
          s.lastUpdated = Date.now();
          onUpdate();
        },
      });
      const { cleanReply, delegations } = parseDelegateBlock(acc);
      s.display = base + cleanReply;
      if (cleanReply.trim()) s.messages.push({ role: 'assistant', content: cleanReply });
      onUpdate();

      for (const d of delegations) {
        const target = matchAgent(d.roleHint, others);
        if (target && d.instruction) {
          await this.sendMessage({
            agentId: target.id,
            text: `【秘書より連携】\n${d.instruction}`,
            agent: target,
            projects,
            settings,
            onUpdate,
          });
        }
      }
    } catch (e) {
      const msg = e.name === 'AbortError' ? '中断' : e.message || String(e);
      s.display += `\n\x1b[31m[エラー] ${msg}\x1b[0m`;
    } finally {
      s.busy = false;
      delete s.abort;
      s.lastUpdated = Date.now();
      onUpdate();
    }
  }
}

module.exports = { ApiAgentBackend, buildSystemPrompt, trimMessages };
