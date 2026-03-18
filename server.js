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
const { completeAnthropic } = require('./lib/anthropic-stream');

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
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/guides',
  express.static(path.join(__dirname, 'docs'), {
    setHeaders(res) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    },
  })
);

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
    const { name, role, project, avatar, color, aiType, personality, panelBg, projectId, jobInstruction } =
      req.body || {};
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

/* 後方互換（単一クエリ） */
app.get('/api/settings', (req, res) => {
  const cid = req.query.companyId || reg.primaryCompanyId();
  res.json({ ...publicSettings(reg.loadSettings(cid)), modelOptions: MODEL_OPTIONS });
});
app.post('/api/settings', (req, res) => {
  const cid = req.body.companyId || reg.primaryCompanyId();
  if (!reg.getCompany(cid)) return res.status(404).json({ error: '会社不明' });
  const cur = reg.loadSettings(cid);
  const { providerMode, anthropicApiKey, model, clearApiKey } = req.body || {};
  if (providerMode === 'tmux' || providerMode === 'anthropic_api') {
    cur.providerMode = providerMode;
  }
  if (typeof model === 'string' && model.trim()) cur.model = model.trim();
  if (clearApiKey === true) cur.anthropicApiKey = '';
  else if (typeof anthropicApiKey === 'string' && anthropicApiKey.trim()) cur.anthropicApiKey = anthropicApiKey.trim();
  reg.saveSettingsRow(cid, cur);
  broadcastToCompany(cid, { type: 'settings', settings: publicSettings(cur) });
  res.json(publicSettings(cur));
});

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

startAutoGitSync(() => reg.listMeta(), 30 * 60 * 1000);

module.exports = { runServer, server, app };

if (require.main === module) {
  mainCli();
}
