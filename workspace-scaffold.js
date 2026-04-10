/**
 * 1人会社Ops ワークスペース（CEO→秘書→各部署 + Skills テンプレ）
 */
const fs = require('fs');
const path = require('path');

const ROOT_CLAUDE = (companyName) => `# ${companyName} — 1人会社Ops

社内データはこのリポジトリ内で共有。**他社データは明示指示がない限り参照しない**。

## 組織（目安）
- **CEO** … 経営判断
- **セクレタリー** … 窓口・全指示の受口・各部署への連携
- **リサーチ / 開発・運用 / PM / マーケティング** … 各専門部署

## ディレクトリ
- \`ceo/\` \`secretary/\` \`departments/*/\` … 役割ごとの CLAUDE.md と \`skills/\`
- \`Knowledge/\` … ナレッジ（表・ドキュメントの置き場）
`;

const ROLE_CLAUDE = (role, duty) => `# ${role}

## 役割
${duty}

## Skills
\`skills/\` 配下の SKILL.md を参照してください。
`;

const SKILL = (name, desc) => `---
name: ${name}
description: ${desc}
---

# ${name}

${desc}

このスキルは 1人会社Ops のテンプレートです。必要に応じて編集してください。
`;

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeIfAbsent(file, content) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, content, 'utf8');
    return true;
  }
  return false;
}

function touch(base, rel, content, created) {
  const fp = path.join(base, rel);
  mkdirp(path.dirname(fp));
  if (writeIfAbsent(fp, content)) created.push(rel);
}

/**
 * @returns {{ created: string[], base: string }}
 */
function scaffoldCompanyWorkspace(root, companyName) {
  const base = path.resolve(root);
  const created = [];
  const t = (rel, c) => touch(base, rel, c, created);

  mkdirp(base);

  t('CLAUDE.md', ROOT_CLAUDE(companyName || '会社'));
  t('ceo/CLAUDE.md', ROLE_CLAUDE('CEO', '経営判断・優先付け・リソース配分。'));
  t('ceo/skills/ceo-brief/SKILL.md', SKILL('CEOブリーフ', '経営方針・意思決定メモの整理。'));

  t('secretary/CLAUDE.md', ROLE_CLAUDE('セクレタリー', '社長・ユーザーの窓口。全指示を受け、各部署へ適切に連携する。'));
  t('secretary/inbox/.gitkeep', '');
  t('secretary/todos/.gitkeep', '');
  t('secretary/skills/secretary-inbox/SKILL.md', SKILL('受信箱処理', 'inbox の分類・TODO化・担当振り分け。'));

  const depts = [
    ['research', 'リサーチ', '市場・競合・技術調査。'],
    ['engineering', '開発・運用', '実装・CI/CD・本番運用。'],
    ['pm', 'PM', '進捗・スコープ・ステークホルダ連絡。'],
    ['marketing', 'マーケティング', 'コンテンツ・SNS・キャンペーン。'],
  ];
  for (const [slug, title, duty] of depts) {
    t(`departments/${slug}/CLAUDE.md`, ROLE_CLAUDE(title, duty));
    t(`departments/${slug}/skills/${slug}-core/SKILL.md`, SKILL(`${title}コア`, duty));
  }

  t('Knowledge/_shared/company-wide.md', '# 会社横断ナレッジ\n\n用語・方針をここに。\n');
  t('Knowledge/README.md', '# Knowledge\n\nプロジェクト別フォルダを切って格納してください。\n');
  t('.gitignore', 'node_modules/\n.env\n*.pem\n.DS_Store\n');

  return { created, base };
}

module.exports = { scaffoldCompanyWorkspace };
