const express = require('express');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

const { publicSettings, MODEL_OPTIONS } = require('./lib/settings-store');
const { ApiAgentBackend } = require('./lib/api-backend');
const { snapshotFromRepo } = require('./lib/company-snapshot');
const { CompanyRegistry } = require('./lib/company-registry');
const { scaffoldCompanyWorkspace } = require('./lib/workspace-scaffold');
const { startAutoGitSync, syncWorkspace } = require('./lib/git-autosync');
const { completeAnthropic, streamAnthropic } = require('./lib/anthropic-stream');
const { listRepositories, getFileContent, updateFileContent, listFileTree, createPullRequest, mergePullRequest, listPullRequests, getPullRequest } = require('./lib/github-connector');
const { cloneWorkspace, syncAgentsToWorkspace, readWorkspaceContext } = require('./lib/workspace-manager');
const { getWorkspacePath, initWorkspace, saveToWorkspace, loadFromWorkspace, syncSkillsFromWorkspace } = require('./lib/workspace-sync');
const { logActivity, getActivityLog } = require('./lib/activity-logger');
const { getMemoryContext, saveCompletionToWorkspace, detectStaleProjects, ensureMemoryFiles, detectProject } = require('./lib/workspace-memory');
const { generateSkillFromPattern, collectDailySkillsReport, detectRepetitivePatterns } = require('./lib/skills-generator');
const { AgentExecutor, buildAgentSystemPrompt } = require('./lib/agent-executor');
const notion = require('./lib/notion-connector');
const sheets = require('./lib/sheets-connector');
const ga4 = require('./lib/ga4-connector');

// 確認待ち操作のキャッシュ（pendingId → 操作内容）
const pendingActions = new Map();

const knowledgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
}).array('files', 50);

function slugifyMemberDir(s) {
  return (
    String(s || 'member')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'member'
  );
}

function agentSkillsDirForCompany(co, agent) {
  const wp = co.workspacePath && String(co.workspacePath).trim();
  if (!wp) return null;
  const base = path.resolve(wp);
  if (!fs.existsSync(base)) return null;
  const sub = roleToWorkspaceSubdir(agent.role);
  const folder = sub ? path.join(base, sub) : path.join(base, 'team', slugifyMemberDir(agent.name));
  return path.join(folder, 'skills');
}

async function writeSkillFromJob({ apiKey, model, agent, jobInstruction }) {
  const system = `Claude Code 向け SKILL.md を1ファイル分だけ出力してください。
先頭に YAML フロントマター（name: 英スネークケース, description: 1行）を必ず付け、その後 Markdown で業務手順・成果物・注意点を具体的に書いてください。
説明文のみ。囲みのコードフェンスで全体を囲まないでください。日本語でよいです。`;
  const user = `メンバー名: ${agent.name}\n役割: ${agent.role}\n任せたい仕事:\n${jobInstruction}`;
  let text = await completeAnthropic({
    apiKey,
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 6000,
  });
  text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  if (!text.includes('---')) {
    text = `---\nname: ${slugifyMemberDir(agent.name).replace(/-/g, '_')}_skill\ndescription: ${agent.role}の業務スキル\n---\n\n${text}`;
  }
  return text;
}

// Markdown記号を除去するユーティリティ
function stripMarkdown(text) {
  return (text || '').replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/`/g, '').replace(/^[-*]\s+/gm, '').trim();
}

const DATA_DIR = process.env.AI_AGENTS_DATA_DIR ? path.resolve(process.env.AI_AGENTS_DATA_DIR) : __dirname;
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
ensureDataDir();

const reg = new CompanyRegistry(DATA_DIR);
const TMUX_SESSION = 'one-person-company-ops';
const CAPTURE_INTERVAL = 800;

const backends = new Map();
const paneStates = new Map();

function getBackend(cid) {
  if (!backends.has(cid)) backends.set(cid, new ApiAgentBackend());
  return backends.get(cid);
}

function getPaneStateMap(cid) {
  if (!paneStates.has(cid)) paneStates.set(cid, new Map());
  return paneStates.get(cid);
}

function isApiMode(companyId) {
  return reg.loadSettings(companyId).providerMode === 'anthropic_api';
}

function roleToWorkspaceSubdir(role) {
  const r = role || '';
  if (/CEO/i.test(r) && r.length < 10) return 'ceo';
  if (/セクレタリー/.test(r) || /秘書/.test(r)) return 'secretary';
  if (/リサーチ/.test(r)) return path.join('departments', 'research');
  if (/開発/.test(r)) return path.join('departments', 'engineering');
  if (/^PM$|プロジェクト/.test(r)) return path.join('departments', 'pm');
  if (/マーケ/.test(r)) return path.join('departments', 'marketing');
  return null;
}

function inventoryKnowledgeFiles(absRoot) {
  const kn = path.join(absRoot, 'Knowledge');
  const rows = [];
  function walk(dir, rel) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, rel ? `${rel}/${ent.name}` : ent.name);
      else {
        const ext = path.extname(ent.name).toLowerCase();
        if (!['.md', '.txt', '.csv', '.json'].includes(ext)) continue;
        let summary = '';
        try {
          const raw = fs.readFileSync(p, 'utf8').slice(0, 2000);
          summary = raw
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 8)
            .join(' ')
            .replace(/\s+/g, ' ')
            .slice(0, 320);
        } catch {
          summary = '(読取不可)';
        }
        rows.push({
          path: rel ? `${rel}/${ent.name}` : ent.name,
          summary,
          size: (() => {
            try {
              return fs.statSync(p).size;
            } catch {
              return 0;
            }
          })(),
        });
      }
    }
  }
  if (fs.existsSync(kn)) walk(kn, '');
  return rows;
}

function broadcastToCompany(companyId, data) {
  const msg = JSON.stringify({ ...data, companyId });
  wss.clients.forEach((c) => {
    if (c.readyState === 1 && c.companyId === companyId) c.send(msg);
  });
}

function agentsForWS(companyId) {
  return reg.loadAgents(companyId).map((a) => {
    const { panelBg, ...rest } = a;
    return { ...rest, hasPanelBg: !!panelBg };
  });
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const outputThrottle = new Map();

function broadcastOutputSoon(companyId) {
  if (!isApiMode(companyId)) return;
  clearTimeout(outputThrottle.get(companyId));
  outputThrottle.set(
    companyId,
    setTimeout(() => {
      const agents = reg.loadAgents(companyId);
      const now = Date.now();
      const panes = getBackend(companyId).getPaneStates(
        agents.map((x) => x.id),
        now
      );
      broadcastToCompany(companyId, { type: 'output', panes });
    }, 80)
  );
}

function capturePaneOutput(paneIndex) {
  try {
    return execSync(`tmux capture-pane -t ${TMUX_SESSION}:0.${paneIndex} -p -e 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 500,
    });
  } catch {
    return null;
  }
}

function addTmuxPane(paneIndex, companyId) {
  if (isApiMode(companyId)) return;
  const root = DATA_DIR.replace(/'/g, "'\\''");
  try {
    execSync(`tmux split-window -t ${TMUX_SESSION}:0`, { timeout: 3000 });
    execSync(`tmux select-layout -t ${TMUX_SESSION}:0 tiled`, { timeout: 3000 });
    execSync(
      `tmux send-keys -t ${TMUX_SESSION}:0.${paneIndex} 'unset CLAUDECODE && cd '${root}' && claude --dangerously-skip-permissions' Enter`,
      { timeout: 3000 }
    );
  } catch (e) {
    console.error('addTmuxPane', e.message);
  }
}

function removeTmuxPane(paneIndex, companyId) {
  if (isApiMode(companyId)) return;
  try {
    execSync(`tmux kill-pane -t ${TMUX_SESSION}:0.${paneIndex}`, { timeout: 3000 });
    execSync(`tmux select-layout -t ${TMUX_SESSION}:0 tiled`, { timeout: 3000 });
  } catch (e) {
    console.error('removeTmuxPane', e.message);
  }
}

function paneExists(paneIndex) {
  try {
    execSync(`tmux list-panes -t ${TMUX_SESSION}:0 2>/dev/null | grep -q "^${paneIndex}:"`, { timeout: 500 });
    return true;
  } catch {
    return false;
  }
}

function reconnectPane(paneIndex) {
  const root = DATA_DIR.replace(/'/g, "'\\''");
  if (paneExists(paneIndex)) {
    try {
      execSync(`tmux send-keys -t ${TMUX_SESSION}:0.${paneIndex} C-c`, { timeout: 1000 });
    } catch {}
    setTimeout(() => {
      try {
        execSync(`tmux send-keys -t ${TMUX_SESSION}:0.${paneIndex} q Enter`, { timeout: 1000 });
      } catch {}
    }, 300);
  } else {
    try {
      execSync(`tmux split-window -t ${TMUX_SESSION}:0`, { timeout: 3000 });
      execSync(`tmux select-layout -t ${TMUX_SESSION}:0 tiled`, { timeout: 3000 });
    } catch (e) {
      return;
    }
  }
  setTimeout(() => {
    try {
      execSync(
        `tmux send-keys -t ${TMUX_SESSION}:0.${paneIndex} 'unset CLAUDECODE && cd '${root}' && claude --dangerously-skip-permissions' Enter`,
        { timeout: 3000 }
      );
    } catch (e) {
      console.error(e.message);
    }
  }, 1000);
}

function sendToPane(paneIndex, text) {
  try {
    const escaped = text.replace(/'/g, "'\\''");
    execSync(`tmux send-keys -t ${TMUX_SESSION}:0.${paneIndex} '${escaped}' Enter`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function withCompany(req, res, next) {
  const cid = req.params.companyId;
  if (!reg.getCompany(cid)) return res.status(404).json({ error: '会社が見つかりません' });
  req.cid = cid;
  next();
}

function walkTree(absRoot, relBase, depth, maxD) {
  if (depth > maxD) return [];
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const name = ent.name;
    if (name === '.git' || name === 'node_modules') continue;
    const abs = path.join(absRoot, name);
    const rel = relBase ? path.join(relBase, name) : name;
    if (ent.isDirectory()) {
      out.push({ type: 'dir', path: rel });
      out.push(...walkTree(abs, rel, depth + 1, maxD));
    } else {
      let sz = 0;
      try {
        sz = fs.statSync(abs).size;
      } catch {}
      out.push({ type: 'file', path: rel, size: sz });
    }
  }
  return out;
}

app.use(express.json({ limit: '20mb' }));
// public_new/ = Vite ビルド成果物（React アプリ）を優先配信
app.use(express.static(path.join(__dirname, 'public_new')));
// public/ = 旧来の静的HTMLページをフォールバックとして配信
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/guides',
  express.static(path.join(__dirname, 'docs'), {
    setHeaders(res) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    },
  })
);

/* ── セクション（事業部）API ── /api/sections は /api/companies のエイリアス */
const FIXED_SECTIONS = [
  { id: 'president', name: '社長室' },
  { id: 'backstage', name: 'BACKSTAGE事業部' },
  { id: 'personal', name: '個人事業部' },
  { id: 'music', name: '音楽事業部' },
  { id: 'freelance', name: '業務委託事業部' },
  { id: 'general', name: '統括' },
];

app.get('/api/sections', (req, res) => res.json(FIXED_SECTIONS));
app.post('/api/sections', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = 'section-' + Date.now();
  FIXED_SECTIONS.push({ id, name });
  res.status(201).json({ id, name });
});
app.put('/api/sections/:id', (req, res) => {
  const { name } = req.body || {};
  const idx = FIXED_SECTIONS.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  if (name) FIXED_SECTIONS[idx].name = name;
  res.json(FIXED_SECTIONS[idx]);
});
app.delete('/api/sections/:id', (req, res) => {
  const idx = FIXED_SECTIONS.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  FIXED_SECTIONS.splice(idx, 1);
  res.status(204).end();
});

/* ── 会社一覧・CRUD ── */
app.get('/api/companies', (req, res) => {
  res.json(reg.listMeta());
});

app.post('/api/companies', (req, res) => {
  try {
    const row = reg.createCompany(req.body || {});
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/companies/:companyId', withCompany, (req, res) => {
  const row = reg.updateCompany(req.cid, req.body || {});
  res.json(row);
});

app.delete('/api/companies/:companyId', withCompany, (req, res) => {
  try {
    reg.deleteCompany(req.cid);
    backends.delete(req.cid);
    paneStates.delete(req.cid);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** 他社データは明示指示時のみ — 現状はプレースホルダ */
app.post('/api/cross-company', (req, res) => {
  res.status(403).json({
    error:
      '会社をまたいだ取得・連携は、将来「明示的な指示」フロー経由でのみ有効化予定です。現状は各会社が独立しています。',
  });
});

app.get('/api/companies/:companyId/settings', withCompany, (req, res) => {
  res.json({ ...publicSettings(reg.loadSettings(req.cid)), modelOptions: MODEL_OPTIONS });
});

app.post('/api/companies/:companyId/settings', withCompany, (req, res) => {
  const cur = reg.loadSettings(req.cid);
  const { providerMode, anthropicApiKey, model, clearApiKey } = req.body || {};
  if (providerMode === 'tmux' || providerMode === 'anthropic_api') {
    cur.providerMode = providerMode;
  }
  if (typeof model === 'string' && model.trim()) cur.model = model.trim();
  if (clearApiKey === true) cur.anthropicApiKey = '';
  else if (typeof anthropicApiKey === 'string' && anthropicApiKey.trim()) cur.anthropicApiKey = anthropicApiKey.trim();
  reg.saveSettingsRow(req.cid, cur);
  const pub = publicSettings(cur);
  broadcastToCompany(req.cid, { type: 'settings', settings: pub });
  res.json(pub);
});

app.get('/api/companies/:companyId/agents', withCompany, (req, res) => {
  res.json(reg.loadAgents(req.cid));
});

app.post('/api/companies/:companyId/agents', withCompany, async (req, res) => {
  try {
    const agents = reg.loadAgents(req.cid);
    const { name, role, project, avatar, color, aiType, personality, panelBg, projectId, jobInstruction,
            skills, repositories, jobDescription } = req.body || {};
    if (!name || !role) return res.status(400).json({ error: 'name と role は必須です' });
    const id = 'agent-' + Date.now();
    const agent = {
      id,
      pane: agents.length,
      name,
      role,
      project: project || '',
      avatar: avatar || '🤖',
      color: color || '#38bdf8',
      aiType: aiType || 'anthropic-api',
      personality: personality || '',
      panelBg: panelBg || '',
      projectId: projectId || '',
      skills: Array.isArray(skills) ? skills : [],
      repositories: Array.isArray(repositories) ? repositories : [],
      status: 'idle',
      progress: 0,
      estimatedMinutes: null,
      currentTask: '',
      lastMessage: '',
      lastActiveAt: null,
      jobDescription: jobDescription || '',
      pendingJdUpdate: null,
      createdAt: new Date().toISOString(),
    };
    agents.push(agent);
    reg.saveAgents(req.cid, agents);
    addTmuxPane(agent.pane, req.cid);
    broadcastToCompany(req.cid, { type: 'agents', agents: agentsForWS(req.cid) });
    if (isApiMode(req.cid)) broadcastOutputSoon(req.cid);

    let skillWarning = null;
    const ji = jobInstruction && String(jobInstruction).trim();
    if (ji) {
      const co = reg.getCompany(req.cid);
      const sett = reg.loadSettings(req.cid);
      const dir = agentSkillsDirForCompany(co, agent);
      if (!sett.anthropicApiKey || !sett.anthropicApiKey.trim()) {
        skillWarning = 'APIキー未設定のためスキルは未生成です。会社管理で設定後「スキルを再生成」できます。';
      } else if (!dir) {
        skillWarning = '作業フォルダが未設定のためスキルを保存できませんでした。②のフォルダを設定してください。';
      } else {
        try {
          fs.mkdirSync(dir, { recursive: true });
          const md = await writeSkillFromJob({
            apiKey: sett.anthropicApiKey,
            model: sett.model,
            agent,
            jobInstruction: ji,
          });
          fs.writeFileSync(path.join(dir, 'SKILL.md'), md, 'utf8');
        } catch (e) {
          skillWarning = e.message || String(e);
        }
      }
    }
    res.status(201).json({ agent, skillWarning });
    fireAndForgetWorkspaceSave(req.cid, 'Add new agent');
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/companies/:companyId/agents/:id/regenerate-skill', withCompany, async (req, res) => {
  try {
    const { jobInstruction } = req.body || {};
    const ji = jobInstruction && String(jobInstruction).trim();
    if (!ji) return res.status(400).json({ error: 'jobInstruction が必要です' });
    const agent = reg.loadAgents(req.cid).find((a) => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: 'not found' });
    const co = reg.getCompany(req.cid);
    const sett = reg.loadSettings(req.cid);
    if (!sett.anthropicApiKey || !sett.anthropicApiKey.trim()) {
      return res.status(400).json({ error: 'APIキーを設定してください' });
    }
    const dir = agentSkillsDirForCompany(co, agent);
    if (!dir) return res.status(400).json({ error: '作業フォルダを先に設定してください' });
    fs.mkdirSync(dir, { recursive: true });
    const md = await writeSkillFromJob({
      apiKey: sett.anthropicApiKey,
      model: sett.model,
      agent,
      jobInstruction: ji,
    });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), md, 'utf8');
    res.json({ ok: true, path: path.join(dir, 'SKILL.md') });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.put('/api/companies/:companyId/agents/:id', withCompany, (req, res) => {
  let agents = reg.loadAgents(req.cid);
  const idx = agents.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'エージェントが見つかりません' });
  const b = req.body;
  agents[idx] = {
    ...agents[idx],
    name: b.name ?? agents[idx].name,
    role: b.role ?? agents[idx].role,
    project: b.project ?? agents[idx].project,
    avatar: b.avatar ?? agents[idx].avatar,
    color: b.color ?? agents[idx].color,
    aiType: b.aiType ?? agents[idx].aiType,
    personality: b.personality ?? agents[idx].personality,
    panelBg: b.panelBg !== undefined ? b.panelBg : agents[idx].panelBg,
    projectId: b.projectId !== undefined ? b.projectId : agents[idx].projectId,
  };
  reg.saveAgents(req.cid, agents);
  broadcastToCompany(req.cid, { type: 'agents', agents: agentsForWS(req.cid) });
  broadcastToCompany(req.cid, {
    type: 'panelBg',
    agentId: agents[idx].id,
    panelBg: agents[idx].panelBg || '',
  });
  res.json(agents[idx]);
});

app.delete('/api/companies/:companyId/agents/:id', withCompany, (req, res) => {
  let agents = reg.loadAgents(req.cid);
  const idx = agents.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const paneToKill = agents[idx].pane;
  getPaneStateMap(req.cid).delete(agents[idx].id);
  getBackend(req.cid).clearSession(agents[idx].id);
  removeTmuxPane(paneToKill, req.cid);
  agents.splice(idx, 1);
  agents = agents.map((ag, i) => ({ ...ag, pane: i }));
  reg.saveAgents(req.cid, agents);
  broadcastToCompany(req.cid, { type: 'agents', agents: agentsForWS(req.cid) });
  res.status(204).end();
});

app.get('/api/companies/:companyId/agents/:id/panelbg', withCompany, (req, res) => {
  const agent = reg.loadAgents(req.cid).find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json({ panelBg: agent.panelBg || '' });
});

app.post('/api/companies/:companyId/agents/:id/generate-claude-md', withCompany, (req, res) => {
  const agent = reg.loadAgents(req.cid).find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  const projects = reg.loadProjects(req.cid);
  const project = agent.projectId ? projects.find((p) => p.id === agent.projectId) : null;
  if (!project || !project.repoPath) {
    return res.status(400).json({ error: 'プロジェクトの repoPath が未設定です' });
  }
  const lines = [
    `# ${agent.name} - ${agent.role}`,
    '',
    '## 担当プロジェクト',
    project.name,
    project.description || '',
    '',
    '## 作業ディレクトリ',
    project.repoPath,
    '',
  ];
  if (project.knowledgePath) {
    lines.push('## ナレッジ', `参照: ${project.knowledgePath}`, '');
  }
  if (agent.personality) {
    lines.push('## 人格', agent.personality, '');
  }
  try {
    fs.mkdirSync(project.repoPath, { recursive: true });
    fs.writeFileSync(path.join(project.repoPath, 'CLAUDE.md'), lines.join('\n'));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId/projects', withCompany, (req, res) => {
  res.json(reg.loadProjects(req.cid));
});

app.post('/api/companies/:companyId/projects', withCompany, (req, res) => {
  const projects = reg.loadProjects(req.cid);
  const { name, description, repoPath, knowledgePath, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name は必須' });
  const id = 'project-' + Date.now();
  const project = {
    id,
    name,
    description: description || '',
    repoPath: repoPath || '',
    knowledgePath: knowledgePath || '',
    color: color || '#38bdf8',
  };
  projects.push(project);
  reg.saveProjects(req.cid, projects);
  broadcastToCompany(req.cid, { type: 'projects', projects });
  res.status(201).json(project);
});

app.put('/api/companies/:companyId/projects/:id', withCompany, (req, res) => {
  const projects = reg.loadProjects(req.cid);
  const idx = projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  projects[idx] = {
    ...projects[idx],
    name: b.name ?? projects[idx].name,
    description: b.description ?? projects[idx].description,
    repoPath: b.repoPath ?? projects[idx].repoPath,
    knowledgePath: b.knowledgePath ?? projects[idx].knowledgePath,
    color: b.color ?? projects[idx].color,
  };
  reg.saveProjects(req.cid, projects);
  broadcastToCompany(req.cid, { type: 'projects', projects });
  res.json(projects[idx]);
});

app.delete('/api/companies/:companyId/projects/:id', withCompany, (req, res) => {
  const projects = reg.loadProjects(req.cid).filter((p) => p.id !== req.params.id);
  reg.saveProjects(req.cid, projects);
  broadcastToCompany(req.cid, { type: 'projects', projects });
  res.status(204).end();
});

app.get('/api/companies/:companyId/company-snapshot', withCompany, (req, res) => {
  const co = reg.getCompany(req.cid);
  const hubs = [];
  const wp = co.workspacePath && String(co.workspacePath).trim();
  if (wp) {
    const snap = snapshotFromRepo(wp, co.name);
    if (snap) hubs.push(snap);
  }
  for (const p of reg.loadProjects(req.cid)) {
    if (!p.repoPath || !String(p.repoPath).trim()) continue;
    const snap = snapshotFromRepo(p.repoPath.trim(), p.name);
    if (snap && !hubs.some((h) => h.repoPath === snap.repoPath)) hubs.push(snap);
  }
  res.json({ hubs, guidePath: '/guides/ONE_PERSON_COMPANY.md' });
});

app.get('/api/companies/:companyId/workspace-tree', withCompany, (req, res) => {
  const co = reg.getCompany(req.cid);
  const wp = co.workspacePath && String(co.workspacePath).trim();
  if (!wp || !fs.existsSync(wp)) {
    return res.json({ error: 'workspacePath が未設定または存在しません', tree: [] });
  }
  const base = path.resolve(wp);
  res.json({ tree: walkTree(base, '', 0, 5), root: base });
});

app.post('/api/companies/:companyId/scaffold-workspace', withCompany, (req, res) => {
  const co = reg.getCompany(req.cid);
  let wp = co.workspacePath && String(co.workspacePath).trim();
  if (!wp) return res.status(400).json({ error: '先に会社の workspacePath を設定してください' });
  wp = path.resolve(wp);
  try {
    const { created, base } = scaffoldCompanyWorkspace(wp, co.name);
    res.json({ created, base });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/companies/:companyId/knowledge-inventory', withCompany, (req, res) => {
  const co = reg.getCompany(req.cid);
  const wp = co.workspacePath && String(co.workspacePath).trim();
  if (!wp || !fs.existsSync(wp)) return res.json({ rows: [], error: 'ワークスペース未設定' });
  res.json({ rows: inventoryKnowledgeFiles(path.resolve(wp)) });
});

app.post(
  '/api/companies/:companyId/knowledge-upload',
  withCompany,
  (req, res, next) => {
    knowledgeUpload(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'アップロードに失敗しました' });
      next();
    });
  },
  (req, res) => {
    const projectId = req.body && req.body.projectId ? String(req.body.projectId).trim() : null;
    const co = reg.getCompany(req.cid);
    const wp = co.workspacePath && String(co.workspacePath).trim();
    if (!wp || !fs.existsSync(path.resolve(wp))) {
      return res.status(400).json({ error: '作業フォルダを先に設定してください' });
    }
    const root = path.resolve(wp);
    const projects = reg.loadProjects(req.cid);
    let subdir = '_shared';
    if (projectId && projectId !== '_shared') {
      const proj = projects.find((p) => p.id === projectId || p.name === projectId);
      if (proj) subdir = (proj.knowledgePath && String(proj.knowledgePath).trim()) || proj.name;
    }
    const destDir = path.join(root, 'Knowledge', subdir);
    fs.mkdirSync(destDir, { recursive: true });
    const files = req.files || [];
    const written = [];
    for (const f of files) {
      const base = (f.originalname && path.basename(f.originalname)) || 'file';
      const safe = base.replace(/[<>:"/\\|?*]/g, '_').slice(0, 200) || 'file';
      const dest = path.join(destDir, safe);
      fs.writeFileSync(dest, f.buffer);
      written.push(safe);
    }
    try {
      syncWorkspace(root, co.gitRemoteUrl);
    } catch (_) {}
    res.json({
      ok: true,
      count: written.length,
      path: `Knowledge/${subdir}`,
      files: written,
    });
  }
);

app.get('/api/companies/:companyId/org-structure', withCompany, (req, res) => {
  const agents = reg.loadAgents(req.cid);
  const ceo = agents.filter((a) => /CEO/i.test(a.role || ''));
  const sec = agents.filter((a) => /セクレタリー/.test(a.role || '') || (a.name || '').includes('秘書'));
  const rest = agents.filter((a) => !ceo.includes(a) && !sec.includes(a));
  res.json({
    levels: [
      { label: 'CEO', members: ceo },
      { label: 'セクレタリー', members: sec },
      { label: '各部署', members: rest },
    ],
  });
});

app.get('/api/companies/:companyId/agent-workspace/:agentId', withCompany, (req, res) => {
  const co = reg.getCompany(req.cid);
  const wp = co.workspacePath && String(co.workspacePath).trim();
  if (!wp) return res.status(400).json({ error: 'workspace なし' });
  const base = path.resolve(wp);
  const agent = reg.loadAgents(req.cid).find((a) => a.id === req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'not found' });
  const sub = roleToWorkspaceSubdir(agent.role);
  const folderAbs = sub ? path.join(base, sub) : path.join(base, 'team', slugifyMemberDir(agent.name));
  const folderRel = sub ? sub.replace(/\\/g, '/') : `team/${slugifyMemberDir(agent.name)}`;
  let claudeMd = '';
  try {
    const f = path.join(folderAbs, 'CLAUDE.md');
    if (fs.existsSync(f)) claudeMd = fs.readFileSync(f, 'utf8');
  } catch {}
  const skills = [];
  const skRoot = path.join(folderAbs, 'skills');
  function walkSkills(d, rel) {
    if (!fs.existsSync(d)) return;
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      try {
        if (fs.statSync(p).isDirectory()) walkSkills(p, rel ? `${rel}/${name}` : name);
        else if (name === 'SKILL.md' || name.endsWith('.md')) {
          skills.push({
            path: rel ? `${rel}/${name}` : name,
            preview: fs.readFileSync(p, 'utf8').slice(0, 600),
          });
        }
      } catch {}
    }
  }
  walkSkills(skRoot, '');
  res.json({ agent, folder: folderRel, claudeMd, skills });
});

app.get('/api/companies/:companyId/project-knowledge-tree', withCompany, (req, res) => {
  const co = reg.getCompany(req.cid);
  const wp = co.workspacePath && String(co.workspacePath).trim();
  const projects = reg.loadProjects(req.cid);
  if (!wp || !fs.existsSync(path.resolve(wp))) {
    return res.json({ projects: projects.map((p) => ({ ...p, knowledgeFiles: [], knowledgeRel: '' })) });
  }
  const root = path.resolve(wp);
  const knRoot = path.join(root, 'Knowledge');
  function listMdFiles(dir, rel) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).isDirectory()) out.push(...listMdFiles(p, rel ? `${rel}/${name}` : name));
        else if (/\.(md|txt|csv)$/i.test(name)) out.push(rel ? `${rel}/${name}` : name);
      } catch {}
    }
    return out;
  }
  const enriched = projects.map((p) => {
    const rel = (p.knowledgePath && String(p.knowledgePath).trim()) || p.name;
    const kdir = path.join(knRoot, rel);
    return {
      ...p,
      knowledgeRel: `Knowledge/${rel}`,
      knowledgeFiles: listMdFiles(kdir, ''),
    };
  });
  res.json({ workspaceRoot: root, projects: enriched });
});

