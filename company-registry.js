/**
 * 複数会社: データの永続化・移行
 */
const fs = require('fs');
const path = require('path');
const { loadCompanySettings, saveCompanySettings, DEFAULT_SETTINGS } = require('./settings-store');

/**
 * エージェントのステータス定義（統一）
 * - "idle"    : 待機中（明示的に休んでいいと言われた後のみ遷移）
 * - "working" : 作業中
 * - "review"  : FB待ち（作業完了・PR作成後に自動遷移）
 * - "waiting" : 承認待ち（Yutaの判断が必要な状態）
 * - "error"   : エラー発生中
 */
const VALID_STATUSES = ['idle', 'working', 'review', 'waiting', 'error'];

function normalizeStatus(status) {
  // 旧 "completed" は "review" に正規化
  if (status === 'completed') return 'review';
  return VALID_STATUSES.includes(status) ? status : 'idle';
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'company';
}

const DEFAULT_MEMBERS = [
  { name: 'CEO', role: 'CEO', avatar: '🎯', color: '#fbbf24', personality: '経営判断・全体方針。' },
  { name: '秘書', role: 'セクレタリー', avatar: '📋', color: '#f472b6', personality: '窓口。全指示を受け各部署へ連携。' },
  { name: 'リサーチ担当', role: 'リサーチ', avatar: '🔬', color: '#34d399', personality: '市場・競合・技術調査。' },
  { name: '開発担当', role: '開発・運用', avatar: '👨‍💻', color: '#38bdf8', personality: '実装・運用。' },
  { name: 'PM担当', role: 'PM', avatar: '👩‍💼', color: '#a78bfa', personality: '進捗・スコープ管理。' },
  { name: 'マーケ担当', role: 'マーケティング', avatar: '📣', color: '#fb923c', personality: 'コンテンツ・プロモーション。' },
];

function defaultAgentsForNewCompany() {
  return DEFAULT_MEMBERS.map((m, i) => ({
    id: 'agent-' + Date.now() + '-' + i,
    pane: i,
    name: m.name,
    role: m.role,
    project: '',
    avatar: m.avatar,
    color: m.color,
    aiType: 'anthropic-api',
    personality: m.personality,
    panelBg: '',
    projectId: '',
  }));
}

class CompanyRegistry {
  constructor(DATA_DIR) {
    this.DATA_DIR = DATA_DIR;
    this.COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
    this._migrate();
  }

  companyDir(id) {
    return path.join(this.DATA_DIR, 'companies', id);
  }

