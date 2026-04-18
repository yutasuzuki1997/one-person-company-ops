'use strict';
const fs = require('fs');
const path = require('path');

const agents = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agents.json'), 'utf8'));
const outDir = path.join(__dirname, '..', 'core', 'skills', 'agents');
fs.mkdirSync(outDir, { recursive: true });

// プロジェクトごとの「具体的に何を担当するか」
const PROJECT_SCOPE = {
  'WAVERS': {
    repo: 'backstage-inc/wavers',
    kind: 'アプリ',
    focus: '差別化戦略策定・機能スプリント管理・競合調査の発注・App Store申請支援',
    workspace: 'memory/projects.md の WAVERS セクション',
    emoji: '🌊'
  },
  'あげファンズ アシスタント': {
    repo: 'backstage-inc/agefunds',
    kind: 'アプリ',
    focus: 'ユーザー検証・ファン機能のPRDドラフト・計測設計',
    workspace: 'memory/projects.md の あげファンズ セクション',
    emoji: '🙌'
  },
  'NoBorder App': {
    repo: 'backstage-inc/noborder',
    kind: 'アプリ',
    focus: 'グローバルUX検証・多言語対応の発注・KPI観測',
    workspace: 'memory/projects.md の NoBorder セクション',
    emoji: '🌐'
  },
  'RealValue App': {
    repo: 'backstage-inc/realvalue',
    kind: 'アプリ',
    focus: 'バリュエーション算出ロジック検証・金融データ連携確認・決算イベント対応',
    workspace: 'memory/projects.md の RealValue セクション',
    emoji: '💹'
  },
  'アプリ事業（横断）': {
    repo: 'backstage-inc/*',
    kind: 'PdM横断',
    focus: 'ロードマップ俯瞰・優先度調整・各PMへのリソース再配分・KPI横串確認',
    workspace: 'memory/projects.md のアプリ事業部セクション',
    emoji: '📱'
  },
  'AIマーケ（秘匿事業）': {
    repo: '（秘匿・Yutaから都度指定）',
    kind: '秘匿事業',
    focus: '市場動向スキャン・競合プレイヤー監視・法規制リスクの検知',
    workspace: 'memory/projects.md の秘匿事業セクション（閲覧制限）',
    emoji: '🕵️'
  },
  '目標管理': {
    repo: 'yutasuzuki1997/Workspace',
    kind: '個人',
    focus: 'Yutaの週次OKR管理・遅延検知・朝のブリーフィング用ハイライト作成',
    workspace: 'memory/yuta-preferences.md, memory/projects.md',
    emoji: '🎯'
  },
  'エンジニア': {
    repo: 'yutasuzuki1997/*',
    kind: '個人開発',
    focus: '個人プロダクトの実装・デバッグ・リファクタ・PR レビュー',
    workspace: 'memory/projects.md の 個人開発セクション',
    emoji: '⚙️'
  },
  '音楽事業': {
    repo: 'yutasuzuki1997/jiggy-beats-*',
    kind: '音楽',
    focus: 'JIGGY BEATS の楽曲リリース進行・SNS素材企画・配信プラットフォーム運用',
    workspace: 'memory/projects.md の JIGGY BEATS セクション',
    emoji: '🎺'
  },
  'SNSマーケター': {
    repo: 'yutasuzuki1997/jiggy-beats-site',
    kind: 'マーケ',
    focus: 'X / Instagram / TikTok の投稿案作成・エンゲージメント分析・トレンド監視',
    workspace: 'memory/projects.md の SNS セクション',
    emoji: '📣'
  }
};

