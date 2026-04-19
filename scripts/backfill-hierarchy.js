'use strict';
const fs = require('fs');
const path = require('path');
const { getAgentHierarchyLevel } = require('../lib/company-registry');

const file = path.join(__dirname, '..', 'agents.json');
const agents = JSON.parse(fs.readFileSync(file, 'utf8'));

for (const a of agents) {
  if (!Number.isInteger(a.hierarchyLevel)) {
    a.hierarchyLevel = getAgentHierarchyLevel(a);
  }
}

fs.writeFileSync(file, JSON.stringify(agents, null, 2));
console.log('Hierarchy levels:');
agents.forEach((a) => console.log(`  L${a.hierarchyLevel} ${a.name} (${a.role}, ${a.project})`));