app.get('/api/companies/:companyId/dashboard-background', withCompany, (req, res) => {
  const cdir = reg.companyDir(req.cid);
  for (const ext of ['png', 'jpg', 'webp']) {
    const fp = path.join(cdir, `dashboard-bg.${ext}`);
    if (fs.existsSync(fp)) {
      res.type(ext === 'jpg' ? 'jpeg' : ext);
      return res.sendFile(path.resolve(fp));
    }
  }
  res.status(404).end();
});

app.post('/api/companies/:companyId/dashboard-background', withCompany, (req, res) => {
  const dataUrl = req.body && req.body.dataUrl;
  if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: 'dataUrl が必要です' });
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!m) return res.status(400).json({ error: 'PNG/JPEG/WebP のデータURLのみ' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: '5MB以下にしてください' });
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const cdir = reg.companyDir(req.cid);
  fs.mkdirSync(cdir, { recursive: true });
  for (const e of ['png', 'jpg', 'webp']) {
    const fp = path.join(cdir, `dashboard-bg.${e}`);
    if (fs.existsSync(fp))
      try {
        fs.unlinkSync(fp);
      } catch {}
  }
  fs.writeFileSync(path.join(cdir, `dashboard-bg.${ext}`), buf);
  res.json({ ok: true });
});

app.delete('/api/companies/:companyId/dashboard-background', withCompany, (req, res) => {
  const cdir = reg.companyDir(req.cid);
  for (const e of ['png', 'jpg', 'webp', 'jpeg']) {
    const fp = path.join(cdir, `dashboard-bg.${e}`);
    if (fs.existsSync(fp))
      try {
        fs.unlinkSync(fp);
      } catch {}
  }
  res.json({ ok: true });
});

app.get('/api/companies/:companyId/dashboard-background-meta', withCompany, (req, res) => {
  const cdir = reg.companyDir(req.cid);
  for (const ext of ['png', 'jpg', 'webp']) {
    const p = path.join(cdir, `dashboard-bg.${ext}`);
    if (fs.existsSync(p)) return res.json({ hasBackground: true, url: `/api/companies/${req.cid}/dashboard-background` });
  }
  res.json({ hasBackground: false, url: null });
});

app.get('/api/companies/:companyId/knowledge', withCompany, (req, res) => {
  const co = reg.getCompany(req.cid);
  const projects = reg.loadProjects(req.cid);
  const wp = co.workspacePath && String(co.workspacePath).trim();
  const knowledgeRoot = wp ? path.join(path.resolve(wp), 'Knowledge') : null;
  let dirs = [];
  if (knowledgeRoot && fs.existsSync(knowledgeRoot)) {
    try {
      dirs = fs.readdirSync(knowledgeRoot).filter((n) => {
        try {
          return fs.statSync(path.join(knowledgeRoot, n)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {}
  }
  res.json({
    knowledgeRoot: knowledgeRoot || null,
    knowledgeSubdirs: dirs,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      knowledgePath: p.knowledgePath || '',
      repoPath: p.repoPath || '',
    })),
  });
});

/* グローバル設定 API（SetupWizard / 汎用） */
app.get('/api/settings', (req, res) => {
  // companyId 指定時は会社ごとの設定を返す（後方互換）
  if (req.query.companyId) {
    const cid = req.query.companyId;
    return res.json({ ...publicSettings(reg.loadSettings(cid)), modelOptions: MODEL_OPTIONS });
  }
  // グローバル app-settings.json をマスクして返す
  const file = path.join(DATA_DIR, 'app-settings.json');
  let s = {};
  if (fs.existsSync(file)) {
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  }
  const defaultIntegrations = {
    notion: { token: '', databases: {} },
    googleSheets: { credentials: null, sheets: {} },
    googleAnalytics: { credentials: null, propertyId: '' },
  };
  res.json({
    anthropicApiKey: s.anthropicApiKey ? '****' : '',
    githubPersonalToken: s.githubPersonalToken ? '****' : '',
    githubCompanyToken: s.githubCompanyToken ? '****' : '',
    repositories: Array.isArray(s.repositories) ? s.repositories : [],
    model: s.model || 'claude-sonnet-4-20250514',
    providerMode: s.providerMode || 'anthropic_api',
    userName: s.userName || '',
    integrations: {
      notion: { token: s.integrations?.notion?.token ? '****' : '', databases: s.integrations?.notion?.databases || {} },
      googleSheets: s.integrations?.googleSheets || defaultIntegrations.googleSheets,
      googleAnalytics: s.integrations?.googleAnalytics || defaultIntegrations.googleAnalytics,
    },
  });
});

app.post('/api/settings', (req, res) => {
  const body = req.body || {};
  // companyId 指定時は会社ごとの設定を更新（後方互換）
  if (body.companyId) {
    const cid = body.companyId;
    if (!reg.getCompany(cid)) return res.status(404).json({ error: '会社不明' });
    const cur = reg.loadSettings(cid);
    const { providerMode, anthropicApiKey, model, clearApiKey } = body;
    if (providerMode === 'tmux' || providerMode === 'anthropic_api') cur.providerMode = providerMode;
    if (typeof model === 'string' && model.trim()) cur.model = model.trim();
    if (clearApiKey === true) cur.anthropicApiKey = '';
    else if (typeof anthropicApiKey === 'string' && anthropicApiKey.trim()) cur.anthropicApiKey = anthropicApiKey.trim();
    reg.saveSettingsRow(cid, cur);
    broadcastToCompany(cid, { type: 'settings', settings: publicSettings(cur) });
    return res.json(publicSettings(cur));
  }
  // グローバル設定を merge 保存
  const { anthropicApiKey, githubPersonalToken, githubCompanyToken, repositories, model, providerMode, userName, integrations } = body;
  const file = path.join(DATA_DIR, 'app-settings.json');
  let existing = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  }
  const merged = { ...existing };
  if (typeof anthropicApiKey === 'string' && anthropicApiKey.trim()) merged.anthropicApiKey = anthropicApiKey.trim();
  if (typeof githubPersonalToken === 'string') merged.githubPersonalToken = githubPersonalToken.trim();
  if (typeof githubCompanyToken === 'string') merged.githubCompanyToken = githubCompanyToken.trim();
  if (Array.isArray(repositories)) merged.repositories = repositories;
  if (typeof model === 'string' && model.trim()) merged.model = model.trim();
  if (providerMode === 'tmux' || providerMode === 'anthropic_api') merged.providerMode = providerMode;
  if (typeof userName === 'string') merged.userName = userName.trim();
  if (integrations && typeof integrations === 'object') {
    merged.integrations = merged.integrations || {};
    if (integrations.notion) {
      merged.integrations.notion = merged.integrations.notion || {};
      if (typeof integrations.notion.token === 'string' && integrations.notion.token.trim() && integrations.notion.token !== '****') {
        merged.integrations.notion.token = integrations.notion.token.trim();
      }
    }
    if (integrations.googleSheets) merged.integrations.googleSheets = integrations.googleSheets;
    if (integrations.googleAnalytics) merged.integrations.googleAnalytics = integrations.googleAnalytics;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Global Settings (SetupWizard) ────────────���────────────────────────��──────

app.get('/api/settings/status', (req, res) => {
  const file = path.join(DATA_DIR, 'app-settings.json');
  if (!fs.existsSync(file)) return res.json({ isConfigured: false });
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({ isConfigured: !!(s.anthropicApiKey && s.anthropicApiKey.trim()) });
  } catch {
    res.json({ isConfigured: false });
  }
});

app.get('/api/settings/test-anthropic', async (req, res) => {
  const file = path.join(DATA_DIR, 'app-settings.json');
  let saved = {};
  if (fs.existsSync(file)) {
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  }
  // x-api-key ヘッダーがあればそちらを優先（セットアップウィザードからの未保存キーテスト用）
  const apiKey = (req.headers['x-api-key'] || saved.anthropicApiKey || '').trim();
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: 'APIキーが設定されていません' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (response.ok) {
      return res.json({ ok: true });
    }
    let errMsg = `HTTP ${response.status}`;
    try {
      const j = await response.json();
      errMsg = j.error?.message || errMsg;
    } catch { /* ignore */ }
    res.status(200).json({ ok: false, error: errMsg });
  } catch (e) {
    res.status(200).json({ ok: false, error: e.message });
  }
});

app.post('/api/setup', (req, res) => {
  const { anthropicApiKey, githubPersonalToken, githubCompanyToken } = req.body || {};
  const file = path.join(DATA_DIR, 'app-settings.json');
  let existing = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  }
  const merged = { ...existing };
  if (typeof anthropicApiKey === 'string') merged.anthropicApiKey = anthropicApiKey.trim();
  if (typeof githubPersonalToken === 'string') merged.githubPersonalToken = githubPersonalToken.trim();
  if (typeof githubCompanyToken === 'string') merged.githubCompanyToken = githubCompanyToken.trim();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GitHub API ──────────────────────────────────────────────────────────────

function getGithubToken(tokenType) {
  const file = path.join(DATA_DIR, 'app-settings.json');
  let saved = {};
  if (fs.existsSync(file)) {
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  }
  if (tokenType === 'company') {
    return saved.githubCompanyToken || process.env.GITHUB_COMPANY_TOKEN || null;
  }
  return saved.githubPersonalToken || process.env.GITHUB_PERSONAL_TOKEN || null;
}

// app-settings.json の repositories からリポジトリの permission を取得するヘルパー
function getRepoPermission(owner, repo) {
  const file = path.join(DATA_DIR, 'app-settings.json');
  let saved = {};
  if (fs.existsSync(file)) {
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  }
  const repos = Array.isArray(saved.repositories) ? saved.repositories : [];
  const found = repos.find((r) => r.owner === owner && r.repo === repo);
  return found ? (found.permission || 'read') : 'read'; // デフォルトは read
}

app.get('/api/github/repos', async (req, res) => {
  const tokenType = req.query.tokenType || 'personal';
  // ?token= で生トークンを直接渡せる（ウィザード保存前のテスト用）
  const token = req.query.token || getGithubToken(tokenType);
  if (!token) return res.status(400).json({ error: 'GitHub トークンが設定されていません' });
  const result = await listRepositories(token);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ repos: result.data });
});

app.get('/api/github/repositories', (req, res) => {
  const s = readAppSettings();
  res.json({ repositories: Array.isArray(s.repositories) ? s.repositories : [] });
});

app.post('/api/github/repositories', (req, res) => {
  const { repositories } = req.body || {};
  if (!Array.isArray(repositories)) {
    return res.status(400).json({ error: 'repositories は配列で指定してください' });
  }
  const file = path.join(DATA_DIR, 'app-settings.json');
  let existing = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignore */ }
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...existing, repositories }, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/github/file', async (req, res) => {
  const { owner, repo, path: filePath, tokenType = 'personal' } = req.query;
  if (!owner || !repo || !filePath) {
    return res.status(400).json({ error: 'owner, repo, path は必須です' });
  }
  const token = getGithubToken(tokenType);
  if (!token) return res.status(400).json({ error: 'GitHub トークンが設定されていません' });
  const permission = getRepoPermission(owner, repo);
  const result = await getFileContent(owner, repo, filePath, token, permission);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json(result.data);
});

app.post('/api/github/file', async (req, res) => {
  const { owner, repo, path: filePath, content, message, tokenType = 'personal' } = req.body || {};
  if (!owner || !repo || !filePath || content === undefined || !message) {
    return res.status(400).json({ error: 'owner, repo, path, content, message は必須です' });
  }
  const token = getGithubToken(tokenType);
  if (!token) return res.status(400).json({ error: 'GitHub トークンが設定されていません' });
  const permission = getRepoPermission(owner, repo);
  const result = await updateFileContent(owner, repo, filePath, content, message, token, permission);
  if (!result.success) return res.status(403).json({ error: result.error });
  res.json(result.data);
});

app.post('/api/github/pr', async (req, res) => {
  const { owner, repo, title, body, head, base, tokenType = 'personal' } = req.body || {};
  if (!owner || !repo || !title || !head || !base) {
    return res.status(400).json({ error: 'owner, repo, title, head, base は必須です' });
  }
  const permission = getRepoPermission(owner, repo);
  if (permission !== 'pr') {
    return res.status(403).json({ error: 'このリポジトリはPR作成権限がありません' });
  }
  const token = getGithubToken(tokenType);
  if (!token) return res.status(400).json({ error: 'GitHub トークンが設定されていません' });
  const result = await createPullRequest(owner, repo, title, body || '', head, base, token, permission);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json(result.data);
});