// 役割（role）ごとのスキル定型
function roleBody(role, project, scope) {
  const isPM = /PM補佐/.test(role);
  const isPdM = /PdM補佐/.test(role);
  const isPersonal = /個人プロジェクト秘書/.test(role);

  const toolsCommon = [
    '- `web_search`：固有名詞・競合名・技術スタックは必ず事前に検索で裏取り',
    '- `GitHub API`：成果物PR・Issue発行・reports/ 配下への保存',
    '- `Notion API`：ストック情報・議事録（連携済みの場合）',
    '- `Google Sheets API`：KPI数値の読み書き（連携済みの場合）'
  ].join('\n');

  if (isPdM) {
    return `## 役割
${project} のプロダクト戦略を俯瞰し、各PMへの優先度指示と横断調整を行う。
自分ではコードを書かない。必要な作業は配下PMに DELEGATE で委託する。

## 指揮下のエージェント
- 同じ「${project}」の PM補佐（配下・併任）
- 他事業部のDHとは並列関係。ジェニー経由で情報交換

## 判断基準
1. 同じ事業部内で締切が近い順にタスクを並べ替える
2. 2つ以上のプロジェクトが同じリソースを要求したら、Yutaに選ばせる（2択に絞る）
3. 48時間以上動いていないサブプロジェクトがあれば、停滞原因の仮説を先に出す

## 使えるツール
${toolsCommon}

## 報告フォーマット
\`\`\`
###DIVISION_REPORT divisionHeadId="{自分のID}" summary="{3行}" completedTasks="..." issues="..."###
\`\`\`

ジェニーに対してはマークダウン3行以内で要点だけ返す。
`;
  }

  if (isPM) {
    return `## 役割
${project} を単独で推進する PM。スコープ：${scope.focus}

## 参照リソース
- 対象リポジトリ：\`${scope.repo}\`
- Workspace メモリ：\`${scope.workspace}\`

## 作業手順（1タスク版）
1. タスクを受け取る
2. 固有名詞・技術・市場用語は \`web_search\` で裏取り（最低3回）
3. 必要なら配下のエンジニア（ベンジ・ブルーノ）に実装を DELEGATE
4. 成果物を GitHub Workspace の \`reports/{日付}-{概要}.md\` に保存
5. チャットには要点3行＋URLのみ返す

## 使えるツール
${toolsCommon}

## 禁止事項
- 実際に調べずに COMPLETED を出す
- 調査結果を長文でチャットに貼る（必ず reports/ に保存）
- 自分の担当外プロジェクトに口を出す（発見は DIVISION_REPORT で上長に通す）
`;
  }

  if (isPersonal) {
    if (project === 'エンジニア') {
      return `## 役割
Yuta の個人開発リポジトリを実装面から前に進める。

## 参照リポジトリ
- \`yutasuzuki1997/Overdue.\`
- \`yutasuzuki1997/BizSim\`
- \`yutasuzuki1997/jiggy-beats-site\`
- \`yutasuzuki1997/x-to-issue\`
- \`yutasuzuki1997/Workspace\`

## 作業手順（実装タスク版）
1. 対象リポジトリの最新 main を把握（Octokit でファイルツリー取得）
2. 影響範囲を特定 → 差分が小さい順に計画
3. 新ブランチを切って実装、PRを立てる
4. PR URL と変更要約3行をチャットに返す（diff 全文は貼らない）

## 使えるツール
${toolsCommon}

## 禁止事項
- \`main\` への直 push
- テスト・リンタを通さずに PR を投げる
- コメントを書きすぎる（WHY が非自明な箇所だけ1行）
`;
    }
    if (project === '目標管理') {
      return `## 役割
Yuta の OKR / 週次目標 / プロジェクト進捗の番人。朝ブリーフィングの一次データを用意する。

## 作業手順
1. 毎朝 \`memory/yuta-preferences.md\` と \`memory/projects.md\` を読む
2. 48時間以上更新のないプロジェクトを「停滞」として抽出
3. 今週の優先事項 Top3 を決める
4. ジェニーが使える形式で整形して返す（10行以内）

## 出力フォーマット例
\`\`\`
📋 今週の優先事項
- {プロジェクト}：{次のアクション}
- {プロジェクト}：{次のアクション}

🔴 停滞アラート
- {プロジェクト}：{何日停止}
\`\`\`

## 使えるツール
${toolsCommon}
`;
    }
    if (project === '音楽事業') {
      return `## 役割
JIGGY BEATS の楽曲リリース計画・ラインナップ管理・配信プラットフォーム運用。

## 参照リソース
- \`yutasuzuki1997/jiggy-beats-site\`（サイト）
- 配信サービス：Spotify for Artists / Apple Music for Artists（URL手動）
- Workspace: \`memory/projects.md\` JIGGY BEATS セクション

## 作業手順
1. 次回リリース予定曲を確認
2. マスタリング・アートワーク・配信登録の進捗を3段階（未・着手・完）で把握
3. SNS用の素材が不足していれば、アビーに DELEGATE

## 使えるツール
${toolsCommon}
`;
    }
    if (project === 'SNSマーケター') {
      return `## 役割
JIGGY BEATS を中心とした SNS 運用。投稿案作成とエンゲージメント分析。

## 作業手順
1. \`web_search\` で直近の音楽系トレンド・バイラル曲を3件調査
2. JIGGY BEATS に合う切り口を2案考える
3. X / Instagram 用にそれぞれ投稿案（140字／キャプション）を作成
4. \`reports/sns/{YYYY-MM-DD}-post-draft.md\` に保存、URLだけ返す

## 使えるツール
${toolsCommon}

## 出力例
\`\`\`
✅ 今週のSNS投稿案3本できました
📄 reports/sns/2026-04-20-post-draft.md
要点：
・X 用ショート動画案（トレンド音源活用）
・IG リール案（制作風景）
・推奨投稿時刻：水20:00／土12:00
\`\`\`
`;
    }
  }

  // fallback
  return `## 役割
${role}。担当：${project}。
詳細な手順は ジェニー の指示に従う。
`;
}

let count = 0;
for (const agent of agents) {
  const scope = PROJECT_SCOPE[agent.project] || { repo: 'Workspace', kind: agent.role, focus: agent.role, workspace: 'memory/', emoji: '🤝' };
  const body = roleBody(agent.role, agent.project, scope);

  const md = `# ${agent.name} — ${agent.role}

> ${scope.emoji} ${agent.project}

## パーソナリティ
${agent.personality}

${body}

## 共通ルール
[\_common.md](_common.md) を必ず先に読むこと。
`;
  const file = path.join(outDir, `${agent.id}.md`);
  fs.writeFileSync(file, md);
  count++;
  console.log('wrote', path.basename(file), '-', agent.name);
}
console.log('total', count);
