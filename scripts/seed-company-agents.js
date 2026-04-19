#!/usr/bin/env node
'use strict';

// 既存の companies/<id>/agents.json に、root の agents.json (テンプレ) から
// 未登録のエージェントを追加する。既存レコードは上書きしない。

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tpl = JSON.parse(fs.readFileSync(path.join(root, 'agents.json'), 'utf8'));
const companiesMeta = JSON.parse(fs.readFileSync(path.join(root, 'companies.json'), 'utf8'));

for (const co of companiesMeta) {
  const dir = path.join(root, 'companies', co.id);
  if (!fs.existsSync(dir)) continue;
  const file = path.join(dir, 'agents.json');
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const existingIds = new Set(existing.map((a) => a.id));

  let added = 0;
  let updated = 0;
  for (const t of tpl) {
    if (existingIds.has(t.id)) {
      // 既存レコードには hierarchyLevel, skills, focus, avatar を後方マージ
      const idx = existing.findIndex((a) => a.id === t.id);
      if (idx >= 0) {
        const cur = existing[idx];
        let changed = false;
        if (!Number.isInteger(cur.hierarchyLevel) && Number.isInteger(t.hierarchyLevel)) {
          cur.hierarchyLevel = t.hierarchyLevel; changed = true;
        }
        if (!Array.isArray(cur.skills) || cur.skills.length < (t.skills?.length || 0)) {
          cur.skills = t.skills || cur.skills; changed = true;
        }
        if (!cur.focus && t.focus) { cur.focus = t.focus; changed = true; }
        if (changed) updated++;
      }
      continue;
    }
    existing.push(t);
    added++;
  }
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  console.log(`[${co.name}] added ${added} / updated ${updated} / total=${existing.length}`);
}