app.get('/api/github/tree', async (req, res) => {
  const { owner, repo, tokenType = 'personal', branch } = req.query;
  if (!owner || !repo) {
    return res.status(400).json({ error: 'owner, repo は必須です' });
  }
  const token = getGithubToken(tokenType);
  if (!token) return res.status(400).json({ error: 'GitHub トークンが設定されていません' });
  const result = await listFileTree(owner, repo, token, branch);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ tree: result.data });
});

// ── Workspace自動保存ヘルパー（fire-and-forget） ────────────────────────────

function fireAndForgetWorkspaceSave(companyId, commitMessage) {
  setImmediate(() => {
    try {
      const agents = reg.loadAgents(companyId);
      saveToWorkspace({ agents }, commitMessage)
        .catch((e) => console.error('[workspace-sync] error:', e.message));
    } catch (e) {
      console.error('[workspace-sync] error:', e.message);
    }
  });
}

// ── エージェント グローバルCRUD（companyId不要） ─────────────────────────────

app.put('/api/agents/:id', (req, res) => {
  const result = reg.updateAgentById(req.params.id, req.body || {});
  if (!result) return res.status(404).json({ error: 'not found' });
  broadcastToCompany(result.companyId, { type: 'agents', agents: agentsForWS(result.companyId) });
  res.json(result.agent);
  fireAndForgetWorkspaceSave(result.companyId, 'Update agent settings');
});

app.delete('/api/agents/:id', (req, res) => {
  const companyId = reg.deleteAgentById(req.params.id);
  if (!companyId) return res.status(404).json({ error: 'not found' });
  broadcastToCompany(companyId, { type: 'agents', agents: agentsForWS(companyId) });
  res.status(204).end();
  fireAndForgetWorkspaceSave(companyId, 'Remove agent');
});

// ── JD更新承認フロー ─────────────────────────────────────────────────────────

app.post('/api/agents/:id/jd-proposal', (req, res) => {
  const { proposedJd } = req.body || {};
  if (!proposedJd) return res.status(400).json({ error: 'proposedJd は必須です' });
  const result = reg.updateAgentById(req.params.id, { pendingJdUpdate: proposedJd });
  if (!result) return res.status(404).json({ error: 'not found' });
  broadcastToCompany(result.companyId, { type: 'jd_proposal', agentId: result.agent.id, proposedJd });
  res.json(result.agent);
});

app.post('/api/agents/:id/jd-approve', (req, res) => {
  const found = reg.findAgentById(req.params.id);
  if (!found) return res.status(404).json({ error: 'not found' });
  const newJd = found.agent.pendingJdUpdate;
  if (!newJd) return res.status(400).json({ error: '承認待ちのJD更新がありません' });
  const result = reg.updateAgentById(req.params.id, { jobDescription: newJd, pendingJdUpdate: null });
  broadcastToCompany(result.companyId, { type: 'agents', agents: agentsForWS(result.companyId) });
  res.json(result.agent);
  fireAndForgetWorkspaceSave(result.companyId, 'Update agent JD');
});

app.post('/api/agents/:id/jd-reject', (req, res) => {
  const result = reg.updateAgentById(req.params.id, { pendingJdUpdate: null });
  if (!result) return res.status(404).json({ error: 'not found' });
  broadcastToCompany(result.companyId, { type: 'agents', agents: agentsForWS(result.companyId) });
  res.json(result.agent);
});

// ── activeStreams（作業中の精密管理） ──────────────────────────────────────────
const activeStreams = new Map(); // key: agentId, value: { startTime, taskId }

function streamStart(agentId, taskId, companyId) {
  activeStreams.set(agentId, { startTime: Date.now(), taskId: taskId || null });
  if (companyId) broadcastToCompany(companyId, { type: 'stream_start', agentId, taskId: taskId || null });
}

function streamEnd(agentId, taskId, companyId) {
  activeStreams.delete(agentId);
  if (companyId) broadcastToCompany(companyId, { type: 'stream_end', agentId, taskId: taskId || null });
}

app.get('/api/agents/active-streams', (req, res) => {
  const result = {};
  for (const [agentId, data] of activeStreams.entries()) result[agentId] = data;
  res.json(result);
});

// ── エージェントチャット（エージェントへの直接指示） ────────────────────────

function getAgentChatDir(companyId) {
  const dir = path.join(DATA_DIR, 'companies', companyId, 'agent-chats');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadAgentChat(companyId, agentId) {
  const p = path.join(getAgentChatDir(companyId), `${agentId}.json`);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

function saveAgentChat(companyId, agentId, messages) {
  const p = path.join(getAgentChatDir(companyId), `${agentId}.json`);
  fs.writeFileSync(p, JSON.stringify(messages, null, 2), 'utf8');
}

// Anthropicメッセージコンテンツ（テキスト＋画像添付）を構築
function buildMessageContent(text, attachments) {
  if (!attachments || attachments.length === 0) return text || '';
  const content = [];
  for (const att of attachments) {
    if (att.type === 'image' && att.base64) {
      content.push({ type: 'image', source: { type: 'base64', media_type: att.mimeType || 'image/jpeg', data: att.base64 } });
    }
  }
  if (text) content.push({ type: 'text', text });
  return content.length === 0 ? (text || '') : content.length === 1 && content[0].type === 'text' ? text : content;
}

app.get('/api/agents/:id/chat', (req, res) => {
  const found = reg.findAgentById(req.params.id);
  if (!found) return res.status(404).json({ error: 'not found' });
  res.json({ messages: loadAgentChat(found.companyId, req.params.id) });
});

app.post('/api/agents/:id/chat', async (req, res) => {
  const { message, attachments } = req.body || {};
  const found = reg.findAgentById(req.params.id);
  if (!found) return res.status(404).json({ error: 'not found' });
  const { agent, companyId } = found;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const sendSSE = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };

  const s = readAppSettings();
  const apiKey = s.anthropicApiKey || '';
  if (!apiKey.trim()) {
    sendSSE({ type: 'error', message: 'APIキーが未設定です' });
    sendSSE({ type: 'done' });
    res.end();
    return;
  }

  const userMsg = {
    id: 'msg-' + Date.now(),
    role: 'user',
    content: String(message || '').trim(),
    attachments: attachments || [],
    timestamp: new Date().toISOString(),
  };
  const chatHistory = loadAgentChat(companyId, req.params.id);
  chatHistory.push(userMsg);
  saveAgentChat(companyId, req.params.id, chatHistory);

  const personality = agent.persona?.personality || '';
  const speechStyle = agent.persona?.speechStyle || '';
  const agentSystem = `あなたは${agent.displayName || agent.name}（${agent.role}）です。
鈴木裕太（Yuta Suzuki）の直接指示を受けて作業を行います。
${personality ? `性格: ${personality}` : ''}
${speechStyle ? `話し方: ${speechStyle}` : ''}
${agent.jobDescription ? `職務内容: ${agent.jobDescription}` : ''}
簡潔に返答し、作業結果を報告してください。日本語で返答すること。`;

  const recentHistory = chatHistory.slice(-11, -1);
  const apiMessages = [
    ...recentHistory.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: buildMessageContent(m.content, m.attachments),
    })),
    { role: 'user', content: buildMessageContent(userMsg.content, attachments) },
  ];

  streamStart(req.params.id, null, companyId);
  let fullResponse = '';
  try {
    await streamAnthropic({
      apiKey,
      model: s.model || 'claude-sonnet-4-20250514',
      system: agentSystem,
      messages: apiMessages,
      onText: (chunk) => {
        fullResponse += chunk;
        sendSSE({ type: 'token', content: chunk });
      },
    });
  } catch (e) {
    const errMsg = e.isCredit
      ? 'APIクレジットが不足しています。設定画面でAPIキーを確認してください。'
      : e.message;
    sendSSE({ type: 'error', message: errMsg });
  }

  const agentMsg = {
    id: 'msg-' + (Date.now() + 1),
    role: 'agent',
    content: fullResponse,
    timestamp: new Date().toISOString(),
  };
  const updatedHistory = loadAgentChat(companyId, req.params.id);
  updatedHistory.push(agentMsg);
  saveAgentChat(companyId, req.params.id, updatedHistory);

  streamEnd(req.params.id, null, companyId);
  sendSSE({ type: 'done' });
  res.end();
});

// ── スキルファイル一覧 ────────────────────────────────────────────────────────

