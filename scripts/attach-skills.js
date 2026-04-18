'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'agents.json');
const agents = JSON.parse(fs.readFileSync(file, 'utf8'));

// 共通 + 個別スキルを配線
for (const a of agents) {
  const common = 'core/skills/agents/_common.md';
  const personal = `core/skills/agents/${a.id}.md`;
  const extras = [];
  if (/PM補佐/.test(a.role)) extras.push('core/skills/project-manager.md');
  if (/エンジニア/.test(a.project)) extras.push('core/skills/engineer.md');
  if (/PdM補佐/.test(a.role) && /（横断）/.test(a.project)) extras.push('core/skills/division-head-playbook.md');
  a.skills = [common, personal, ...extras];
}

fs.writeFileSync(file, JSON.stringify(agents, null, 2));
console.log('updated', agents.length, 'agents');
agents.forEach(a => console.log('-', a.name, '→', a.skills.length, 'skills'));
