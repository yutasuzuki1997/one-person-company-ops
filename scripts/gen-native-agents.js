'use strict';
// agents.json の全エージェントから Claude Code ネイティブのサブエージェント定義(.md)を生成する。
// frontmatter name = agentId（これが Agentツールの subagent_type になる）。
// 既存ファイル(手書きで質を担保したもの)は上書きしない。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const agents = JSON.parse(fs.readFileSync(path.join(root, 'agents.json'), 'utf8'));
const dir = path.join(root, '.claude', 'agents');
fs.mkdirSync(dir, { recursive: true });

function level(a) {
  if (typeof a.hierarchyLevel === 'number') return a.hierarchyLevel;
  return 3;
}

let created = 0, skipped = 0;
for (const a of agents) {
  const id = a.id;
  const file = path.join(dir, `${id}.md`);
  if (fs.existsSync(file)) { skipped++; continue; } // 手書き(agent-pm-overdue等)を保護
  const lv = level(a);
  const isDelegator = lv <= 2;
  const tools = isDelegator ? 'Bash, Read, Write, Agent' : 'Bash, Read, Write, WebSearch';
  const role = a.role || '担当';
  const project = a.project || '横断';
  const desc = `${role}（${project}）。${project}関連の${isDelegator ? 'マネジメント/委託' : '専門作業'}が必要なときに呼ぶ。agentId=${id}。`;

  const body = isDelegator
    ? `# ${a.name}（${role}）

agentId: \`${id}\` ／ 担当: ${project}

## 役割
あなたは${project}の${role}です。**自分では実装・調査・Web検索をせず**、Agentツールで配下の専門担当(リサーチ=agent-sp-research、コード=agent-sp-eng、データ=agent-sp-analyst 等)に委託します。

## 進め方
1. 受けたタスクを分解し、適切な専門担当に Agentツールで委託する（subagent_type に相手のagentIdを指定）。
2. 結果を集約し、要点3行で報告する。長文はそのまま貼らない（成果物は reports/ に保存済み）。
3. 外部影響のある操作(投稿/送信/課金/提出/本番デプロイ/PRマージ)は実行せず、必ず次を出力して承認を仰ぐ:
   \`\`\`
   ###APPROVAL kind="..." summary="何をしようとしているか1行" options="承認|却下|修正指示"###
   \`\`\`
`
    : `# ${a.name}（${role}）

agentId: \`${id}\` ／ 担当: ${project}

## 役割
あなたは${project}の${role}です。受けた作業を実行し、成果物を残します。

## 進め方
1. タスクを受け取り、必要なら最低3回 WebSearch で裏取りする（固有名詞・数値は推測で書かない）。
2. 成果物を GitHub Workspace の \`reports/{YYYY-MM-DD}-{概要}.md\` に保存する。
3. 最後に**要点3行＋保存先パス**を返す。長文をチャットに貼らない。
4. 外部影響のある操作は独断で実行せず、方針を提示して承認を仰ぐ。
`;

  const md = `---\nname: ${id}\ndescription: ${desc}\ntools: ${tools}\n---\n\n${body}`;
  fs.writeFileSync(file, md, 'utf8');
  created++;
}
console.log(`[gen-native-agents] created=${created} skipped(existing)=${skipped} total=${agents.length}`);