app.get('/api/skills', (req, res) => {
  const skillsDir = path.join(__dirname, 'core', 'skills');
  if (!fs.existsSync(skillsDir)) return res.json({ skills: [] });
  try {
    const files = fs.readdirSync(skillsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({
        id: `core/skills/${f}`,
        name: f.replace(/\.md$/, ''),
        path: `core/skills/${f}`,
      }));
    res.json({ skills: files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ワークスペース ────────────────────────────────────────────────────────────

function readAppSettings() {
  const file = path.join(DATA_DIR, 'app-settings.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function writeAppSettings(merged) {
  const file = path.join(DATA_DIR, 'app-settings.json');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
}

app.get('/api/workspace', (req, res) => {
  const s = readAppSettings();
  res.json(s.workspace || { owner: '', repo: '', tokenType: 'personal', localPath: '' });
});

app.post('/api/workspace', (req, res) => {
  const { owner, repo, tokenType, localPath } = req.body || {};
  const s = readAppSettings();
  s.workspace = {
    owner: owner || s.workspace?.owner || '',
    repo: repo || s.workspace?.repo || '',
    tokenType: tokenType || s.workspace?.tokenType || 'personal',
    localPath: localPath !== undefined ? localPath : (s.workspace?.localPath || ''),
  };
  writeAppSettings(s);
  res.json({ ok: true, workspace: s.workspace });
});

app.post('/api/workspace/clone', async (req, res) => {
  const s = readAppSettings();
  const workspace = s.workspace || {};
  if (!workspace.owner || !workspace.repo) {
    return res.status(400).json({ error: 'workspace.owner と repo を先に設定してください' });
  }
  if (!workspace.localPath || !workspace.localPath.trim()) {
    return res.status(400).json({ error: 'workspace.localPath を設定してください' });
  }
  const result = await cloneWorkspace(workspace, getGithubToken);
  if (!result.success) return res.status(500).json({ error: result.error });
  // クローン後に全クライアントへbroadcast
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(JSON.stringify({ type: 'workspace_ready', localPath: result.localPath }));
  });
  res.json({ ok: true, ...result });
});

app.post('/api/workspace/init', async (req, res) => {
  const { owner: bodyOwner, repo: bodyRepo } = req.body || {};
  const s = readAppSettings();
  const workspace = s.workspace || {};
  const owner = bodyOwner || workspace.owner;
  const repo = bodyRepo || workspace.repo;
  if (!owner || !repo) {
    return res.status(400).json({ error: 'owner と repo を指定してください' });
  }
  const token = getGithubToken(workspace.tokenType || 'personal');
  if (!token) return res.status(400).json({ error: 'GitHub トークンが設定されていません' });
  const result = await initWorkspace(owner, repo, token);
  if (!result.success) return res.status(500).json({ error: result.error });
  syncSkillsFromWorkspace();
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(JSON.stringify({ type: 'workspace_ready', localPath: getWorkspacePath() }));
  });
  res.json({ ok: true, localPath: getWorkspacePath(), data: result.data });
});

app.get('/api/workspace/path', (req, res) => {
  res.json({ path: getWorkspacePath() });
});

// ── 秘書メッセージ（SSEストリーミング） ──────────────────────────────────────

function buildSecretarySystemPrompt(companyId) {
  const promptFile = path.join(__dirname, 'core', 'prompts', 'secretary.md');
  let base = '';
  if (fs.existsSync(promptFile)) {
    try { base = fs.readFileSync(promptFile, 'utf8'); } catch {}
  }

  const agents = reg.loadAgents(companyId);
  const s = readAppSettings();
  const workspace = s.workspace || {};
  const repos = Array.isArray(s.repositories) ? s.repositories : [];

  // エージェント一覧（コンパクト版：トークン節約）
  const agentLines = agents.map((a) => {
    const displayName = a.displayName || a.name;
    const statusInfo = a.status === 'working' ? ` [作業中: ${(a.currentTask || '').slice(0, 20)}]` : '';
    return `${a.id}: ${displayName} / ${a.role}${statusInfo}`;
  }).join('\n');

  // リポジトリ一覧
  const repoLines = repos.map((r) => `${r.id || r.repo}: ${r.name || r.repo} (${r.owner}/${r.repo}) - permission: ${r.permission || 'read'}`).join('\n');

  const wsRepoInfo = workspace.owner && workspace.repo
    ? `\nGitHub: ${workspace.owner}/${workspace.repo}（FILE_CREATEでowner="${workspace.owner}" repo="${workspace.repo}"を使うこと）`
    : '';
  const injection = `\n\n## Current Agents（各エージェントのペルソナを把握して名前で呼ぶこと）\n${agentLines || '(エージェントなし)'}\n\n## Available Repositories\n${repoLines || '(リポジトリなし)'}\n\n## Workspace\nlocalPath: ${workspace.localPath || '(未設定)'}${wsRepoInfo}`;

  // ワークスペースコンテキスト
  let wsCtx = '';
  if (workspace.localPath) {
    wsCtx = '\n\n## Workspace Context\n' + readWorkspaceContext(workspace.localPath);
  }

  return base + injection + wsCtx;
}

/**
 * 記憶付きシステムプロンプト構築（非同期版）
 * Workspaceのmemory/からプロジェクト情報・好みを読み込んでプロンプトに注入する
 */
async function buildSecretarySystemPromptWithMemory(companyId) {
  const base = buildSecretarySystemPrompt(companyId);
  const s = readAppSettings();
  const token = s.githubPersonalToken || s.githubCompanyToken || '';
  if (!token) return base;

  try {
    const memoryCtx = await getMemoryContext(token);
    return base + memoryCtx;
  } catch (e) {
    console.error('[memory] 記憶読み込みエラー:', e.message);
    return base;
  }
}

app.post('/api/secretary/message', async (req, res) => {
  const { text, companyId: bodyCompanyId, attachments: bodyAttachments } = req.body || {};
  const companyId = bodyCompanyId || reg.primaryCompanyId();
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'text は必須です' });
  }
  const msgAttachments = Array.isArray(bodyAttachments) ? bodyAttachments : [];

  const s = readAppSettings();
  const apiKey = s.anthropicApiKey || '';
  if (!apiKey.trim()) {
    return res.status(400).json({ error: 'Anthropic API キーが設定されていません' });
  }

  // SSEヘッダー
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendSSE = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  // タスク分類
  const { classifyTask, checkAmbiguity } = require('./lib/task-classifier');
  const classification = await classifyTask(String(text).trim(), apiKey);
  console.log('[secretary] タスク分類:', classification.weight, classification.reason);
  sendSSE({ type: 'task_classified', weight: classification.weight, reason: classification.reason });

  // 曖昧さチェック（instant以外）
  if (classification.weight !== 'instant') {
    try {
      const ambiguityResult = await checkAmbiguity(String(text).trim(), apiKey);
      if (ambiguityResult.isAmbiguous) {
        console.log('[secretary] 曖昧な指示を検出:', ambiguityResult.question);
        sendSSE({ type: 'token', content: `確認させてください。${ambiguityResult.question}` });
        sendSSE({ type: 'done' });
        res.end();
        return;
      }
    } catch (e) {
      console.error('[secretary] ambiguity check error:', e.message);
    }
  }

  // heavy/complexタスクはタスク生成→即返答→バックグラウンド委託
  if (classification.weight === 'heavy' || classification.weight === 'complex') {
    // 1. タイトル生成
    let newTaskTitle = stripMarkdown(String(text).trim().slice(0, 15));
    try {
      const titleRes = await completeAnthropic({ apiKey, model: 'claude-haiku-4-5-20251001', system: '10文字以内の日本語タスクタイトルを生成。記号不要。タイトルのみ返す。Markdownは絶対に使わない。', messages: [{ role: 'user', content: text }], maxTokens: 64 });
      newTaskTitle = stripMarkdown(titleRes.trim().slice(0, 15)) || newTaskTitle;
    } catch {}

    // 2. 重複チェック → 既存タスクに追記 or 新規作成
    // タスク名の完全一致 or ユーザー入力のキーワードが既存タスク名に3文字以上含まれるか
    const existingTasks = loadTasksFile();
    const inputKeywords = String(text).replace(/[をにのはがでとも。、して]+/g, ' ').split(/\s+/).filter(w => w.length >= 3);
    const duplicateTask = existingTasks.find(t => {
      if (t.status === 'archived') return false;
      // 完全一致
      if (t.name === newTaskTitle) return true;
      // キーワード一致（入力のキーワードの半数以上がタスク名に含まれる）
      if (inputKeywords.length > 0) {
        const matchCount = inputKeywords.filter(kw => t.name.includes(kw)).length;
        return matchCount >= Math.ceil(inputKeywords.length / 2);
      }
      return false;
    });

    let newTaskId;
    if (duplicateTask) {
      // 同名タスクが存在する場合はそのタスクに追記
      newTaskId = duplicateTask.id;
      duplicateTask.status = 'active';
      duplicateTask.updatedAt = new Date().toISOString();
      saveTasksFile(existingTasks);
      saveTaskMessage(newTaskId, { role: 'user', content: text, timestamp: new Date().toISOString() });
      broadcastToCompany(companyId, { type: 'task_updated', task: duplicateTask });
    } else {
      newTaskId = `task-${Date.now()}`;
      const newTask = { id: newTaskId, name: newTaskTitle, status: 'active', weight: classification.weight, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), autoCreated: true, assignedAgentId: null };
      existingTasks.push(newTask);
      saveTasksFile(existingTasks);
      broadcastToCompany(companyId, { type: 'task_created', task: newTask });
    }

    // 4. 委託先エージェントを事前特定（SSEの返答に名前を入れるため）
    const preAgents = reg.loadAgents(companyId);
    let delegateTargetName = '';
    const textLower = String(text).toLowerCase();
    // 事業部長マッピングからタスクに最適なエージェントを特定
    const divisionMap = [
      { keywords: ['wavers', 'あげファンズ', 'noborder', 'rvc', 'snsハック', 'backstage'], name: 'カイ' },
      { keywords: ['vibe', 'sns', 'youtube', 'ai副業', '個人'], name: 'リク' },
      { keywords: ['jiggybeats', '音楽', 'サポート', 'ソロ', '作編曲'], name: 'レイ' },
      { keywords: ['kos', '業務委託'], name: 'クレア' },
      { keywords: ['コード', '実装', 'エンジニア', 'バグ', 'デプロイ'], name: 'トム' },
      { keywords: ['デザイン', 'ui', 'ux'], name: 'ソフィア' },
      { keywords: ['リサーチ', '調査', '分析'], name: 'レン' },
    ];
    for (const d of divisionMap) {
      if (d.keywords.some(kw => textLower.includes(kw))) {
        delegateTargetName = d.name;
        break;
      }
    }
    if (!delegateTargetName) delegateTargetName = '担当';

    // 5. SSEで返答（タスク名を繰り返さず、エージェント名と目安時間を明示）
    const estimatedTime = classification.weight === 'complex' ? '10〜15分' : '数分';
    if (duplicateTask) {
      sendSSE({ type: 'token', content: `${delegateTargetName}に再度依頼しました。完了まで${estimatedTime}ほどお待ちください。` });
    } else {
      sendSSE({ type: 'token', content: `${delegateTargetName}に依頼しました。完了まで${estimatedTime}ほどかかります。` });
    }
    sendSSE({ type: 'done' });
    res.end();

    // 5. バックグラウンドで委託
    setImmediate(async () => {
      try {
        const agents = reg.loadAgents(companyId);
        const systemPrompt = (await buildSecretarySystemPromptWithMemory(companyId)) + `

## 重要：委託の順番
直接担当者に振ってはいけない。必ず事業部長を経由すること。

### 事業部長の一覧
- BACKSTAGE事業部（WAVERS・あげファンズ・NoBorder・RVC・SNSハック）→ カイ（BACKSTAGE事業部長）
- 個人事業部（Vibe-Coding・SNS・YouTube・AI副業）→ リク（個人事業部長）
- 音楽事業部（JiggyBeats・サポート・ソロ・作編曲）→ レイ（音楽事業部長）
- 業務委託事業部（KOS）→ クレア（業務委託事業部長）
- エンジニアリング・デザイン・リサーチ → トム・ソフィア・レン（社長室）に直接OK

### 例
「WAVERSの競合調査」→ カイ（BACKSTAGE事業部長）に委託
「JiggyBeatsのSNS投稿」→ レイ（音楽事業部長）に委託
「コードの実装」→ トム（エンジニア）に直接委託OK

以下のタスクを適切な事業部長またはエンジニアリング担当に委託してください。
必ず###DELEGATE###ブロックを1つだけ出力してください（複数のDELEGATEは不可）。`;
        const bgResponse = await completeAnthropic({ apiKey, model: s.model || 'claude-sonnet-4-20250514', system: systemPrompt, messages: [{ role: 'user', content: `以下のタスクを適切なエージェントに委託してください：\n${text}` }] });
        const delegateReBg = /###DELEGATE\s+agentId="([^"]+)"\s+task="([^"]+)"(?:\s+progress="(\d+)")?(?:\s+estimatedMinutes="(\d+)")?(?:\s+weight="([^"]*)")?###/g;
        let mBg;
        while ((mBg = delegateReBg.exec(bgResponse)) !== null) {
          const [, agentId, task, , , w = classification.weight] = mBg;
          const agent = agents.find((a) => a.id === agentId);
          if (!agent) continue;
          reg.updateAgentById(agentId, { status: 'working', currentTask: task, lastActiveAt: new Date().toISOString() });
          broadcastToCompany(companyId, { type: 'agent_status', agentId, status: 'working', currentTask: task, taskId: newTaskId });
          // タスクにassignedAgentIdを保存
          try {
            const curTasks = loadTasksFile();
            const curTask = curTasks.find(t => t.id === newTaskId);
            if (curTask) {
              curTask.assignedAgentId = agentId;
              curTask.assignedAgentName = agent.displayName || agent.name;
              saveTasksFile(curTasks);
            }
          } catch {}
          const executor = new AgentExecutor({ apiKey, model: s.model || 'claude-sonnet-4-20250514', companyId, agents, broadcast: (msg) => broadcastToCompany(companyId, msg), skillsDir: path.join(__dirname, 'core', 'skills'), saveTaskMessage, githubToken: getGithubToken('personal') || getGithubToken('company'), workspace: s.workspace });
          const onProg = (pd) => { broadcastToCompany(companyId, { type: 'agent_progress', ...pd }); if (pd.message && pd.type === 'agent_message') { saveTaskMessage(newTaskId, { role: 'agent', content: pd.message, agentId, agentName: agent.displayName || agent.name, timestamp: new Date().toISOString() }); } };
          console.log(`[AgentExecutor] 起動(bg): ${agent.displayName || agent.name} taskId=${newTaskId}`);
          executor.execute(agent, task, newTaskId, 0, onProg, w).then(() => {
            handleAgentCompletion(companyId, agentId, agent.displayName || agent.name, `${agent.displayName || agent.name}が作業を完了しました`, newTaskId, true);
          }).catch((err) => {
            console.error('[AgentExecutor] bg error:', err.message);
            handleAgentCompletion(companyId, agentId, agent.displayName || agent.name, err.message, newTaskId, false);
          });
        }
      } catch (e) {
        console.error('[secretary] heavy task bg error:', e.message);
        saveTaskMessage(newTaskId, { role: 'secretary', content: `エラーが発生しました：${e.message}`, timestamp: new Date().toISOString() });
      }
    });
    return;
  }

  // 「組織を最新に」等の同期コマンド
  if (/組織を最新に|エージェントを更新して|sync|同期して/i.test(text)) {
    const workspace = s.workspace || {};
    if (workspace.owner && workspace.repo) {
      const wsToken = getGithubToken(workspace.tokenType || 'personal');
      if (wsToken) {
        sendSSE({ type: 'token', content: '組織情報を同期しています...\n' });
        const initResult = await initWorkspace(workspace.owner, workspace.repo, wsToken);
        if (initResult.success) {
          syncSkillsFromWorkspace();
          const agentList = reg.loadAgents(companyId);
          sendSSE({ type: 'token', content: `${agentList.length}名のエージェント情報を更新しました。\n` });
          broadcastToCompany(companyId, { type: 'agents_reloaded' });
        } else {
          sendSSE({ type: 'token', content: `同期に失敗しました: ${initResult.error}\n` });
        }
      }
    }
    sendSSE({ type: 'done' });
    res.end();
    return;
  }

  // 「おはよう」を含む場合はWorkspaceを同期してエージェント情報を読み込む
  if (/おはよう/.test(text)) {
    const workspace = s.workspace || {};
    if (workspace.owner && workspace.repo) {
      const wsToken = getGithubToken(workspace.tokenType || 'personal');
      if (wsToken) {
        sendSSE({ type: 'token', content: 'ワークスペースを同期しています...\n' });
        const initResult = await initWorkspace(workspace.owner, workspace.repo, wsToken);
        if (initResult.success) {
          wss.clients.forEach((c) => {
            if (c.readyState === 1) c.send(JSON.stringify({ type: 'workspace_ready', localPath: getWorkspacePath() }));
          });
          syncSkillsFromWorkspace();
          sendSSE({ type: 'token', content: 'エージェント情報を読み込みました。\n' });
          const agentList = reg.loadAgents(companyId);
          sendSSE({ type: 'token', content: `本日もよろしくお願いします。${agentList.length}名のスタッフが待機中です。\n` });
          if (agentList.length > 0) {
            const summary = agentList.map((a) => `- ${a.name}（${a.role}）: ${a.status || 'idle'}`).join('\n');
            sendSSE({ type: 'token', content: `\n### スタッフ一覧\n${summary}\n\n` });
          }
        } else {
          sendSSE({ type: 'token', content: `ワークスペース同期に失敗しました: ${initResult.error}\n\n` });
        }
      }
    }
  }

  // 会話履歴を取得
  const history = reg.loadConversation(companyId);
  // モデル選択：ユーザー設定があれば優先、無ければタスク分類 weight で Haiku/Sonnet を選ぶ
  const weight = classification?.weight || 'light';
  const isMorningGreeting = /^(おはよう|おはようございます|good morning)/i.test(String(text).trim());
  let model = s.model;
  if (!model) {
    if (isMorningGreeting) {
      model = 'claude-sonnet-4-20250514'; // ブリーフィングは要約力が要る
    } else if (weight === 'instant' || weight === 'light') {
      model = 'claude-haiku-4-5-20251001';
    } else {
      model = 'claude-sonnet-4-20250514';
    }
  }
  console.log('[secretary] model selected:', model, '(weight:', weight, ')');
  let system = await buildSecretarySystemPromptWithMemory(companyId);

  // おはようトリガー時はブリーフィングデータを注入
  if (isMorningGreeting) {
    try {
      const briefingData = await buildMorningBriefingData(companyId);
      system += buildBriefingContext(briefingData);
    } catch (e) {
      console.error('[briefing] data build error:', e.message);
    }
  }

  // 最新20件のみを messages に変換
  const recentHistory = history.slice(-5);
  const messages = [
    ...recentHistory.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: buildMessageContent(m.content, m.attachments),
    })),
    { role: 'user', content: buildMessageContent(String(text).trim(), msgAttachments) },
  ];

  // ユーザーメッセージを保存
  reg.appendConversation(companyId, {
    id: 'msg-' + Date.now(),
    role: 'user',
    agentId: null,
    content: String(text).trim(),
    delegations: [],
    timestamp: new Date().toISOString(),
  });

  let fullResponse = '';
  const agents = reg.loadAgents(companyId);

  streamStart('secretary', null, companyId);
  try {
    await streamAnthropic({
      apiKey,
      model,
      system,
      messages,
      onText: (chunk) => {
        fullResponse += chunk;
        sendSSE({ type: 'token', content: chunk });
      },
    });
  } catch (e) {
    streamEnd('secretary', null, companyId);
    if (e.isCredit) {
      sendSSE({ type: 'error', message: 'APIクレジットが不足しています。設定画面でAPIキーを確認してください。' });
    } else {
      sendSSE({ type: 'token', content: `\n[エラー: ${e.message}]` });
    }
    sendSSE({ type: 'done' });
    res.end();
    return;
  }
  streamEnd('secretary', null, companyId);

  // レスポンス解析・ブロック処理
  const delegations = [];

  // DELEGATE ブロック処理
  const delegateRe = /###DELEGATE\s+agentId="([^"]+)"\s+task="([^"]+)"(?:\s+progress="(\d+)")?(?:\s+estimatedMinutes="(\d+)")?(?:\s+weight="([^"]*)")?###/g;
  let m;
  while ((m = delegateRe.exec(fullResponse)) !== null) {
    const [, agentId, task, progress = '0', estimatedMinutes, weight = 'light'] = m;
    const agent = agents.find((a) => a.id === agentId);
    if (agent) {
      const patch = { status: 'working', currentTask: task, progress: Number(progress), lastActiveAt: new Date().toISOString() };
      // estimatedMinutesは明示的に指定がある場合のみ設定（デフォルト5分などの固定値を避ける）
      if (estimatedMinutes) patch.estimatedMinutes = Number(estimatedMinutes);
      else patch.estimatedMinutes = null;
      const result = reg.updateAgentById(agentId, patch);
      if (result) {
        broadcastToCompany(result.companyId, {
          type: 'agent_status', agentId,
          status: 'working', progress: Number(progress),
          estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
          currentTask: task, lastActiveAt: patch.lastActiveAt,
        });
      }
      delegations.push({ agentId, task });
      sendSSE({ type: 'delegation', agentId, agentName: agent.displayName || agent.name, task });

      // AgentExecutorでバックグラウンド実行
      const s = readAppSettings();
      const execApiKey = s.anthropicApiKey || '';
      const execModel = s.model || 'claude-sonnet-4-20250514';
      if (execApiKey.trim()) {
        const executor = new AgentExecutor({
          apiKey: execApiKey,
          model: execModel,
          companyId,
          agents,
          broadcast: (msg) => broadcastToCompany(companyId, msg),
          skillsDir: path.join(__dirname, 'core', 'skills'),
          saveTaskMessage,
          githubToken: getGithubToken('personal') || getGithubToken('company'),
          workspace: readAppSettings().workspace,
        });
        const execTaskId = 'task-exec-' + Date.now();
        const onExecProgress = (progressData) => {
          broadcastToCompany(companyId, { type: 'agent_progress', ...progressData });
          if (progressData.message && progressData.type === 'agent_message') {
            saveTaskMessage(execTaskId, {
              role: 'agent', content: progressData.message,
              agentId, agentName: agent.displayName || agent.name,
              agentAvatar: agent.avatar || '🤖',
              timestamp: new Date().toISOString(),
            });
          }
        };
        console.log(`[AgentExecutor] 起動: ${agent.displayName || agent.name} - ${task.slice(0, 50)}... (weight=${weight})`);
        executor.execute(agent, task, execTaskId, 0, onExecProgress, weight).then((result) => {
          const agentName = agent.displayName || agent.name;
          console.log(`[AgentExecutor] 完了: ${agentName}`);
          const summary = (result.response || '').replace(/###[^#]*###/g, '').trim().slice(0, 300);
          handleAgentCompletion(companyId, agentId, agentName, summary || `${agentName}が作業を完了しました`, execTaskId, true);
        }).catch((err) => {
          console.error(`[AgentExecutor] エラー: ${agent.displayName || agent.name}`, err.message);
          handleAgentCompletion(companyId, agentId, agent.displayName || agent.name, err.message, execTaskId, false);
        });
      }
    }
  }

  // PROGRESS ブロック処理
  const progressRe = /###PROGRESS\s+agentId="([^"]+)"\s+progress="(\d+)"(?:\s+estimatedMinutes="(\d+)")?(?:\s+currentTask="([^"]+)")?###/g;
  while ((m = progressRe.exec(fullResponse)) !== null) {
    const [, agentId, progress, estimatedMinutes, currentTask = ''] = m;
    const newProgress = Number(progress);

    // 進捗後退防止：前回より小さい値は警告して無視
    const existingAgent = agents.find((a) => a.id === agentId);
    if (existingAgent && existingAgent.progress > newProgress) {
      console.warn(`[warn] ${existingAgent.name}: progress後退を検知 (${existingAgent.progress}% → ${newProgress}%) - 無視します`);
      continue;
    }

    const patch = { progress: newProgress, currentTask, lastActiveAt: new Date().toISOString() };
    // estimatedMinutesが指定されていない場合はnullのまま（デフォルト値を入れない）
    if (estimatedMinutes) patch.estimatedMinutes = Number(estimatedMinutes);
    const result = reg.updateAgentById(agentId, patch);
    if (result) {
      broadcastToCompany(result.companyId, { type: 'agent_status', agentId, ...patch });
    }
  }

  // JD_UPDATE ブロック処理
  const jdRe = /###JD_UPDATE\s+agentId="([^"]+)"\s+proposedJd="([^"]+)"###/g;
  while ((m = jdRe.exec(fullResponse)) !== null) {
    const [, agentId, proposedJd] = m;
    const agent = agents.find((a) => a.id === agentId);
    const result = reg.updateAgentById(agentId, { pendingJdUpdate: proposedJd });
    if (result) {
      broadcastToCompany(result.companyId, { type: 'jd_proposal', agentId, proposedJd });
      sendSSE({ type: 'jd_proposal', agentId, agentName: agent?.name || agentId, proposedJd });
    }
  }

  // COMPLETED ブロック処理 → "review"（FB待ち）に遷移
  // 拡張構文: ###COMPLETED agentId="..." savedTo="github" savedPath="owner/repo/path" summary="説明"###
  const completedRe = /###COMPLETED\s+agentId="([^"]+)"(?:\s+savedTo="([^"]*)")?(?:\s+savedPath="([^"]*)")?(?:\s+taskId="([^"]*)")?(?:\s+summary="([^"]*)")?###/g;
  while ((m = completedRe.exec(fullResponse)) !== null) {
    const [, agentId, savedTo, savedPath, completedTaskId, completedSummary] = m;
    const agent = agents.find((a) => a.id === agentId);
    const result = reg.updateAgentById(agentId, { status: 'review', progress: 100, lastActiveAt: new Date().toISOString() });
    if (result) {
      broadcastToCompany(result.companyId, { type: 'agent_status', agentId, status: 'review', progress: 100 });
      if (agent) {
        const saveMsg = savedTo && savedPath
          ? `\n✅ ${agent.name}が作業を完了しました → ${savedTo}:${savedPath}`
          : `\n✅ ${agent.name}が作業を完了しました。FB待ち状態です。`;
        sendSSE({ type: 'token', content: saveMsg });
      }
    }
    // savedToとsavedPathがある場合はアクティビティログに記録
    if (savedTo && savedPath && agent) {
      logActivity({
        agentId,
        agentName: agent.name,
        taskId: completedTaskId || null,
        action: 'create',
        destination: savedTo,
        destinationPath: savedPath,
        summary: completedSummary || `${agent.name}が作業完了・保存`,
      });
    }
  }

  // PR_REQUEST ブロック処理 → PR作成後に "review"（FB待ち）に遷移
  // agentIdオプション付き構文: ###PR_REQUEST agentId="..." owner="..." ...###
  const prReqRe = /###PR_REQUEST(?:\s+agentId="([^"]*)")?(?:\s+owner="([^"]+)")?\s+(?:owner="([^"]+)"\s+)?repo="([^"]+)"\s+title="([^"]+)"\s+body="([^"]*?)"\s+head="([^"]+)"\s+base="([^"]+)"###/g;
  while ((m = prReqRe.exec(fullResponse)) !== null) {
    const prAgentId = m[1] || null;
    const owner = m[2] || m[3];
    const [, , , , repo, title, prBody, head, base] = m;
    if (!owner || !repo) continue;
    const permission = getRepoPermission(owner, repo);
    if (permission === 'pr') {
      const token = getGithubToken('personal');
      if (token) {
        const prResult = await createPullRequest(owner, repo, title, prBody, head, base, token, permission);
        if (prResult.success) {
          const prUrl = prResult.data.html_url || '';
          sendSSE({ type: 'pr_created', owner, repo, pullNumber: prResult.data.number, title });
          if (prAgentId) {
            const prAgent = agents.find((a) => a.id === prAgentId);
            const prRes = reg.updateAgentById(prAgentId, { status: 'review', lastActiveAt: new Date().toISOString() });
            if (prRes) {
              broadcastToCompany(prRes.companyId, { type: 'agent_status', agentId: prAgentId, status: 'review' });
              if (prAgent) {
                sendSSE({ type: 'token', content: `\n✅ ${prAgent.name}がPRを作成しました。確認・FBをお願いします。\n→ ${owner}/${repo}#${prResult.data.number}` });
                logActivity({
                  agentId: prAgentId,
                  agentName: prAgent.name,
                  action: 'pr',
                  destination: 'github',
                  destinationName: `${owner}/${repo}`,
                  destinationPath: `pull/${prResult.data.number}`,
                  destinationUrl: prUrl,
                  summary: `PR作成: ${title}`,
                });
              }
            }
          }
        }
      }
    }
  }

  // IDLE ブロック処理 → 明示的に "idle"（待機中）に遷移
  // 使用例: ###IDLE agentId="..."###
  const idleRe = /###IDLE\s+agentId="([^"]+)"###/g;
  while ((m = idleRe.exec(fullResponse)) !== null) {
    const [, agentId] = m;
    const agent = agents.find((a) => a.id === agentId);
    const result = reg.updateAgentById(agentId, {
      status: 'idle', progress: 0, currentTask: '', estimatedMinutes: null, lastActiveAt: new Date().toISOString(),
    });
    if (result) {
      broadcastToCompany(result.companyId, { type: 'agent_status', agentId, status: 'idle', progress: 0, currentTask: '' });
      if (agent) {
        sendSSE({ type: 'token', content: `\n${agent.name}が待機状態に戻りました。` });
      }
    }
  }

  // WAITING ブロック処理 → "waiting"（承認待ち）に遷移
  // 使用例: ###WAITING agentId="..." reason="..."###
  const waitingRe = /###WAITING\s+agentId="([^"]+)"(?:\s+reason="([^"]*)")?###/g;
  while ((m = waitingRe.exec(fullResponse)) !== null) {
    const [, agentId, reason = ''] = m;
    const agent = agents.find((a) => a.id === agentId);
    const result = reg.updateAgentById(agentId, { status: 'waiting', lastActiveAt: new Date().toISOString() });
    if (result) {
      broadcastToCompany(result.companyId, { type: 'agent_status', agentId, status: 'waiting' });
      if (agent) {
        const msg = reason
          ? `\n${agent.name}が承認待ち状態です。理由：${reason}`
          : `\n${agent.name}が承認待ち状態です。判断をお願いします。`;
        sendSSE({ type: 'token', content: msg });
      }
    }
  }

  // PR_MERGE ブロック処理 → 事前確認必須
  const prMergeRe = /###PR_MERGE\s+owner="([^"]+)"\s+repo="([^"]+)"\s+pullNumber="(\d+)"(?:\s+agentId="([^"]*)")?(?:\s+taskId="([^"]*)")?###/g;
  while ((m = prMergeRe.exec(fullResponse)) !== null) {
    const [, owner, repo, pullNumber, mergeAgentId, mergeTaskId] = m;
    const mergeAgent = mergeAgentId ? agents.find((a) => a.id === mergeAgentId) : null;
    const pendingId = 'pend-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    pendingActions.set(pendingId, {
      type: 'PR_MERGE', owner, repo, pullNumber,
      agentId: mergeAgentId, taskId: mergeTaskId,
    });
    sendSSE({
      type: 'confirm_required',
      pendingId,
      agentId: mergeAgentId,
      agentName: mergeAgent?.name || null,
      action: 'merge',
      destinationName: `${owner}/${repo}`,
      destinationPath: `pull/${pullNumber}`,
      summary: `PRマージ: ${owner}/${repo}#${pullNumber}`,
    });
  }

  // FILE_UPDATE ブロック処理 → 事前確認必須
  const fileUpdateRe = /###FILE_UPDATE\s+owner="([^"]+)"\s+repo="([^"]+)"\s+path="([^"]+)"\s+content="([^"]*?)"\s+agentId="([^"]*)"\s+taskId="([^"]*)"\s+summary="([^"]*)"###/g;
  while ((m = fileUpdateRe.exec(fullResponse)) !== null) {
    const [, owner, repo, filePath, content, fuAgentId, fuTaskId, summary] = m;
    const fuAgent = agents.find((a) => a.id === fuAgentId);
    const pendingId = 'pend-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    pendingActions.set(pendingId, {
      type: 'FILE_UPDATE', owner, repo, path: filePath, content,
      agentId: fuAgentId, taskId: fuTaskId, summary,
    });
    sendSSE({
      type: 'confirm_required',
      pendingId,
      agentId: fuAgentId,
      agentName: fuAgent?.name || null,
      action: 'update',
      destinationName: `${owner}/${repo}`,
      destinationPath: filePath,
      summary,
    });
  }

  // FILE_CREATE ブロック処理 → 即実行（確認不要）
  const fileCreateRe = /###FILE_CREATE\s+owner="([^"]+)"\s+repo="([^"]+)"\s+path="([^"]+)"\s+content="([^"]*?)"\s+agentId="([^"]*)"\s+taskId="([^"]*)"\s+summary="([^"]*)"###/g;
  while ((m = fileCreateRe.exec(fullResponse)) !== null) {
    const [, owner, repo, filePath, content, fcAgentId, fcTaskId, summary] = m;
    const fcAgent = agents.find((a) => a.id === fcAgentId);
    const permission = getRepoPermission(owner, repo);
    const token = getGithubToken(permission === 'pr' ? 'personal' : 'company');
    if (token) {
      const fcResult = await updateFileContent(owner, repo, filePath, content, summary || 'Create by OneCompanyOps', token, permission);
      if (fcResult.success) {
        const fileUrl = `https://github.com/${owner}/${repo}/blob/main/${filePath}`;
        logActivity({
          agentId: fcAgentId,
          agentName: fcAgent?.name || null,
          taskId: fcTaskId,
          action: 'create',
          destination: 'github',
          destinationName: `${owner}/${repo}`,
          destinationPath: filePath,
          destinationUrl: fileUrl,
          summary: summary || `ファイル作成: ${filePath}`,
        });
        sendSSE({ type: 'token', content: `\n✅ ファイルを作成しました: ${owner}/${repo}/${filePath}\n→ ${fileUrl}` });
      } else {
        sendSSE({ type: 'token', content: `\n❌ ファイル作成に失敗: ${fcResult.error}` });
      }
    }
  }

  // NOTION_UPDATE ブロック処理 → 事前確認必須
  const notionUpdateRe = /###NOTION_UPDATE\s+pageId="([^"]+)"\s+properties="([^"]*?)"\s+agentId="([^"]*)"\s+taskId="([^"]*)"\s+summary="([^"]*)"###/g;
  while ((m = notionUpdateRe.exec(fullResponse)) !== null) {
    const [, pageId, properties, nuAgentId, nuTaskId, summary] = m;
    const nuAgent = agents.find((a) => a.id === nuAgentId);
    const pendingId = 'pend-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    pendingActions.set(pendingId, {
      type: 'NOTION_UPDATE', pageId, properties,
      agentId: nuAgentId, taskId: nuTaskId, summary,
    });
    sendSSE({
      type: 'confirm_required',
      pendingId,
      agentId: nuAgentId,
      agentName: nuAgent?.name || null,
      action: 'notion_update',
      destinationName: 'Notion',
      destinationPath: pageId,
      summary,
    });
  }

  // SHEETS_UPDATE ブロック処理 → 事前確認必須
  const sheetsUpdateRe = /###SHEETS_UPDATE\s+spreadsheetId="([^"]+)"\s+range="([^"]+)"\s+values="([^"]*?)"\s+agentId="([^"]*)"\s+taskId="([^"]*)"\s+summary="([^"]*)"###/g;
  while ((m = sheetsUpdateRe.exec(fullResponse)) !== null) {
    const [, spreadsheetId, range, values, suAgentId, suTaskId, summary] = m;
    const suAgent = agents.find((a) => a.id === suAgentId);
    const pendingId = 'pend-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    pendingActions.set(pendingId, {
      type: 'SHEETS_UPDATE', spreadsheetId, range, values,
      agentId: suAgentId, taskId: suTaskId, summary,
    });
    sendSSE({
      type: 'confirm_required',
      pendingId,
      agentId: suAgentId,
      agentName: suAgent?.name || null,
      action: 'sheets_update',
      destinationName: 'Google Sheets',
      destinationPath: `${spreadsheetId}!${range}`,
      summary,
    });
  }

  // WORKSPACE_SAVE ブロック処理 → 即実行（確認不要）
  // 構文: ###WORKSPACE_SAVE agentId="..." taskId="..." content="..." path="..." summary="説明"###
  const wsSaveRe = /###WORKSPACE_SAVE\s+agentId="([^"]*)"\s+taskId="([^"]*)"\s+content="([^"]*?)"\s+path="([^"]+)"\s+summary="([^"]*)"###/g;
  while ((m = wsSaveRe.exec(fullResponse)) !== null) {
    const [, wsAgentId, wsTaskId, wsContent, wsPath, wsSummary] = m;
    const wsAgent = agents.find((a) => a.id === wsAgentId);
    const wsBase = path.join(require('os').homedir(), '.onecompanyops-workspace');
    const wsFilePath = path.join(wsBase, wsPath.replace(/^\//, ''));
    try {
      require('fs').mkdirSync(path.dirname(wsFilePath), { recursive: true });
      require('fs').writeFileSync(wsFilePath, wsContent, 'utf8');
      // git commit & push
      try {
        execSync('git add . && git commit -m "' + wsSummary.replace(/"/g, '\\"') + '" && git push', {
          cwd: wsBase, stdio: 'pipe',
        });
      } catch (gitErr) {
        console.warn('[workspace-save] git error:', gitErr.message?.slice(0, 100));
      }
      logActivity({
        agentId: wsAgentId,
        agentName: wsAgent?.name || wsAgentId,
        taskId: wsTaskId || null,
        action: 'workspace',
        destination: 'workspace',
        destinationPath: wsPath,
        summary: wsSummary,
      });
      sendSSE({ type: 'token', content: `\n✅ ${wsAgent?.name || wsAgentId}: Workspaceに保存 → ${wsPath}` });
    } catch (e) {
      sendSSE({ type: 'token', content: `\n⚠️ Workspace保存エラー: ${e.message}` });
    }
  }

  // NOTION_CREATE ブロック処理 → 即実行（確認不要）
  const notionCreateRe = /###NOTION_CREATE\s+databaseId="([^"]+)"\s+properties="([^"]*?)"\s+agentId="([^"]*)"\s+taskId="([^"]*)"\s+summary="([^"]*)"###/g;
  while ((m = notionCreateRe.exec(fullResponse)) !== null) {
    const [, databaseId, properties, ncAgentId, ncTaskId, summary] = m;
    const ncAgent = agents.find((a) => a.id === ncAgentId);
    try {
      const token = getNotionToken();
      if (token) {
        const result = await notion.createPage(token, databaseId, properties);
        if (result.success) {
          sendSSE({ type: 'token', content: `\n✅ Notionページ作成完了: ${summary}` });
          logActivity({ agentId: ncAgentId, agentName: ncAgent?.name || ncAgentId, taskId: ncTaskId, action: 'notion_create', destination: 'notion', summary });
        } else {
          sendSSE({ type: 'token', content: `\n⚠️ Notion作成エラー: ${result.error}` });
        }
      }
    } catch (e) {
      sendSSE({ type: 'token', content: `\n⚠️ Notion作成エラー: ${e.message}` });
    }
  }

  // NOTION_QUERY ブロック処理 → 即実行（読み取りのみ）
  const notionQueryRe = /###NOTION_QUERY\s+databaseId="([^"]+)"(?:\s+filter="([^"]*?)")?(?:\s+agentId="([^"]*)")?(?:\s+taskId="([^"]*)")?###/g;
  while ((m = notionQueryRe.exec(fullResponse)) !== null) {
    const [, databaseId, filter, nqAgentId, nqTaskId] = m;
    try {
      const token = getNotionToken();
      if (token) {
        const result = await notion.queryDatabase(token, databaseId, filter || null);
        if (result.success) {
          const count = result.data?.length || 0;
          sendSSE({ type: 'token', content: `\n📋 Notionから${count}件のデータを取得しました` });
        }
      }
    } catch (e) {
      sendSSE({ type: 'token', content: `\n⚠️ Notionクエリエラー: ${e.message}` });
    }
  }

  // SHEETS_READ ブロック処理 → 即実行（読み取りのみ）
  const sheetsReadRe = /###SHEETS_READ\s+spreadsheetId="([^"]+)"\s+range="([^"]+)"(?:\s+agentId="([^"]*)")?(?:\s+taskId="([^"]*)")?###/g;
  while ((m = sheetsReadRe.exec(fullResponse)) !== null) {
    const [, spreadsheetId, range, srAgentId] = m;
    try {
      const creds = getSheetsCredentials();
      if (creds) {
        const result = await sheets.readRange(creds, spreadsheetId, range);
        if (result.success) {
          const rows = result.data?.length || 0;
          sendSSE({ type: 'token', content: `\n📊 Sheetsから${rows}行のデータを取得しました` });
        }
      }
    } catch (e) {
      sendSSE({ type: 'token', content: `\n⚠️ Sheets読み取りエラー: ${e.message}` });
    }
  }

  // SHEETS_APPEND ブロック処理 → 即実行（確認不要）
  const sheetsAppendRe = /###SHEETS_APPEND\s+spreadsheetId="([^"]+)"\s+range="([^"]+)"\s+values="([^"]*?)"\s+agentId="([^"]*)"\s+taskId="([^"]*)"\s+summary="([^"]*)"###/g;
  while ((m = sheetsAppendRe.exec(fullResponse)) !== null) {
    const [, spreadsheetId, range, values, saAgentId, saTaskId, summary] = m;
    const saAgent = agents.find((a) => a.id === saAgentId);
    try {
      const creds = getSheetsCredentials();
      if (creds) {
        const parsedValues = typeof values === 'string' ? JSON.parse(values) : values;
        const result = await sheets.appendRows(creds, spreadsheetId, range, parsedValues);
        if (result.success) {
          sendSSE({ type: 'token', content: `\n✅ Sheetsに追記完了: ${summary}` });
          logActivity({ agentId: saAgentId, agentName: saAgent?.name || saAgentId, taskId: saTaskId, action: 'sheets_append', destination: 'sheets', summary });
        } else {
          sendSSE({ type: 'token', content: `\n⚠️ Sheets追記エラー: ${result.error}` });
        }
      }
    } catch (e) {
      sendSSE({ type: 'token', content: `\n⚠️ Sheets追記エラー: ${e.message}` });
    }
  }

  // GA4_REPORT ブロック処理 → 即実行（読み取りのみ）
  const ga4ReportRe = /###GA4_REPORT\s+propertyId="([^"]+)"\s+startDate="([^"]+)"\s+endDate="([^"]+)"\s+metrics="([^"]+)"\s+dimensions="([^"]*)"(?:\s+agentId="([^"]*)")?(?:\s+taskId="([^"]*)")?###/g;
  while ((m = ga4ReportRe.exec(fullResponse)) !== null) {
    const [, propertyId, startDate, endDate, metrics, dimensions] = m;
    try {
      const config = getGA4Config();
      if (config?.credentials) {
        const ga4 = require('./lib/ga4-connector');
        const result = await ga4.runReport(config.credentials, propertyId, { dateRange: { startDate, endDate }, metrics: metrics.split(',').map(m => ({ name: m.trim() })), dimensions: dimensions ? dimensions.split(',').map(d => ({ name: d.trim() })) : [] });
        if (result.success) {
          const rows = result.data?.rows?.length || 0;
          sendSSE({ type: 'token', content: `\n📈 GA4から${rows}件のレポートデータを取得しました` });
        }
      }
    } catch (e) {
      sendSSE({ type: 'token', content: `\n⚠️ GA4レポートエラー: ${e.message}` });
    }
  }

  // RESOURCE_LINK ブロック処理
  const resourceLinkRe = /###RESOURCE_LINK\s+agentIds="(\[[^\]]*\])"\s+url="([^"]+)"###/g;
  while ((m = resourceLinkRe.exec(fullResponse)) !== null) {
    const [, agentIdsStr, resUrl] = m;
    try {
      const agentIds = JSON.parse(agentIdsStr);
      const detected = detectResourceFromUrl(resUrl);
      if (detected) {
        for (const aid of agentIds) {
          const found = reg.findAgentById(aid);
          if (!found) continue;
          const agent = found.agent;
          if (!agent.resources) agent.resources = [];
          agent.resources.push({ ...detected, id: 'res-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), name: detected.repo || detected.spreadsheetId || detected.databaseId || resUrl, permission: 'read' });
          reg.updateAgentById(aid, { resources: agent.resources });
        }
        broadcastToCompany(companyId, { type: 'agents_reloaded' });
        console.log(`[resource-link] ${agentIds.length}名にリソース紐付け: ${resUrl}`);
      }
    } catch (e) {
      console.error('[resource-link] error:', e.message);
    }
  }

  // 秘書レスポンスのパターン���タスクwaitingを自動���出
  const WAITING_PATTERNS = [
    '確認してください', 'いかがでしょうか', 'よろしいですか',
    '承認をお願い', 'FBをお願い', 'どうしますか', 'ご判断ください',
  ];
  const strippedResponse = fullResponse.replace(/###[^#]*###/g, '');
  if (WAITING_PATTERNS.some((p) => strippedResponse.includes(p))) {
    sendSSE({ type: 'task_waiting' });
  }

  // DIVISION_REPORT ブロック処理
  const divisionReportRe = /###DIVISION_REPORT\s+divisionHeadId="([^"]+)"\s+summary="([^"]*)"\s+completedTasks="([^"]*)"\s+issues="([^"]*)"###/g;
  while ((m = divisionReportRe.exec(fullResponse)) !== null) {
    const [, divisionHeadId, summary, completedTasksStr, issues] = m;
    const divHeadAgent = agents.find((a) => a.id === divisionHeadId);
    const divHeadName = divHeadAgent?.displayName || divHeadAgent?.name || divisionHeadId;

    // アクティビティログに記録
    logActivity({
      agentId: divisionHeadId,
      agentName: divHeadName,
      action: 'division_report',
      summary: `[事業部長報告] ${summary.slice(0, 80)}`,
      details: issues ? `issues: ${issues}` : null,
    });

    // WebSocketブロードキャスト
    broadcastToCompany(companyId, {
      type: 'division_report',
      divisionHeadId,
      divisionHeadName: divHeadName,
      summary,
      completedTasks: completedTasksStr,
      issues,
    });

    // issues がある場合のみYutaへのSSEに含める
    if (issues && issues.trim()) {
      sendSSE({
        type: 'token',
        content: `\n⚠️ **${divHeadName}からブロッカー報告**: ${issues}`,
      });
    }
    // issues なし → バックグラウンドログのみ（Yutaへの通知不要）
  }

  // 繰り返しパターン検出 → Skills自動生成トリガー
  // 非同期で実行（レスポンスをブロックしない）
  setImmediate(() => {
    try {
      const actLog = getActivityLog({ limit: 200 });
      for (const agent of agents) {
        const patterns = detectRepetitivePatterns(agent.id, actLog);
        if (patterns.length > 0) {
          const skillsDir = path.join(__dirname, 'core', 'skills');
          const s = readAppSettings();
          const apiKeys = { anthropicApiKey: s.anthropicApiKey };
          for (const pattern of patterns) {
            const skillFileName = `auto-${agent.id.slice(-6)}-${Date.now()}.md`;
            const skillPath = path.join(skillsDir, 'auto-generated', skillFileName);
            // 既に同じパターンでSkillsが存在する場合はスキップ（重複生成防止）
            const autoDir = path.join(skillsDir, 'auto-generated');
            if (fs.existsSync(autoDir)) {
              const existing = fs.readdirSync(autoDir).find((f) => f.includes(agent.id.slice(-6)));
              if (existing) continue;
            }
            generateSkillFromPattern(pattern, agent.displayName || agent.name, skillPath, apiKeys)
              .then((result) => {
                if (result.success) {
                  console.log(`[skills-auto] Generated: ${skillPath}`);
                  broadcastToCompany(companyId, {
                    type: 'skill_generated',
                    agentId: agent.id,
                    agentName: agent.displayName || agent.name,
                    skillPath,
                    pattern,
                  });
                }
              })
              .catch((e) => console.error('[skills-auto] error:', e.message));
          }
        }
      }
    } catch (e) {
      console.error('[skills-auto] pattern check error:', e.message);
    }
  });

  // 秘書メッセージを会話履歴に保存
  reg.appendConversation(companyId, {
    id: 'msg-' + (Date.now() + 1),
    role: 'secretary',
    agentId: null,
    content: fullResponse,
    delegations,
    timestamp: new Date().toISOString(),
  });

  sendSSE({ type: 'done' });
  res.end();
});

// 会話履歴取得
app.get('/api/secretary/history', (req, res) => {
  const companyId = req.query.companyId || reg.primaryCompanyId();
  res.json({ messages: reg.loadConversation(companyId) });
});

// ── タスクタイトル自動生成 ──────────────────────────────────────────────────
app.post('/api/task/generate-title', async (req, res) => {
  const { message, text } = req.body || {};
  const messageText = text || message;
  if (!messageText) return res.status(400).json({ error: 'message is required' });
  // 挨拶パターンの即時判定
  const greetings = ['おはよう', 'こんにちは', 'こんばんは', 'おはようございます', 'good morning'];
  if (greetings.some((g) => messageText.trim().toLowerCase().startsWith(g))) {
    return res.json({ title: '朝のブリーフィング' });
  }

  const s = readAppSettings();
  const apiKey = s.anthropicApiKey || '';
  if (!apiKey.trim()) return res.json({ title: messageText.slice(0, 10) || '新しいタスク' });
  try {
    let title = '';
    await streamAnthropic({
      apiKey,
      model: 'claude-haiku-4-5-20251001',
      system: 'ユーザーの指示から自然な日本語タスク名を生成。ルール：指示の核心を12文字以内で表す。余計な語（「の件」「について」「してください」）は省く。例：「WAVERSの競合調査をして」→「WAVERS競合調査」、「トムにREADMEを確認させて」→「README確認」、「売上レポートを作って」→「売上レポート作成」。タイトルのみ返す。',
      messages: [{ role: 'user', content: String(messageText).slice(0, 200) }],
      onText: (chunk) => { title += chunk; },
    });
    res.json({ title: stripMarkdown(title.trim()).slice(0, 12) || '新しいタスク' });
  } catch {
    res.json({ title: messageText.slice(0, 10) || '新しいタスク' });
  }
});

// ── Skills生成API ─────────────────────────────────────────────────────────────

app.post('/api/skills/generate', async (req, res) => {
  const { pattern, agentName, skillName, targetDir } = req.body || {};
  if (!pattern || !agentName) return res.status(400).json({ error: 'pattern, agentName は必須です' });

  const skillsDir = path.join(__dirname, 'core', 'skills');
  const subDir = targetDir ? path.join(skillsDir, targetDir) : path.join(skillsDir, 'auto-generated');
  const fileName = (skillName || `${agentName}-${Date.now()}`).replace(/[^a-zA-Z0-9\-_\u3040-\u30FF\u4E00-\u9FFF]/g, '-') + '.md';
  const targetPath = path.join(subDir, fileName);

  const s = readAppSettings();
  const apiKeys = { anthropicApiKey: s.anthropicApiKey };

  const result = await generateSkillFromPattern(pattern, agentName, targetPath, apiKeys);
  if (!result.success) return res.status(500).json({ error: result.error });

  logActivity({
    agentName,
    action: 'create',
    destination: 'workspace',
    destinationPath: targetPath.replace(__dirname, ''),
    summary: `Skillsファイル自動生成: ${fileName}`,
  });

  res.json({ success: true, path: targetPath.replace(__dirname, ''), content: result.content });
});

app.get('/api/skills/report', async (req, res) => {
  const skillsDir = path.join(__dirname, 'core', 'skills');
  const result = await collectDailySkillsReport(skillsDir);
  if (!result) return res.json({ success: true, report: null, newSkills: [], message: '本日新規作成されたSkillsはありません' });
  res.json(result);
});

// ── Integration helpers ──────────────────────────────────────────────────────

function getNotionToken(accountId) {
  const s = readAppSettings();
  const accounts = s.integrations?.notion;
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (accountId) { const a = accounts.find((x) => x.id === accountId); return a?.token || null; }
  return accounts[0]?.token || null;
}

function getSheetsCredentials(accountId) {
  const s = readAppSettings();
  const accounts = s.integrations?.googleSheets;
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (accountId) { const a = accounts.find((x) => x.id === accountId); return a?.credentials || null; }
  return accounts[0]?.credentials || null;
}

function getGA4Config(accountId) {
  const s = readAppSettings();
  const accounts = s.integrations?.googleAnalytics;
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (accountId) return accounts.find((x) => x.id === accountId) || null;
  return accounts[0] || null;
}

// ── Notion endpoints ──

app.get('/api/integrations/notion/test', async (req, res) => {
  const token = req.headers['x-notion-token'] || getNotionToken(req.query.accountId);
  if (!token) return res.json({ ok: false, error: 'Notion tokenが未設定です' });
  res.json(await notion.testConnection(token));
});

app.get('/api/integrations/notion/databases', async (req, res) => {
  const token = getNotionToken(req.query.accountId);
  if (!token) return res.json({ success: false, error: 'Notion tokenが未設定です' });
  res.json(await notion.listDatabases(token));
});

app.post('/api/integrations/notion/query', async (req, res) => {
  const token = getNotionToken(req.body.notionAccountId);
  if (!token) return res.json({ success: false, error: 'Notion tokenが未設定です' });
  res.json(await notion.queryDatabase(token, req.body.databaseId, req.body.filter, req.body.sorts));
});

app.post('/api/integrations/notion/pages', async (req, res) => {
  const token = getNotionToken(req.body.notionAccountId);
  if (!token) return res.json({ success: false, error: 'Notion tokenが未設定です' });
  res.json(await notion.createPage(token, req.body.databaseId, req.body.properties));
});

app.put('/api/integrations/notion/pages/:pageId', async (req, res) => {
  const token = getNotionToken(req.body.notionAccountId);
  if (!token) return res.json({ success: false, error: 'Notion tokenが未設定です' });
  res.json(await notion.updatePage(token, req.params.pageId, req.body.properties));
});

app.get('/api/integrations/notion/pages/:pageId', async (req, res) => {
  const token = getNotionToken(req.query.accountId);
  if (!token) return res.json({ success: false, error: 'Notion tokenが未設定です' });
  res.json(await notion.getPage(token, req.params.pageId));
});

app.get('/api/integrations/notion/search', async (req, res) => {
  const token = getNotionToken(req.query.accountId);
  if (!token) return res.json({ success: false, error: 'Notion tokenが未設定です' });
  res.json(await notion.searchPages(token, req.query.q));
});

// ── Google Sheets endpoints ──

app.get('/api/integrations/sheets/test', async (req, res) => {
  const creds = getSheetsCredentials(req.query.accountId);
  if (!creds) return res.json({ ok: false, error: 'Sheets認証情報が未設定です' });
  res.json(await sheets.testConnection(creds));
});

app.get('/api/integrations/sheets/:spreadsheetId/sheets', async (req, res) => {
  const creds = getSheetsCredentials(req.query.accountId);
  if (!creds) return res.json({ success: false, error: 'Sheets認証情報が未設定です' });
  res.json(await sheets.listSheets(creds, req.params.spreadsheetId));
});

app.post('/api/integrations/sheets/read', async (req, res) => {
  const creds = getSheetsCredentials(req.body.accountId);
  if (!creds) return res.json({ success: false, error: 'Sheets認証情報が未設定です' });
  res.json(await sheets.readRange(creds, req.body.spreadsheetId, req.body.range));
});

app.post('/api/integrations/sheets/write', async (req, res) => {
  const creds = getSheetsCredentials(req.body.accountId);
  if (!creds) return res.json({ success: false, error: 'Sheets認証情報が未設定です' });
  // 破壊的操作: confirm_required
  const pendingId = 'pend-sheets-' + Date.now();
  pendingActions.set(pendingId, {
    type: 'SHEETS_WRITE',
    credentials: creds,
    spreadsheetId: req.body.spreadsheetId,
    range: req.body.range,
    values: req.body.values,
  });
  res.json({ confirm_required: true, pendingId, summary: `Sheets上書き: ${req.body.range}` });
});

app.post('/api/integrations/sheets/append', async (req, res) => {
  const creds = getSheetsCredentials(req.body.accountId);
  if (!creds) return res.json({ success: false, error: 'Sheets認証情報が未設定です' });
  res.json(await sheets.appendRows(creds, req.body.spreadsheetId, req.body.range, req.body.values));
});

// ── GA4 endpoints ──

app.get('/api/integrations/ga4/test', async (req, res) => {
  const config = getGA4Config(req.query.accountId);
  if (!config?.credentials || !config?.propertyId) return res.json({ ok: false, error: 'GA4設定が未設定です' });
  res.json(await ga4.testConnection(config.credentials, config.propertyId));
});

app.post('/api/integrations/ga4/report', async (req, res) => {
  const config = getGA4Config(req.body.accountId);
  if (!config?.credentials || !config?.propertyId) return res.json({ success: false, error: 'GA4設定が未設定です' });
  res.json(await ga4.runReport(config.credentials, config.propertyId, {
    dateRange: req.body.dateRange,
    metrics: req.body.metrics,
    dimensions: req.body.dimensions,
  }));
});

app.get('/api/integrations/ga4/realtime', async (req, res) => {
  const config = getGA4Config(req.query.accountId);
  if (!config?.credentials || !config?.propertyId) return res.json({ success: false, error: 'GA4設定が未設定です' });
  res.json(await ga4.getRealtimeData(config.credentials, config.propertyId));
});

// ── Mixpanel連携 ──────────────────────────────────────────────────────────────

const mixpanel = require('./lib/mixpanel-connector');

function getMixpanelConfig(accountId) {
  const s = readAppSettings();
  const accounts = s.integrations?.mixpanel || [];
  return accountId ? accounts.find((a) => a.id === accountId) : accounts[0];
}

app.get('/api/integrations/mixpanel/test', async (req, res) => {
  const config = getMixpanelConfig(req.query.accountId);
  if (!config?.projectId || !config?.username || !config?.secret) return res.json({ success: false, error: 'Mixpanel設定が未設定です' });
  res.json(await mixpanel.testConnection(config.projectId, config.username, config.secret));
});

app.post('/api/integrations/mixpanel/events', async (req, res) => {
  const config = getMixpanelConfig(req.body.accountId);
  if (!config?.projectId || !config?.username || !config?.secret) return res.json({ success: false, error: 'Mixpanel設定が未設定です' });
  res.json(await mixpanel.queryEvents(config.projectId, config.username, config.secret, req.body));
});

// ── Google Calendar連携 ───────────────────────────────────────────────────────

const calendarConnector = require('./lib/calendar-connector');

function getCalendarAccounts() {
  const s = readAppSettings();
  return s.integrations?.googleCalendar || [];
}

app.get('/api/integrations/calendar/test', async (req, res) => {
  const accounts = getCalendarAccounts();
  const account = req.query.accountId ? accounts.find((a) => a.id === req.query.accountId) : accounts[0];
  if (!account?.credentials) return res.json({ success: false, error: 'カレンダーアカウントが設定されていません' });
  res.json(await calendarConnector.testConnection(account.credentials));
});

app.get('/api/integrations/calendar/today', async (req, res) => {
  const accounts = getCalendarAccounts();
  const allEvents = [];
  for (const account of accounts) {
    if (!account.credentials) continue;
    const result = await calendarConnector.listTodayEvents(account.credentials, account.label);
    if (result.success) allEvents.push(...result.events);
  }
  allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
  res.json({ success: true, events: allEvents });
});

// ── 朝ブリーフィングデータ構築 ────────────────────────────────────────────────

async function buildMorningBriefingData(companyId) {
  const s = readAppSettings();
  const data = { todayEvents: [], urgentTasks: [], workingAgents: [], _errors: [] };

  // 1. カレンダーから今日の予定を取得
  try {
    const accounts = s.integrations?.googleCalendar || [];
    if (accounts.length === 0) data._errors.push({ source: 'calendar', msg: '未連携' });
    for (const account of accounts) {
      if (!account.credentials) { data._errors.push({ source: 'calendar', msg: `${account.label}: credentials欠落` }); continue; }
      const result = await calendarConnector.listTodayEvents(account.credentials, account.label);
      if (result.success) data.todayEvents.push(...result.events);
      else data._errors.push({ source: 'calendar', msg: `${account.label}: ${result.error}` });
    }
    data.todayEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
  } catch (e) { data._errors.push({ source: 'calendar', msg: e.message }); }

  // 2. 緊急タスク
  try {
    const tasks = loadTasksFile();
    data.urgentTasks = tasks.filter((t) => t.status === 'active' || t.status === 'waiting' || t.status === 'review' || t.status === 'working').slice(0, 5);
  } catch (e) { data._errors.push({ source: 'tasks', msg: e.message }); }

  // 3. 稼働中エージェント
  try {
    const agents = reg.loadAgents(companyId);
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
    data.workingAgents = agents.filter((a) => (a.status === 'working' || a.status === 'review') && a.lastActiveAt && new Date(a.lastActiveAt).getTime() > thirtyMinAgo);
  } catch (e) { data._errors.push({ source: 'agents', msg: e.message }); }

  // 4. プロジェクト情報（Workspaceから読み込み）
  try {
    const ghToken = s.githubPersonalToken || s.githubCompanyToken || '';
    if (!ghToken) {
      data._errors.push({ source: 'workspace', msg: 'GitHub token 未設定' });
    } else {
      const { loadFileFromWorkspace } = require('./lib/workspace-memory');
      data.projectsContext = await loadFileFromWorkspace('memory/projects.md', ghToken);
      data.staleProjects = await detectStaleProjects(ghToken);
    }
  } catch (e) {
    console.error('[briefing] project context error:', e.message);
    data._errors.push({ source: 'workspace', msg: e.message });
  }

  return data;
}

function buildBriefingContext(data) {
  const eventsSection = data.todayEvents.length > 0
    ? data.todayEvents.map((e) => {
        const time = e.start ? new Date(e.start).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '終日';
        const important = e.isImportant ? ' ⭐重要' : '';
        return `  ${time} ${e.title}${important}`;
      }).join('\n')
    : '  （カレンダー未連携）';

  // FB待ちタスクのみ（reviewステータス）
  const reviewTasks = (data.urgentTasks || []).filter(t => t.status === 'review');
  const tasksSection = reviewTasks.length > 0
    ? reviewTasks.map((t) => `  → ${t.name}（FB待ち）`).join('\n')
    : '  特に緊急事項はありません';

  const agentsSection = data.workingAgents.length > 0
    ? data.workingAgents.map((a) => `  ${a.displayName || a.name}: ${a.currentTask || '作業中'}`).join('\n')
    : '  （全員待機中）';

  // プロジェクトコンテキスト（最大1500文字に制限）
  const projectsSection = data.projectsContext
    ? `\n\n### プロジェクト情報（memory/projects.mdから）\n${data.projectsContext.slice(0, 1500)}`
    : '';

  // 停滞プロジェクト
  const staleSection = data.staleProjects && data.staleProjects.length > 0
    ? `\n\n### 停滞プロジェクト（48時間以上更新なし）\n${data.staleProjects.map(p => `  ${p}`).join('\n')}`
    : '';

  // 連携エラー（silent catch を UI に可視化）
  const errorSection = (data._errors && data._errors.length > 0)
    ? `\n\n### ⚠️ 連携エラー（朝ブリーフィング時に発生）\n${data._errors.slice(0, 5).map((e) => `  ${e.source}: ${e.msg}`).join('\n')}\n\n↑上記はブリーフィング末尾に「⚠️ カレンダー: 未連携」のように1行だけ出してよい`
    : '';

  return `\n\n## BRIEFING_DATA（朝ブリーフィング用データ）\n\n### 本日の予定（カレンダー）\n${eventsSection}\n\n### 確認が必要なこと（FB待ちタスク）\n${tasksSection}\n\n### 稼働中エージェント\n${agentsSection}${projectsSection}${staleSection}${errorSection}\n\n## 朝ブリーフィング応答フォーマット（厳守）\n\n- 全体で **10行以内**。空行を含む\n- マークダウンの見出しは使わない（絵文字＋1行タイトルで代用）\n- 「〜について」「以下の通り」などの前置き禁止\n- 箇条書きは「・」始まり、最大5行\n- **プロジェクト名＋次のアクション** の形で書く（例: \`Overdue：App Storeスクショが未完成（申請ブロッカー）\`）\n- 停滞プロジェクトは 🔴 で列挙、最大3件\n- 最後に「何から始めますか？」で締める\n\n### 理想例\n\n\`\`\`\nおはようございます\n\n📋 今週の優先事項\n・Overdue：App Storeのスクショが未完成（申請ブロッカー）\n・BizSim：Supabaseスキーマが3日間停止中\n\n🔴 停滞アラート\n・JIGGY BEATSサイト：4日間更新なし\n\n何から始めますか？\n\`\`\`\n`;
}

// ── リソース管理 ──────────────────────────────────────────────────────────────

const { detectResourceFromUrl, getRequiredCredentials } = require('./lib/resource-detector');

app.post('/api/agents/detect-resource', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const detected = detectResourceFromUrl(url);
  if (!detected) return res.json({ success: false, error: 'URLからリソースを判定できませんでした' });
  const s = readAppSettings();
  const creds = getRequiredCredentials(detected.type, s);
  res.json({ success: true, resource: detected, credentialsAvailable: creds.available, credentialsMessage: creds.available ? null : creds.message });
});

app.get('/api/agents/:id/resources', (req, res) => {
  const found = reg.findAgentById(req.params.id);
  if (!found) return res.status(404).json({ error: 'not found' });
  res.json({ resources: found.agent.resources || [] });
});

app.post('/api/agents/:id/resources', async (req, res) => {
  const found = reg.findAgentById(req.params.id);
  if (!found) return res.status(404).json({ error: 'not found' });
  const { url, resource } = req.body;

  // URLから自動判定
  if (url) {
    const detected = detectResourceFromUrl(url);
    if (!detected) return res.json({ success: false, error: 'URLからリソースを判定できませんでした' });
    const s = readAppSettings();
    const creds = getRequiredCredentials(detected.type, s);
    if (!creds.available) return res.json({ needsCredentials: true, message: creds.message, type: detected.type });
    return res.json({ needsConfirmation: true, resourceInfo: { ...detected, name: detected.repo || detected.spreadsheetId || detected.databaseId || '' } });
  }

  // 直接追加
  if (resource) {
    const agent = found.agent;
    if (!agent.resources) agent.resources = [];
    if (!resource.id) resource.id = 'res-' + Date.now();
    agent.resources.push(resource);
    reg.updateAgentById(req.params.id, { resources: agent.resources });
    broadcastToCompany(found.companyId, { type: 'agents_reloaded' });
    return res.json({ success: true, resource });
  }

  res.status(400).json({ error: 'url or resource required' });
});

app.post('/api/agents/:id/resources/confirm', (req, res) => {
  const found = reg.findAgentById(req.params.id);
  if (!found) return res.status(404).json({ error: 'not found' });
  const { resourceInfo, confirmed } = req.body;
  if (!confirmed) return res.json({ success: true, cancelled: true });
  const agent = found.agent;
  if (!agent.resources) agent.resources = [];
  const resource = { ...resourceInfo, id: 'res-' + Date.now(), permission: resourceInfo.permission || 'read' };
  agent.resources.push(resource);
  reg.updateAgentById(req.params.id, { resources: agent.resources });
  broadcastToCompany(found.companyId, { type: 'agents_reloaded' });
  res.json({ success: true, resource });
});

app.delete('/api/agents/:id/resources/:resourceId', (req, res) => {
  const found = reg.findAgentById(req.params.id);
  if (!found) return res.status(404).json({ error: 'not found' });
  const agent = found.agent;
  if (!agent.resources) return res.json({ success: true });
  agent.resources = agent.resources.filter((r) => r.id !== req.params.resourceId);
  reg.updateAgentById(req.params.id, { resources: agent.resources });
  broadcastToCompany(found.companyId, { type: 'agents_reloaded' });
  res.json({ success: true });
});

// ── アクティビティログ ──────────────────────────────────────────────────────

app.get('/api/activity-log', (req, res) => {
  const { agentId, sectionName, taskId, destination, dateFrom, dateTo, limit } = req.query;
  const logs = getActivityLog({
    agentId, sectionName, taskId, destination, dateFrom, dateTo,
    limit: limit ? parseInt(limit, 10) : 100,
  });
  res.json({ logs });
});

// ── 確認待ち操作の承認・却下 ─────────────────────────────────────────────────

app.post('/api/action/confirm', async (req, res) => {
  const { pendingId, approved } = req.body || {};
  if (!pendingId) return res.status(400).json({ error: 'pendingId is required' });

  const pending = pendingActions.get(pendingId);
  if (!pending) return res.status(404).json({ error: 'pending action not found or already processed' });

  pendingActions.delete(pendingId);
  const agent = pending.agentId ? reg.findAgentById(pending.agentId)?.agent : null;

  if (!approved) {
    // 却下
    const cid = agent ? reg.findAgentById(pending.agentId)?.companyId : null;
    if (cid) {
      wss.clients.forEach((c) => {
        if (c.readyState === 1) c.send(JSON.stringify({
          type: 'action_cancelled', pendingId,
          agentId: pending.agentId, summary: pending.summary,
        }));
      });
    }
    return res.json({ ok: true, status: 'cancelled' });
  }

  // 承認 → 操作を実行
  try {
    let resultMsg = '';

    if (pending.type === 'PR_MERGE') {
      const { owner, repo, pullNumber } = pending;
      const permission = getRepoPermission(owner, repo);
      if (permission === 'pr') {
        const token = getGithubToken('personal');
        if (token) {
          await mergePullRequest(owner, repo, pullNumber, token, permission);
          logActivity({
            agentId: pending.agentId,
            agentName: agent?.name || null,
            taskId: pending.taskId,
            action: 'merge',
            destination: 'github',
            destinationName: `${owner}/${repo}`,
            destinationPath: `pull/${pullNumber}`,
            summary: `PRマージ: ${owner}/${repo}#${pullNumber}`,
          });
          resultMsg = `✅ PRをマージしました: ${owner}/${repo}#${pullNumber}`;
        }
      }

    } else if (pending.type === 'FILE_UPDATE') {
      const { owner, repo, path: filePath, content } = pending;
      const permission = getRepoPermission(owner, repo);
      const token = getGithubToken(permission === 'pr' ? 'personal' : 'company');
      if (token) {
        await updateFileContent(owner, repo, filePath, content, pending.summary, null, token);
        logActivity({
          agentId: pending.agentId,
          agentName: agent?.name || null,
          taskId: pending.taskId,
          action: 'update',
          destination: 'github',
          destinationName: `${owner}/${repo}`,
          destinationPath: filePath,
          summary: pending.summary,
        });
        resultMsg = `✅ ファイルを更新しました: ${owner}/${repo}/${filePath}`;
      }

    } else if (pending.type === 'NOTION_UPDATE') {
      // Notion更新（APIキーが必要）
      const settings = (() => {
        try { return JSON.parse(require('fs').readFileSync(path.join(DATA_DIR, 'app-settings.json'), 'utf8')); } catch { return {}; }
      })();
      const notionAccounts = Array.isArray(settings.integrations?.notion) ? settings.integrations.notion : [];
      const notionToken = notionAccounts[0]?.token;
      if (notionToken && notionToken !== '****') {
        await fetch(`https://api.notion.com/v1/pages/${pending.pageId}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${notionToken}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
          body: JSON.stringify({ properties: JSON.parse(pending.properties || '{}') }),
        });
        logActivity({
          agentId: pending.agentId,
          agentName: agent?.name || null,
          taskId: pending.taskId,
          action: 'notion_update',
          destination: 'notion',
          destinationPath: pending.pageId,
          summary: pending.summary,
        });
        resultMsg = `✅ Notionを更新しました: ${pending.pageId}`;
      }

    } else if (pending.type === 'SHEETS_UPDATE') {
      logActivity({
        agentId: pending.agentId,
        agentName: agent?.name || null,
        taskId: pending.taskId,
        action: 'sheets_update',
        destination: 'sheets',
        destinationPath: `${pending.spreadsheetId}!${pending.range}`,
        summary: pending.summary,
      });
      resultMsg = `✅ スプシ更新をログに記録しました（API未実装）: ${pending.spreadsheetId}`;
    }

    // 完了通知をWS broadcast
    const cid = pending.agentId ? reg.findAgentById(pending.agentId)?.companyId : null;
    if (cid) {
      wss.clients.forEach((c) => {
        if (c.readyState === 1) c.send(JSON.stringify({
          type: 'action_completed', pendingId,
          agentId: pending.agentId, summary: resultMsg || pending.summary,
        }));
      });
    }

    res.json({ ok: true, status: 'executed', message: resultMsg });
  } catch (e) {
    console.error('[action/confirm] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GitHub PR merge / list / get ────────────────────────────────────────────

app.post('/api/github/pr/:owner/:repo/:pullNumber/merge', async (req, res) => {
  const { owner, repo, pullNumber } = req.params;
  const tokenType = (req.body && req.body.tokenType) || 'personal';
  const permission = getRepoPermission(owner, repo);
  if (permission !== 'pr') return res.status(403).json({ error: 'PRマージ権限がありません' });
  const token = getGithubToken(tokenType);
  if (!token) return res.status(400).json({ error: 'GitHub トークンが設定されていません' });
  const result = await mergePullRequest(owner, repo, pullNumber, token, permission);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json(result.data);
});

app.get('/api/github/pr/:owner/:repo', async (req, res) => {
  const { owner, repo } = req.params;
  const tokenType = req.query.tokenType || 'personal';
  const token = getGithubToken(tokenType);
  if (!token) return res.status(400).json({ error: 'GitHub トークンが設定されていません' });
  const result = await listPullRequests(owner, repo, token);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ pullRequests: result.data });
});

app.get('/api/github/pr/:owner/:repo/:pullNumber', async (req, res) => {
  const { owner, repo, pullNumber } = req.params;
  const tokenType = req.query.tokenType || 'personal';
  const token = getGithubToken(tokenType);
  if (!token) return res.status(400).json({ error: 'GitHub トークンが設定されていません' });
  const result = await getPullRequest(owner, repo, pullNumber, token);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json(result.data);
});

// ── Static pages ─────────────────────────────────────────────────────────────

app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));
app.get('/company-manage', (req, res) => res.sendFile(path.join(__dirname, 'public', 'company-manage.html')));
app.get('/projects-page', (req, res) => res.sendFile(path.join(__dirname, 'public', 'projects.html')));
app.get('/talk/:agentId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'talk.html')));

app.post('/api/companies/:companyId/broadcast-text', withCompany, (req, res) => {
  const text = req.body && String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: '指示文を入力してください' });
  const ags = reg.loadAgents(req.cid);
  const projs = reg.loadProjects(req.cid);
  const sett = reg.loadSettings(req.cid);
  if (isApiMode(req.cid)) {
    if (!sett.anthropicApiKey || !sett.anthropicApiKey.trim()) {
      return res.status(400).json({ error: 'APIキーを設定してください' });
    }
    ags.forEach((agent) => {
      getBackend(req.cid)
        .sendMessage({
          agentId: agent.id,
          text: `【一斉連絡】\n${text}`,
          agent,
          projects: projs,
          settings: sett,
          onUpdate: () => broadcastOutputSoon(req.cid),
        })
        .catch(console.error);
    });
    setTimeout(() => broadcastOutputSoon(req.cid), 200);
    return res.json({ ok: true, mode: 'api', count: ags.length });
  }
  ags.forEach((a) => sendToPane(a.pane, text));
  res.json({ ok: true, mode: 'tmux', count: ags.length });
});

wss.on('connection', (ws, req) => {
  let companyId = reg.primaryCompanyId();
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    const q = u.searchParams.get('companyId');
    if (q && reg.getCompany(q)) companyId = q;
  } catch {}
  ws.companyId = companyId;

  const agents = reg.loadAgents(companyId);
  const projects = reg.loadProjects(companyId);
  const settings = reg.loadSettings(companyId);

  ws.send(JSON.stringify({ type: 'agents', agents: agentsForWS(companyId), companyId }));
  ws.send(JSON.stringify({ type: 'projects', projects, companyId }));
  ws.send(JSON.stringify({ type: 'settings', settings: publicSettings(settings), companyId }));
  agents.forEach((a) => {
    if (a.panelBg) ws.send(JSON.stringify({ type: 'panelBg', agentId: a.id, panelBg: a.panelBg, companyId }));
  });
  if (isApiMode(companyId)) {
    ws.send(
      JSON.stringify({
        type: 'output',
        companyId,
        panes: getBackend(companyId).getPaneStates(
          agents.map((x) => x.id),
          Date.now()
        ),
      })
    );
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const cid = msg.companyId || ws.companyId;
    if (!reg.getCompany(cid)) return;

    const ags = reg.loadAgents(cid);
    const projs = reg.loadProjects(cid);
    const sett = reg.loadSettings(cid);

    if (msg.type === 'send') {
      const agent = ags.find((a) => a.id === msg.agentId);
      if (!agent) return;
      if (isApiMode(cid)) {
        if (!sett.anthropicApiKey || !sett.anthropicApiKey.trim()) {
          broadcastToCompany(cid, {
            type: 'toast',
            message: 'この会社の API キーが未設定です（ダッシュボードタブ内の設定）。',
          });
          return;
        }
        getBackend(cid)
          .sendMessage({
            agentId: agent.id,
            text: msg.text,
            agent,
            projects: projs,
            settings: sett,
            onUpdate: () => broadcastOutputSoon(cid),
          })
          .catch(console.error);
      } else {
        sendToPane(agent.pane, msg.text);
      }
    } else if (msg.type === 'broadcast') {
      if (isApiMode(cid)) {
        if (!sett.anthropicApiKey || !sett.anthropicApiKey.trim()) {
          broadcastToCompany(cid, { type: 'toast', message: 'API キー未設定' });
          return;
        }
        ags.forEach((agent) => {
          getBackend(cid)
            .sendMessage({
              agentId: agent.id,
              text: msg.text,
              agent,
              projects: projs,
              settings: sett,
              onUpdate: () => broadcastOutputSoon(cid),
            })
            .catch(console.error);
        });
      } else {
        ags.forEach((a) => sendToPane(a.pane, msg.text));
      }
    } else if (msg.type === 'reconnect') {
      const agent = ags.find((a) => a.id === msg.agentId);
      if (!agent) return;
      if (isApiMode(cid)) {
        getBackend(cid).clearSession(agent.id);
        broadcastOutputSoon(cid);
        setTimeout(() => ws.send(JSON.stringify({ type: 'reconnectDone', agentId: msg.agentId, companyId: cid })), 200);
      } else {
        try {
          execSync(`tmux has-session -t ${TMUX_SESSION} 2>/dev/null`, { timeout: 1000 });
        } catch {
          ws.send(
            JSON.stringify({
              type: 'reconnectError',
              agentId: msg.agentId,
              companyId: cid,
              message: 'tmux セッションがありません。',
            })
          );
          return;
        }
        reconnectPane(agent.pane);
        setTimeout(() => ws.send(JSON.stringify({ type: 'reconnectDone', agentId: msg.agentId, companyId: cid })), 2000);
      }
    } else if (msg.type === 'secretarySend' && msg.text && String(msg.text).trim()) {
      if (!isApiMode(cid)) {
        broadcastToCompany(cid, { type: 'toast', message: '秘書経由の振り分けは API モードで利用できます。' });
        return;
      }
      if (!sett.anthropicApiKey || !sett.anthropicApiKey.trim()) {
        broadcastToCompany(cid, { type: 'toast', message: 'API キーを設定してください。' });
        return;
      }
      const sec = ags.find(
        (a) =>
          /セクレタリー/.test(a.role || '') ||
          (a.name || '').includes('秘書') ||
          (a.role || '').includes('秘書')
      );
      if (!sec) {
        broadcastToCompany(cid, { type: 'toast', message: 'セクレタリー役のメンバーが見つかりません。' });
        return;
      }
      getBackend(cid)
        .sendSecretaryRouted({
          secretaryAgent: sec,
          text: String(msg.text).trim(),
          allAgents: ags,
          projects: projs,
          settings: sett,
          onUpdate: () => broadcastOutputSoon(cid),
        })
        .catch(console.error);
    } else if (msg.type === 'subscribe' && msg.companyId && reg.getCompany(msg.companyId)) {
      ws.companyId = msg.companyId;
      const a2 = reg.loadAgents(msg.companyId);
      const p2 = reg.loadProjects(msg.companyId);
      ws.send(JSON.stringify({ type: 'agents', agents: agentsForWS(msg.companyId), companyId: msg.companyId }));
      ws.send(JSON.stringify({ type: 'projects', projects: p2, companyId: msg.companyId }));
      ws.send(JSON.stringify({ type: 'settings', settings: publicSettings(reg.loadSettings(msg.companyId)), companyId: msg.companyId }));
    }
  });
});

setInterval(() => {
  if (wss.clients.size === 0) return;
  const byCo = new Map();
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1 || !ws.companyId) return;
    if (!byCo.has(ws.companyId)) byCo.set(ws.companyId, new Set());
    byCo.get(ws.companyId).add(ws);
  });
  for (const [cid, clients] of byCo) {
    if (clients.size === 0) continue;
    const agents = reg.loadAgents(cid);
    const now = Date.now();
    let panes;
    if (isApiMode(cid)) {
      panes = getBackend(cid).getPaneStates(
        agents.map((a) => a.id),
        now
      );
    } else {
      const ps = getPaneStateMap(cid);
      panes = {};
      agents.forEach((a) => {
        const content = capturePaneOutput(a.pane);
        if (content === null) {
          ps.delete(a.id);
          panes[a.id] = { content: '', lastUpdated: null, status: 'disconnected' };
        } else {
          const prev = ps.get(a.id);
          if (!prev || content !== prev.lastContent) ps.set(a.id, { lastContent: content, lastUpdated: now });
          const st = ps.get(a.id);
          panes[a.id] = {
            content,
            lastUpdated: st.lastUpdated,
            status: now - st.lastUpdated < 3000 ? 'working' : 'idle',
          };
        }
      });
    }
    const msg = JSON.stringify({ type: 'output', panes, companyId: cid });
    clients.forEach((ws) => ws.send(msg));
  }
}, CAPTURE_INTERVAL);

let listening = false;
function runServer(options = {}) {
  return new Promise((resolve, reject) => {
    if (listening) {
      resolve(server.address().port);
      return;
    }
    const wantRandom = options.randomPort === true || process.env.AI_AGENTS_ELECTRON === '1';
    const port = wantRandom ? 0 : parseInt(process.env.PORT || String(options.port || 3000), 10);
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && !wantRandom) server.listen(0, '127.0.0.1', onListen);
      else reject(err);
    });
    function onListen() {
      listening = true;
      resolve(server.address().port);
    }
    server.listen(port, '127.0.0.1', onListen);
  });
}

async function mainCli() {
  try {
    const port = await runServer({
      randomPort: process.env.AI_AGENTS_ELECTRON === '1',
      port: parseInt(process.env.PORT || '3000', 10),
    });
    const p = server.address().port;
    console.log(`AI Agents: http://127.0.0.1:${p}`);
    if (process.env.OPEN_CHROME === '1' && process.platform === 'darwin' && process.env.AI_AGENTS_ELECTRON !== '1') {
      require('child_process').exec(`open -a "Google Chrome" "http://127.0.0.1:${p}"`, () => {});
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

// ── 起動時ステータス自動修正 ─────────────────────────────────────────────────
function autoFixAgentStatuses() {
  const now = Date.now();
  const companies = reg.listMeta();
  let fixed = 0;

  for (const company of companies) {
    const agents = reg.loadAgents(company.id);
    let changed = false;

    for (const agent of agents) {
      const lastActive = agent.lastActiveAt ? new Date(agent.lastActiveAt).getTime() : null;
      const minutesSince = lastActive ? (now - lastActive) / 60000 : null;
      let newStatus = null;
      let clearTask = false;

      // completedは常にreviewに正規化
      if (agent.status === 'completed') {
        newStatus = 'review';
      }
      // working かつ currentTask が空 → idle
      else if (agent.status === 'working' && (!agent.currentTask || agent.currentTask.trim() === '')) {
        console.log(`[auto-fix] ${agent.name}: working→idle (currentTask空)`);
        newStatus = 'idle';
        clearTask = true;
      }
      // working かつ lastActiveAt が60分以上前 → review
      else if (agent.status === 'working' && minutesSince !== null && minutesSince > 60) {
        console.log(`[auto-fix] ${agent.name}: working→review (${Math.floor(minutesSince)}分更新なし)`);
        newStatus = 'review';
      }
      // waiting かつ lastActiveAt が24時間以上前 → review
      else if (agent.status === 'waiting' && minutesSince !== null && minutesSince > 1440) {
        console.log(`[auto-fix] ${agent.name}: waiting→review (${Math.floor(minutesSince / 60)}時間更新なし)`);
        newStatus = 'review';
      }
      // progress=100 かつ working → review
      else if (agent.status === 'working' && agent.progress >= 100) {
        console.log(`[auto-fix] ${agent.name}: working→review (progress=100)`);
        newStatus = 'review';
      }

      if (newStatus) {
        agent.status = newStatus;
        if (clearTask) {
          agent.progress = 0;
          agent.currentTask = '';
        }
        changed = true;
        fixed++;
        // WebSocketでクライアントに通知
        broadcastToCompany(company.id, {
          type: 'agent_status',
          agentId: agent.id,
          status: newStatus,
          progress: clearTask ? 0 : agent.progress,
          currentTask: clearTask ? '' : agent.currentTask,
        });
      }
    }

    if (changed) {
      reg.saveAgents(company.id, agents);
    }
  }

  if (fixed > 0) {
    console.log(`[auto-fix] ${fixed}件のエージェントステータスを修正しました`);
  }
}

// ── /api/agents/:id/status の厳密化 ─────────────────────────────────────────
// (既存エンドポイントに上書き)
app.put('/api/agents/:id/status', (req, res) => {
  const { status, progress, estimatedMinutes, currentTask, lastMessage } = req.body || {};

  // workingへの変更にはcurrentTaskが必須
  if (status === 'working' && !currentTask) {
    return res.status(400).json({ error: 'working状態への変更にはcurrentTaskが必要です' });
  }

  // progressは0〜100の整数のみ
  if (progress !== undefined) {
    const p = parseInt(progress, 10);
    if (isNaN(p) || p < 0 || p > 100) {
      return res.status(400).json({ error: 'progressは0〜100の整数である必要があります' });
    }
  }

  // estimatedMinutesが常に同じ固定値の場合は警告
  if (estimatedMinutes !== undefined && estimatedMinutes !== null) {
    const found = reg.findAgentById(req.params.id);
    if (found && found.agent.estimatedMinutes === estimatedMinutes) {
      console.warn(`[warn] ${found.agent.name}: estimatedMinutes="${estimatedMinutes}"が前回と同じ値です（固定値を疑ってください）`);
    }
  }

  const patch = { lastActiveAt: new Date().toISOString() };
  if (status !== undefined) patch.status = status;
  if (progress !== undefined) patch.progress = parseInt(progress, 10);
  if (estimatedMinutes !== undefined) patch.estimatedMinutes = estimatedMinutes == null ? null : Number(estimatedMinutes);
  if (currentTask !== undefined) patch.currentTask = currentTask;
  if (lastMessage !== undefined) patch.lastMessage = lastMessage;

  const result = reg.updateAgentById(req.params.id, patch);
  if (!result) return res.status(404).json({ error: 'not found' });

  broadcastToCompany(result.companyId, {
    type: 'agent_status',
    agentId: result.agent.id,
    status: result.agent.status,
    progress: result.agent.progress,
    estimatedMinutes: result.agent.estimatedMinutes,
    currentTask: result.agent.currentTask,
    lastMessage: result.agent.lastMessage,
    lastActiveAt: result.agent.lastActiveAt,
  });

  // タスクステータスとエージェントステータスの連動
  try {
    const tasks = loadTasksFile();
    const agentId = result.agent.id;
    let tasksChanged = false;
    for (const task of tasks) {
      const involved = (task.activeAgents || []).includes(agentId)
        || (task.messages || []).some((m) => m.agentId === agentId);
      if (!involved) continue;

      let newTaskStatus = null;
      if (result.agent.status === 'working') {
        if (task.status !== 'working') newTaskStatus = 'working';
      } else if (result.agent.status === 'review' || result.agent.status === 'waiting') {
        newTaskStatus = result.agent.status;
      } else if (result.agent.status === 'idle') {
        // 他にworkingのエージェントがいなければdone
        const allAgents = reg.loadAgents(result.companyId);
        const otherWorking = (task.activeAgents || []).some((aid) => {
          if (aid === agentId) return false;
          const a = allAgents.find((x) => x.id === aid);
          return a && a.status === 'working';
        });
        if (!otherWorking) newTaskStatus = 'done';
      }

      if (newTaskStatus && task.status !== newTaskStatus) {
        task.status = newTaskStatus;
        task.updatedAt = new Date().toISOString();
        tasksChanged = true;
        broadcastToCompany(result.companyId, { type: 'task_status_update', taskId: task.id, status: newTaskStatus });
      }
    }
    if (tasksChanged) saveTasksFile(tasks);
  } catch (e) {
    console.error('[agent-status] task sync error:', e.message);
  }

  res.json(result.agent);
  fireAndForgetWorkspaceSave(result.companyId, 'Update agent status');
});

startAutoGitSync(() => reg.listMeta(), 30 * 60 * 1000);

// 起動時に一度ステータス修正を実行
autoFixAgentStatuses();

// ── ルーティンAPI＋エンジン ─────────────────────────────────────────────────
const ROUTINES_PATH = path.join(__dirname, 'core', 'skills', 'routines.json');

function loadRoutinesFile() {
  if (!fs.existsSync(ROUTINES_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(ROUTINES_PATH, 'utf8')).routines || []; } catch { return []; }
}

function saveRoutinesFile(routines) {
  fs.mkdirSync(path.dirname(ROUTINES_PATH), { recursive: true });
  fs.writeFileSync(ROUTINES_PATH, JSON.stringify({ routines }, null, 2), 'utf8');
}

function calcNextRun(routine) {
  const now = new Date();
  if (routine.trigger === 'hourly') {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toISOString();
  }
  if ((routine.trigger === 'daily' || routine.trigger === 'weekly') && routine.triggerTime) {
    const [h, m] = routine.triggerTime.split(':').map(Number);
    // JST = UTC+9
    const nowJST = new Date(now.getTime() + 9 * 3600000);
    const targetJST = new Date(nowJST);
    targetJST.setHours(h, m, 0, 0);
    if (routine.trigger === 'weekly') {
      // dayOfWeek: 0=日, 1=月, ... 6=土 (Date#getDay 準拠)
      const target = Number.isInteger(routine.dayOfWeek) ? routine.dayOfWeek : nowJST.getDay();
      const diff = (target - nowJST.getDay() + 7) % 7;
      targetJST.setDate(nowJST.getDate() + diff);
      if (targetJST <= nowJST) targetJST.setDate(targetJST.getDate() + 7);
    } else if (targetJST <= nowJST) {
      targetJST.setDate(targetJST.getDate() + 1);
    }
    return new Date(targetJST.getTime() - 9 * 3600000).toISOString();
  }
  return null;
}

async function executeRoutine(routine) {
  const companies = reg.listMeta();
  if (!companies?.length) return;
  const companyId = companies[0].id;

  console.log(`[routine] Executing: ${routine.name}`);
  broadcastToCompany(companyId, { type: 'routine_started', routineId: routine.id, routineName: routine.name });

  for (const task of routine.tasks) {
    try {
      await runAutonomousMessage(companyId, task.action || '');
    } catch (e) {
      console.error(`[routine] task error: ${e.message}`);
    }
  }

  const routines = loadRoutinesFile();
  const idx = routines.findIndex((r) => r.id === routine.id);
  if (idx >= 0) {
    routines[idx].lastRun = new Date().toISOString();
    routines[idx].nextRun = calcNextRun(routine);
    saveRoutinesFile(routines);
  }

  broadcastToCompany(companyId, { type: 'routine_completed', routineId: routine.id });
  console.log(`[routine] Completed: ${routine.name}`);
}

app.get('/api/routines', (req, res) => {
  res.json({ routines: loadRoutinesFile() });
});

app.post('/api/routines', (req, res) => {
  const routines = loadRoutinesFile();
  const newRoutine = {
    id: 'routine-' + Date.now(),
    name: req.body.name || '新しいルーティン',
    trigger: req.body.trigger || 'daily',
    triggerTime: req.body.triggerTime || '09:00',
    timezone: req.body.timezone || 'Asia/Tokyo',
    enabled: req.body.enabled !== false,
    tasks: req.body.tasks || [],
    lastRun: null,
    nextRun: null,
  };
  newRoutine.nextRun = calcNextRun(newRoutine);
  routines.push(newRoutine);
  saveRoutinesFile(routines);
  res.json(newRoutine);
});

app.put('/api/routines/:id', (req, res) => {
  const routines = loadRoutinesFile();
  const idx = routines.findIndex((r) => r.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  routines[idx] = { ...routines[idx], ...req.body, id: req.params.id };
  routines[idx].nextRun = calcNextRun(routines[idx]);
  saveRoutinesFile(routines);
  res.json(routines[idx]);
});

app.delete('/api/routines/:id', (req, res) => {
  const routines = loadRoutinesFile().filter((r) => r.id !== req.params.id);
  saveRoutinesFile(routines);
  res.status(204).end();
});

app.post('/api/routines/:id/run', async (req, res) => {
  const routine = loadRoutinesFile().find((r) => r.id === req.params.id);
  if (!routine) return res.status(404).json({ error: 'not found' });
  res.json({ status: 'started' });
  executeRoutine(routine).catch((e) => console.error('[routine] manual run error:', e.message));
});

// 自律チェックの手動トリガー
app.post('/api/autonomous/trigger', async (req, res) => {
  const { companyId } = req.body || {};
  const cid = companyId || reg.primaryCompanyId();
  res.json({ status: 'started' });
  lastAutonomousRun = 0; // 強制的にリセット
  runAutonomousTask().catch((e) => console.error('[autonomous] manual trigger error:', e.message));
});

// ルーティン二重実行防止用のメモリ管理
const routineLastRun = new Map();

// ルーティンエンジン（毎分チェック）
setInterval(() => {
  const now = new Date();
  const routines = loadRoutinesFile().filter((r) => r.enabled && r.nextRun);
  for (const r of routines) {
    const next = new Date(r.nextRun);
    if (next <= now) {
      // 二重実行防止：前回実行からの経過時間をチェック
      const lastRun = routineLastRun.get(r.id);
      const minInterval = r.trigger === 'hourly' ? 3600000 : 86400000;
      if (lastRun && Date.now() - lastRun < minInterval) {
        continue; // 最小間隔以内に実行済みならスキップ
      }
      routineLastRun.set(r.id, Date.now());
      executeRoutine(r).catch((e) => {
        console.error('[routine] engine error:', e.message);
        // エラーでもlastRunを維持してリトライを防ぐ
      });
    }
  }
}, 60000);

// 起動時にnextRunを初期化（過去日は自動再計算）
(function initRoutineNextRun() {
  const routines = loadRoutinesFile();
  const now = Date.now();
  let changed = false;
  for (const r of routines) {
    if (!r.nextRun || new Date(r.nextRun).getTime() < now) {
      const old = r.nextRun;
      r.nextRun = calcNextRun(r);
      if (old !== r.nextRun) {
        console.log(`[routines] refresh nextRun for "${r.name}": ${old || '(none)'} -> ${r.nextRun}`);
        changed = true;
      }
    }
  }
  if (changed) saveRoutinesFile(routines);
  const enabled = routines.filter((r) => r.enabled).length;
  console.log(`[routines] Loaded ${routines.length} routines (${enabled} enabled)`);
})();
// ─────────────────────────────────────────────────────────────────────────────

// ── タスク永続化 ────────────────────────────────────────────────────────────

function getTasksPath() {
  return path.join(DATA_DIR, 'tasks.json');
}

function loadTasksFile() {
  try {
    const p = getTasksPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return []; }
}

function saveTasksFile(tasks) {
  fs.writeFileSync(getTasksPath(), JSON.stringify(tasks, null, 2), 'utf-8');
}

function saveTaskMessage(taskId, message) {
  try {
    const tasks = loadTasksFile();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (!task.messages) task.messages = [];
    task.messages.push(message);
    task.updatedAt = new Date().toISOString();
    saveTasksFile(tasks);
  } catch (e) {
    console.error('saveTaskMessage error:', e);
  }
}

async function handleAgentCompletion(companyId, agentId, agentName, summary, taskId, success) {
  // 完了報告は3行以内にコンパクト化
  const compactSummary = summary
    ? summary.split('\n').filter(l => l.trim()).slice(0, 3).join('\n')
    : '作業完了';
  const completionMessage = success
    ? `✅ ${agentName}が完了\n${compactSummary}`
    : `❌ ${agentName}でエラー\n${compactSummary}`;

  // 1. タスクに完了メッセージを保存
  saveTaskMessage(taskId, {
    role: 'agent',
    content: completionMessage,
    agentId, agentName, timestamp: new Date().toISOString(),
  });

  // 2. タスクステータス更新
  try {
    const tasks = loadTasksFile();
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = success ? 'review' : 'error';
      task.updatedAt = new Date().toISOString();
      saveTasksFile(tasks);
    }
  } catch {}

  // 3. WebSocket完了通知
  broadcastToCompany(companyId, { type: 'agent_completed', agentId, agentName, message: completionMessage, taskId, success });

  // 4. ジェニーが能動的にYutaに報告
  try {
    const s = readAppSettings();
    if (s.anthropicApiKey) {
      const reportResponse = await completeAnthropic({
        apiKey: s.anthropicApiKey, model: 'claude-haiku-4-5-20251001',
        system: '以下の完了報告を鈴木さんに3行以内で伝えてください。次のアクションを1行で提案してください。余計な挨拶・前置き不要。',
        messages: [{ role: 'user', content: `${agentName}が完了しました：${compactSummary}` }], maxTokens: 256,
      });
      broadcastToCompany(companyId, { type: 'secretary_report', message: reportResponse, taskId });
      saveTaskMessage(taskId, { role: 'secretary', content: reportResponse, timestamp: new Date().toISOString() });
    }
  } catch (e) {
    console.error('[completion-report] error:', e.message);
  }

  // 5. Workspace記憶に完了記録を保存
  if (success) {
    try {
      const s = readAppSettings();
      const ghToken = s.githubPersonalToken || s.githubCompanyToken || '';
      if (ghToken) {
        const tasks = loadTasksFile();
        const task = tasks.find((t) => t.id === taskId);
        if (task) {
          await saveCompletionToWorkspace(task, compactSummary, agentName, ghToken);
        }
      }
    } catch (e) {
      console.error('[memory] completion save error:', e.message);
    }
  }
}

app.get('/api/tasks', (req, res) => {
  const all = loadTasksFile();
  // デフォルトではアーカイブ済みを除外
  if (req.query.includeArchived === 'true') {
    res.json(all);
  } else {
    res.json(all.filter(t => t.status !== 'archived'));
  }
});

app.post('/api/tasks', (req, res) => {
  const tasks = loadTasksFile();
  const { id, name, status, messages, activeAgents, createdAt, updatedAt } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  const idx = tasks.findIndex((t) => t.id === id);
  const record = { id, name: name || '新しいタスク', status: status || 'pending', messages: messages || [], activeAgents: activeAgents || [], createdAt: createdAt || new Date().toISOString(), updatedAt: updatedAt || new Date().toISOString() };
  if (idx >= 0) tasks[idx] = record; else tasks.push(record);
  saveTasksFile(tasks);
  res.json(record);
});

app.put('/api/tasks/:id', (req, res) => {
  const tasks = loadTasksFile();
  const idx = tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  tasks[idx] = { ...tasks[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
  saveTasksFile(tasks);
  res.json(tasks[idx]);
});

app.delete('/api/tasks/:id', (req, res) => {
  const tasks = loadTasksFile();
  const filtered = tasks.filter((t) => t.id !== req.params.id);
  saveTasksFile(filtered);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/archive', (req, res) => {
  const tasks = loadTasksFile();
  const idx = tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  tasks[idx].status = 'archived';
  tasks[idx].updatedAt = new Date().toISOString();
  saveTasksFile(tasks);
  res.json(tasks[idx]);
});

app.post('/api/tasks/:id/messages', (req, res) => {
  saveTaskMessage(req.params.id, { ...req.body, timestamp: req.body.timestamp || new Date().toISOString() });
  res.json({ ok: true });
});

// ── ジェニー会話永続化（tasks.jsonとは別管理） ─────────────────────────────
function getJennyConversationPath() {
  return path.join(DATA_DIR, 'jenny-conversation.json');
}

function loadJennyConversation() {
  try {
    const p = getJennyConversationPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return []; }
}

function saveJennyConversation(messages) {
  fs.writeFileSync(getJennyConversationPath(), JSON.stringify(messages, null, 2), 'utf-8');
}

app.get('/api/jenny/conversation', (req, res) => {
  res.json(loadJennyConversation());
});

app.post('/api/jenny/conversation', (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });
  const existing = loadJennyConversation();
  // 最新100件まで保持
  const updated = [...existing, ...messages].slice(-100);
  saveJennyConversation(updated);
  res.json({ ok: true });
});

// ── 自律タイマー（1時間ごと + 毎日9:00 JST） ─────────────────────────────
const AUTONOMOUS_INTERVAL_MS = 60 * 60 * 1000; // 1時間

async function runAutonomousMessage(companyId, text) {
  const s = readAppSettings();
  const apiKey = s.anthropicApiKey || '';
  if (!apiKey.trim()) return;

  const history = reg.loadConversation(companyId);
  const model = s.model || 'claude-sonnet-4-20250514';
  const system = await buildSecretarySystemPromptWithMemory(companyId);
  const recentHistory = history.slice(-5);
  const messages = [
    ...recentHistory.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })),
    { role: 'user', content: text },
  ];

  reg.appendConversation(companyId, {
    id: 'msg-' + Date.now(),
    role: 'user',
    agentId: null,
    content: text,
    delegations: [],
    timestamp: new Date().toISOString(),
  });

  broadcastToCompany(companyId, { type: 'secretary_typing', text });

  let fullResponse = '';
  try {
    await streamAnthropic({
      apiKey, model, system, messages,
      onText: (chunk) => {
        fullResponse += chunk;
        broadcastToCompany(companyId, { type: 'secretary_token', content: chunk });
      },
    });
  } catch (err) {
    console.error('[autonomous] API error:', err.message);
    if (err.isCredit) {
      broadcastToCompany(companyId, { type: 'error', message: 'APIクレジットが不足しています。設定画面でAPIキーを確認してください。' });
    }
    return;
  }

  reg.appendConversation(companyId, {
    id: 'msg-' + Date.now(),
    role: 'assistant',
    agentId: null,
    content: fullResponse,
    delegations: [],
    timestamp: new Date().toISOString(),
  });

  broadcastToCompany(companyId, { type: 'secretary_done', content: fullResponse });
}

let lastAutonomousRun = 0;

// 起動時にWorkspaceのmemoryファイルを初期化
(async () => {
  try {
    const s = readAppSettings();
    const ghToken = s.githubPersonalToken || s.githubCompanyToken || '';
    await ensureMemoryFiles(ghToken);
  } catch (e) {
    console.error('[memory] 初期化エラー:', e.message);
  }
})();

// 起動時に古い「自律チェック」タスクをアーカイブ
(() => {
  try {
    const tasks = loadTasksFile();
    let changed = false;
    for (const t of tasks) {
      if (t.status !== 'archived' && (t.name || '').includes('自律チェック')) {
        t.status = 'archived';
        t.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) {
      saveTasksFile(tasks);
      console.log('[autonomous] Archived old autonomous check tasks');
    }
  } catch {}
})();

async function runAutonomousTask() {
  try {
    // 二重実行防止：前回実行から1時間以内ならスキップ
    const now = Date.now();
    if (now - lastAutonomousRun < 3600000) {
      console.log('[autonomous] Skipping hourly trigger (last run was ' + Math.round((now - lastAutonomousRun) / 60000) + 'min ago)');
      return;
    }
    lastAutonomousRun = now;

    const companies = reg.listMeta();
    if (!companies || companies.length === 0) return;
    const company = companies[0];

    // バックグラウンドでチェックし、問題がある場合のみ通知（タスクは作成しない）
    console.log(`[autonomous] Running hourly check for company ${company.id}`);
    await runAutonomousCheck(company.id);
  } catch (err) {
    console.error('[autonomous] hourly task error:', err.message);
  }
}

/**
 * 自律チェック：
 * 1. 各事業部長に担当範囲の進捗確認を依頼
 * 2. 48時間以上停滞しているタスクを自動で再開
 * 3. 問題があれば通知バナーを出す
 */
async function runAutonomousCheck(companyId) {
  const s = readAppSettings();
  const apiKey = s.anthropicApiKey || '';
  if (!apiKey.trim()) return;

  const agents = reg.loadAgents(companyId);
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  const stuckAgents = agents.filter(a => a.status === 'working' && a.lastActiveAt && new Date(a.lastActiveAt).getTime() < thirtyMinAgo);

  const tasks = loadTasksFile();
  const activeTasks = tasks.filter(t => t.status === 'active' || t.status === 'waiting' || t.status === 'review');

  // 停滞プロジェクト検知
  const ghToken = s.githubPersonalToken || s.githubCompanyToken || '';
  let staleProjects = [];
  try {
    staleProjects = await detectStaleProjects(ghToken);
    if (staleProjects.length > 0) {
      console.log(`[autonomous] 停滞プロジェクト検知: ${staleProjects.join(', ')}`);
      broadcastToCompany(companyId, {
        type: 'notification',
        level: 'warning',
        title: 'プロジェクト停滞アラート',
        message: `${staleProjects.join('・')}が48時間以上更新されていません`,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.error('[autonomous] stale project check error:', e.message);
  }

  // ── 各事業部長に担当範囲の進捗確認を依頼 ──
  const divisionHeads = agents.filter(a =>
    (a.role || '').includes('部長') || (a.displayName || '').includes('事業部長')
  );
  if (divisionHeads.length > 0) {
    const model = s.model || 'claude-sonnet-4-20250514';
    for (const head of divisionHeads) {
      try {
        console.log(`[autonomous] 事業部長チェック依頼: ${head.displayName || head.name}`);
        const executor = new AgentExecutor({
          apiKey, model, companyId, agents,
          broadcast: (msg) => broadcastToCompany(companyId, msg),
          skillsDir: path.join(__dirname, 'core', 'skills'),
          saveTaskMessage,
          githubToken: getGithubToken('personal') || getGithubToken('company'),
          workspace: s.workspace,
        });
        const onProg = (pd) => {
          broadcastToCompany(companyId, { type: 'agent_progress', ...pd });
        };
        executor.execute(
          head,
          '担当範囲のプロジェクト進捗を確認してください。止まっているタスクがあれば担当PMに指示して動かしてください。問題がなければ報告不要です。',
          `autonomous-${Date.now()}`,
          0,
          onProg,
          'light'
        ).catch(err => console.error(`[autonomous] ${head.displayName || head.name} error:`, err.message));
      } catch (err) {
        console.error(`[autonomous] division head check error (${head.displayName}):`, err.message);
      }
    }
  }

  // ── 48時間以上更新のないactiveタスクを検知して再開 ──
  const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000;
  const staleTasks = tasks.filter(t =>
    t.status === 'active' &&
    t.updatedAt &&
    new Date(t.updatedAt).getTime() < fortyEightHoursAgo
  );

  for (const staleTask of staleTasks) {
    try {
      // 担当エージェントを特定
      const lastAgentMsg = [...(staleTask.messages || [])].reverse().find(m => m.role === 'agent' && m.agentId);
      if (lastAgentMsg) {
        const agent = agents.find(a => a.id === lastAgentMsg.agentId);
        if (agent) {
          console.log(`[autonomous] 停滞タスク再開: ${staleTask.name} → ${agent.displayName || agent.name}`);
          const executor = new AgentExecutor({
            apiKey, model: s.model || 'claude-sonnet-4-20250514', companyId, agents,
            broadcast: (msg) => broadcastToCompany(companyId, msg),
            skillsDir: path.join(__dirname, 'core', 'skills'),
            saveTaskMessage,
            githubToken: getGithubToken('personal') || getGithubToken('company'),
            workspace: s.workspace,
          });
          const onProg = (pd) => {
            broadcastToCompany(companyId, { type: 'agent_progress', ...pd });
            if (pd.message && pd.type === 'agent_message') {
              saveTaskMessage(staleTask.id, {
                role: 'agent', content: pd.message,
                agentId: agent.id, agentName: agent.displayName || agent.name,
                timestamp: new Date().toISOString(),
              });
            }
          };
          executor.execute(
            agent,
            `このタスク「${staleTask.name}」が48時間以上停滞しています。現状を確認して次のステップを提案してください。`,
            staleTask.id,
            0,
            onProg,
            'light'
          ).then(() => {
            // 提案をYuta向けタスクに追記
            saveTaskMessage(staleTask.id, {
              role: 'secretary',
              content: `⚠️ 停滞タスク「${staleTask.name}」について${agent.displayName || agent.name}が確認しました。次のステップの確認をお願いします。`,
              timestamp: new Date().toISOString(),
            });
            // ステータスをreviewに変更
            const currentTasks = loadTasksFile();
            const t = currentTasks.find(ct => ct.id === staleTask.id);
            if (t) {
              t.status = 'review';
              t.updatedAt = new Date().toISOString();
              saveTasksFile(currentTasks);
            }
            broadcastToCompany(companyId, {
              type: 'task_updated',
              task: { id: staleTask.id, status: 'review' },
            });
          }).catch(err => console.error(`[autonomous] stale task restart error:`, err.message));
        }
      }
    } catch (err) {
      console.error(`[autonomous] stale task handling error:`, err.message);
    }
  }

  // 問題がなければ何もしない
  if (stuckAgents.length === 0 && activeTasks.length === 0 && staleProjects.length === 0 && staleTasks.length === 0) {
    console.log('[autonomous] No issues found, skipping notification');
    return;
  }

  // 問題がある場合のみLLMに簡潔な状況判断を依頼
  const workingAgents = agents.filter(a => (a.status === 'working' || a.status === 'review') && a.lastActiveAt && new Date(a.lastActiveAt).getTime() > thirtyMinAgo);
  const checkPrompt = `以下の状況を確認し、Yutaへの通知が必要か判断してください。

稼働中エージェント: ${workingAgents.map(a => `${a.displayName || a.name}(${a.currentTask || '作業中'})`).join(', ') || 'なし'}
停滞エージェント（30分以上応答なし）: ${stuckAgents.map(a => `${a.displayName || a.name}`).join(', ') || 'なし'}
アクティブタスク: ${activeTasks.map(t => `${t.name}(${t.status})`).join(', ') || 'なし'}
停滞プロジェクト（48時間以上更新なし）: ${staleProjects.join(', ') || 'なし'}
停滞タスク（48時間以上）: ${staleTasks.map(t => t.name).join(', ') || 'なし'}

返答ルール：
- 問題なし → "NO_ISSUE" とだけ返す
- 問題あり → "NOTIFY: {1行の要約}" と返す（例: "NOTIFY: ルカが30分以上停滞中。WAVERSの競合調査が止まっています"）
- 必ず上記フォーマットで返すこと`;

  try {
    const result = await completeAnthropic({ apiKey, model: 'claude-haiku-4-5-20251001', system: 'あなたはシステム監視役です。簡潔に状況を判断してください。', messages: [{ role: 'user', content: checkPrompt }], maxTokens: 256 });
    const response = (result || '').trim();
    console.log(`[autonomous] Check result: ${response}`);

    if (response.startsWith('NOTIFY:')) {
      const message = response.replace('NOTIFY:', '').trim();
      broadcastToCompany(companyId, {
        type: 'notification',
        level: 'warning',
        title: '自律チェック',
        message,
        timestamp: new Date().toISOString(),
      });
      console.log(`[autonomous] Notification sent: ${message}`);
    }
  } catch (err) {
    console.error('[autonomous] check error:', err.message);
  }
}

function scheduleDaily() {
  const now = new Date();
  // JST = UTC+9
  const jstHours = (now.getUTCHours() + 9) % 24;
  const jstMinutes = now.getUTCMinutes();
  const jstSeconds = now.getUTCSeconds();
  const jstMs = now.getUTCMilliseconds();

  let msUntil9 = ((9 - jstHours) * 60 * 60 - jstMinutes * 60 - jstSeconds) * 1000 - jstMs;
  if (msUntil9 <= 0) msUntil9 += 24 * 60 * 60 * 1000;

  console.log(`[autonomous] Daily briefing scheduled in ${Math.round(msUntil9 / 60000)} minutes (JST 09:00)`);

  setTimeout(async () => {
    try {
      const companies = reg.listMeta();
      if (companies && companies.length > 0) {
        const companyId = companies[0].id;

        // 昨日のアクティビティログを収集
        const yesterday = new Date(Date.now() - 86400000).toISOString();
        const yesterdayLogs = getActivityLog({ dateFrom: yesterday, limit: 500 });
        const completedCount = yesterdayLogs.filter((l) => l.action === 'agent_execute' || l.action === 'create').length;

        // Skillsレポートを収集
        const skillsDir = path.join(__dirname, 'core', 'skills');
        const skillsReport = await collectDailySkillsReport(skillsDir).catch(() => null);
        const newSkillsCount = skillsReport?.newSkills?.length || 0;
        const newSkillsList = skillsReport?.newSkills?.join(', ') || '';

        // デイリーレポートを含む「おはよう」メッセージ
        const briefingPrompt = `おはよう。以下のデータを参考に本日のブリーフィングを作成してください。

## 昨日の実績データ
- 完了アクション数：${completedCount}件
- 新規Skillsファイル：${newSkillsCount}件${newSkillsList ? `（${newSkillsList}）` : ''}

## 本日実行予定のルーティン
${(() => {
  try {
    const routines = JSON.parse(fs.readFileSync(path.join(__dirname, 'core', 'skills', 'routines.json'), 'utf8')).routines || [];
    const todayRoutines = routines.filter((r) => r.enabled);
    return todayRoutines.map((r) => `- ${r.name}（${r.trigger}）`).join('\n') || '（なし）';
  } catch { return '（取得失敗）'; }
})()}

簡潔で実用的なブリーフィングをお願いします。`;

        await runAutonomousMessage(companyId, briefingPrompt);

        // フロントエンドにデイリーブリーフィング通知
        broadcastToCompany(companyId, {
          type: 'daily_briefing',
          timestamp: new Date().toISOString(),
          completedCount,
          newSkillsCount,
        });

        console.log('[autonomous] Daily briefing sent with report data');
      }
    } catch (err) {
      console.error('[autonomous] daily briefing error:', err.message);
    }
    scheduleDaily();
  }, msUntil9);
}

setInterval(() => {
  runAutonomousTask().catch((err) => console.error('[autonomous] interval error:', err.message));
}, AUTONOMOUS_INTERVAL_MS);
console.log(`[autonomous] Hourly task timer registered (interval: ${AUTONOMOUS_INTERVAL_MS / 60000}min)`);
scheduleDaily();
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { runServer, server, app };

if (require.main === module) {
  mainCli();
}