  _migrate() {
    if (fs.existsSync(this.COMPANIES_FILE)) return;

    const legacyAgents = path.join(this.DATA_DIR, 'agents.json');
    const id = 'co-' + Date.now();

    if (fs.existsSync(legacyAgents)) {
      const dir = this.companyDir(id);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(legacyAgents, path.join(dir, 'agents.json'));
      const legProj = path.join(this.DATA_DIR, 'projects.json');
      fs.writeFileSync(
        path.join(dir, 'projects.json'),
        fs.existsSync(legProj) ? fs.readFileSync(legProj) : '[]'
      );
      const legSet = path.join(this.DATA_DIR, 'app-settings.json');
      if (fs.existsSync(legSet)) {
        fs.copyFileSync(legSet, path.join(dir, 'company-settings.json'));
      } else {
        saveCompanySettings(dir, { ...DEFAULT_SETTINGS });
      }
      const list = [
        {
          id,
          name: 'マイ会社',
          slug: 'my-company',
          workspacePath: '',
          gitRemoteUrl: '',
          createdAt: new Date().toISOString(),
        },
      ];
      fs.writeFileSync(this.COMPANIES_FILE, JSON.stringify(list, null, 2));
      return;
    }

    const dir = this.companyDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const agents = defaultAgentsForNewCompany();
    fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify(agents, null, 2));
    fs.writeFileSync(path.join(dir, 'projects.json'), '[]');
    saveCompanySettings(dir, { ...DEFAULT_SETTINGS });
    fs.writeFileSync(
      this.COMPANIES_FILE,
      JSON.stringify(
        [
          {
            id,
            name: 'マイ会社',
            slug: 'my-company',
            workspacePath: '',
            gitRemoteUrl: '',
            createdAt: new Date().toISOString(),
          },
        ],
        null,
        2
      )
    );
  }

  listMeta() {
    return JSON.parse(fs.readFileSync(this.COMPANIES_FILE, 'utf8'));
  }

  saveMeta(list) {
    fs.writeFileSync(this.COMPANIES_FILE, JSON.stringify(list, null, 2));
  }

  getCompany(companyId) {
    const list = this.listMeta();
    return list.find((c) => c.id === companyId) || null;
  }

  createCompany({ name, workspacePath, slug, gitRemoteUrl }) {
    const { scaffoldCompanyWorkspace } = require('./workspace-scaffold');
    const { execSync } = require('child_process');
    const list = this.listMeta();
    const id = 'co-' + Date.now();
    const s = slug || slugify(name || 'company');
    const dir = this.companyDir(id);
    if (fs.existsSync(dir)) throw new Error('dir exists');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify(defaultAgentsForNewCompany(), null, 2));
    fs.writeFileSync(path.join(dir, 'projects.json'), '[]');
    saveCompanySettings(dir, { ...DEFAULT_SETTINGS });

    let wp = workspacePath && String(workspacePath).trim();
    if (!wp) {
      const wsRoot = path.join(this.DATA_DIR, 'one-person-ops-workspaces');
      fs.mkdirSync(wsRoot, { recursive: true });
      wp = path.join(wsRoot, `${s}-${id.replace(/^co-/, '').slice(-8)}`);
      fs.mkdirSync(wp, { recursive: true });
      scaffoldCompanyWorkspace(wp, name || '会社');
      try {
        execSync('git init', { cwd: wp, stdio: 'pipe' });
        execSync('git config user.email "one-person-ops@local"', { cwd: wp, stdio: 'pipe' });
        execSync('git config user.name "1人会社Ops"', { cwd: wp, stdio: 'pipe' });
      } catch (_) {}
    } else {
      wp = path.resolve(wp);
      if (!fs.existsSync(wp)) fs.mkdirSync(wp, { recursive: true });
      scaffoldCompanyWorkspace(wp, name || '会社');
      if (!fs.existsSync(path.join(wp, '.git'))) {
        try {
          execSync('git init', { cwd: wp, stdio: 'pipe' });
        } catch (_) {}
      }
    }

    const row = {
      id,
      name: name || '新しい会社',
      slug: s,
      workspacePath: wp,
      gitRemoteUrl: gitRemoteUrl && String(gitRemoteUrl).trim() ? String(gitRemoteUrl).trim() : '',
      createdAt: new Date().toISOString(),
    };
    list.push(row);
    this.saveMeta(list);
    return row;
  }

  updateCompany(companyId, patch) {
    const list = this.listMeta();
    const i = list.findIndex((c) => c.id === companyId);
    if (i === -1) return null;
    if (patch.name != null) list[i].name = patch.name;
    if (patch.slug != null) list[i].slug = slugify(patch.slug || patch.name);
    if (patch.workspacePath != null) list[i].workspacePath = patch.workspacePath;
    if (patch.gitRemoteUrl != null) list[i].gitRemoteUrl = patch.gitRemoteUrl;
    this.saveMeta(list);
    return list[i];
  }

  deleteCompany(companyId) {
    const list = this.listMeta();
    if (list.length <= 1) throw new Error('最後の1社は削除できません');
    const i = list.findIndex((c) => c.id === companyId);
    if (i === -1) throw new Error('not found');
    const dir = this.companyDir(companyId);
    fs.rmSync(dir, { recursive: true, force: true });
    list.splice(i, 1);
    this.saveMeta(list);
  }

  loadAgents(companyId) {
    const f = path.join(this.companyDir(companyId), 'agents.json');
    if (!fs.existsSync(f)) return [];
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return [];
    }
  }

  saveAgents(companyId, agents) {
    fs.writeFileSync(path.join(this.companyDir(companyId), 'agents.json'), JSON.stringify(agents, null, 2));
  }

  loadProjects(companyId) {
    const f = path.join(this.companyDir(companyId), 'projects.json');
    if (!fs.existsSync(f)) return [];
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return [];
    }
  }

  saveProjects(companyId, projects) {
    fs.writeFileSync(path.join(this.companyDir(companyId), 'projects.json'), JSON.stringify(projects, null, 2));
  }

  loadSettings(companyId) {
    return loadCompanySettings(this.companyDir(companyId));
  }

  saveSettingsRow(companyId, s) {
    saveCompanySettings(this.companyDir(companyId), s);
  }

  // エージェントを全会社から ID で検索
  findAgentById(agentId) {
    for (const co of this.listMeta()) {
      const agents = this.loadAgents(co.id);
      const agent = agents.find((a) => a.id === agentId);
      if (agent) return { agent, companyId: co.id };
    }
    return null;
  }

  // エージェントを更新（会社IDなしで）
  updateAgentById(agentId, patch) {
    const found = this.findAgentById(agentId);
    if (!found) return null;
    const agents = this.loadAgents(found.companyId);
    const idx = agents.findIndex((a) => a.id === agentId);
    if (idx === -1) return null;
    // statusは必ずVALID_STATUSESに正規化
    const normalizedPatch = { ...patch };
    if (normalizedPatch.status !== undefined) {
      normalizedPatch.status = normalizeStatus(normalizedPatch.status);
    }
    agents[idx] = { ...agents[idx], ...normalizedPatch };
    this.saveAgents(found.companyId, agents);
    return { agent: agents[idx], companyId: found.companyId };
  }

  // エージェントを削除（会社IDなしで）
  deleteAgentById(agentId) {
    const found = this.findAgentById(agentId);
    if (!found) return false;
    const agents = this.loadAgents(found.companyId).filter((a) => a.id !== agentId);
    this.saveAgents(found.companyId, agents);
    return found.companyId;
  }

  // 会話履歴
  loadConversation(companyId) {
    const f = path.join(this.companyDir(companyId), 'conversation.json');
    if (!fs.existsSync(f)) return [];
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
  }

  saveConversation(companyId, messages) {
    const dir = this.companyDir(companyId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'conversation.json'), JSON.stringify(messages, null, 2));
  }

  appendConversation(companyId, message) {
    const messages = this.loadConversation(companyId);
    messages.push(message);
    // 最新500件に絞る
    const trimmed = messages.slice(-500);
    this.saveConversation(companyId, trimmed);
    return trimmed;
  }

  primaryCompanyId() {
    const list = this.listMeta();
    return list[0]?.id || null;
  }

  multiCompany() {
    return this.listMeta().length > 1;
  }
}

/**
 * エージェントの階層レベルを返す
 * 0: 秘書（ジェニー）
 * 1: 事業部長
 * 2: PM・プロジェクトマネージャー
 * 3: 担当・スペシャリスト
 */
function getAgentHierarchyLevel(agent) {
  const role = (agent.role || '').toLowerCase();
  const name = (agent.displayName || agent.name || '').toLowerCase();

  if (role === 'secretary' || name.includes('秘書') || name.includes('jenny') || name.includes('ジェニー')) return 0;
  if (
    role.includes('head') || role.includes('division') ||
    name.includes('部長') || name.includes('事業部長') ||
    name.includes('エリカ') || name.includes('リク') || name.includes('レイ')
  ) return 1;
  if (
    role.includes('pm') || role.includes('project-manager') || role.includes('project_manager') ||
    name.includes('pm担当') || name.includes('pm ') || name.endsWith('pm')
  ) return 2;
  return 3;
}

/**
 * エージェントの上位事業部長を返す
 * 社長室エージェント or level <= 1 の場合は null を返す（直接ジェニーに報告）
 */
function getDivisionHeadForAgent(agent, allAgents) {
  if (getAgentHierarchyLevel(agent) <= 1) return null;

  // 社長室エージェントは事業部長にエスカレーションしない
  const role = (agent.role || '').toLowerCase();
  const section = (agent.section || agent.role || '').toLowerCase();
  const name = (agent.displayName || agent.name || '');
  const presidentNames = ['トム', 'ソフィア', 'レン', 'ベン', 'アレックス', 'テオ'];
  if (section.includes('社長室') || section.includes('president') || presidentNames.some((n) => name.includes(n))) {
    return null;
  }

  // セクション名でマッチする事業部長を探す
  const agentSection = agent.section || agent.role || '';
  const divisionHeads = allAgents.filter((a) => getAgentHierarchyLevel(a) === 1);
  for (const head of divisionHeads) {
    const headSection = head.section || head.role || '';
    if (headSection && agentSection && headSection === agentSection) return head;
    // 部分一致（BACKSTAGE事業部 ⊃ BACKSTAGE等）
    if (headSection && agentSection.includes(headSection.replace('事業部長', '').replace('事業部', '').trim())) return head;
    if (agentSection && headSection.includes(agentSection.replace('事業部', '').trim())) return head;
  }

  // マッチしなければ最初の事業部長（フォールバック）
  return divisionHeads[0] || null;
}

module.exports = { CompanyRegistry, slugify, defaultAgentsForNewCompany, getAgentHierarchyLevel, getDivisionHeadForAgent };
