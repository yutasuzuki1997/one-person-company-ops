# OneCompanyOps 開発スキル

## このプロジェクトの目的と設計思想

OneCompanyOpsは「AI会社」として動く。
- Yutaは社長。ジェニーに相談・指示する
- ジェニーは統括秘書。Yutaの窓口になりながら会社全体を管理する
- 各事業部長は自分の担当範囲を自律的に管理する
- 担当エージェントは自分の仕事を持って自律的に進める
- Yutaが何も言わなくても、エージェントたちが仕事を見つけて進めて報告してくる

## 作業前チェックリスト（全項目YES でなければ実装を見直す）

- [ ] Yutaの作業を減らす実装か？（増やすなら間違い）
- [ ] エージェントが実際に作業するか？（テキスト生成だけなら不十分）
- [ ] 成果物がGitHubに残るか？（残らないなら設計を見直す）
- [ ] 次回の会話で文脈が引き継がれるか？（引き継がれないならWorkspace保存を追加）
- [ ] Yutaが何も言わなくても動くか？（操作が必要なら最小化する）

## トークン使用量の最適化（必ず守ること）

### モデル選択
- 分類・判定・タイトル生成 → claude-haiku-4-5-20251001（安い・速い）
- ジェニー・事業部長 → claude-sonnet-4-20250514
- 複雑な分析が必要な場合のみ → claude-sonnet-4-20250514

### プロンプトの最適化
悪い例：全エージェント情報を毎回渡す（約20,000トークン）
良い例：必要な情報だけ渡す（数百トークン）
  → 関係するエージェントのid・displayName・roleのみ渡す

### 会話履歴
- ジェニーへのAPIコール：最新5件のみ
- エージェントへのAPIコール：タスクの指示のみ（会話履歴不要）

### Workspaceの記憶
- 全ファイルではなく関連プロジェクトのみ読み込む
- 5分間キャッシュして毎回GitHub APIを叩かない

## リモート環境へのアップ（作業完了後に必ず実行）

全作業完了後に以下を実行する：
1. npm run build（エラーなし確認）
2. npm run dist:mac（インストール版ビルド）
3. git add . && git commit -m "{作業内容}" && git push origin main
4. 配布版（one-person-company-ops）にも変更を反映してpushする

## 実装後の確認（必ず実施）

# GitHubに実際に保存されたか確認
GITHUB_TOKEN=$(node -e "const s=JSON.parse(require('fs').readFileSync('app-settings.json'));console.log(s.githubPersonalToken||'')")
curl -s "https://api.github.com/repos/yutasuzuki1997/Workspace/contents/" \
  -H "Authorization: Bearer $GITHUB_TOKEN" | python3 -m json.tool | grep '"name"'

# ビルドエラー確認
npm run build 2>&1 | grep -E "error" | head -10

## 絶対にやってはいけないこと

1. 形だけの実装（実際にAPIを叩かない・ファイルが保存されない）
2. トークン無駄遣い（全エージェント情報を毎回渡す・長い履歴を渡す）
3. Yutaの作業を増やす実装
4. 「〜します」でCOMPLETED（実際に作業せずに完了報告）
5. テストせずに完了報告
6. 人間の確認を求めて止まる
7. チャットボットとして動く実装（会社として動かす）
8. リモートにpushせずに終わる

## よくある間違いと正しい実装

間違い：エージェントが調査結果をチャットに長文で貼る
正しい：成果物をGitHubに保存してURLと要点3行を返す

間違い：毎回全32名のエージェント情報をプロンプトに含める
正しい：担当エージェントのid・displayName・roleのみ渡す

間違い：事業部長が自分で調査・実装・作成する
正しい：事業部長はDELEGATEで配下のPMに委託するだけ

## Phase 2 実装状況（2026-04-19 更新）

### 完了

- サーバー起動バグ修復（lib/ に不足していた workspace-memory, mixpanel-connector,
  calendar-connector, resource-detector, task-classifier を配置）
- Notion / Google Sheets / Google Calendar の依存関係インストール済み
- 12名のエージェントに個別スキルファイル（core/skills/agents/{id}.md）＋共通スキル
  （_common.md）を配備し、agents.json の skills[] に配線
- 定期ルーティン 5件を設定（朝ブリーフィング／週報／停滞検知／JIGGY SNS／Overdue進捗）
- 朝ブリーフィングの応答フォーマットを「10行以内・絵文字見出し」に制約
- AgentCard にプロジェクト絵文字バッジ・稼働中パルス・経過時間を追加
- x-to-issue リポジトリを独立運用、app-settings.json に登録

### 未完了（Yuta側の設定が必要）

- Notion トークンの設定（SetupWizard → Notion ステップ）
- Google Sheets サービスアカウント JSON の設定
- Google Calendar OAuth 認証の完了

これらは `node scripts/check-integrations.js` で現状が確認できる。

### 新しい完了報告フォーマット（core/skills/agents/_common.md）

\`\`\`
✅ {自分の名前}が完了しました

📄 成果物：{ファイルパス or ページタイトル}
🔗 URL：{GitHub/Notion/Sheets URL}

要点：
・{具体的なデータ・数値・発見}
・{具体的なデータ・数値・発見}
・推奨アクション：{次にYutaがやる／誰かに振る作業}

###COMPLETED agentId="{自分のID}" summary="{要点100字}"###
\`\`\`

### ルーティン一覧（core/skills/routines.json）

| id          | 名前                       | 頻度         | 時刻 (JST) |
|-------------|----------------------------|-------------|-----------|
| routine-001 | 毎朝のブリーフィング       | daily       | 09:00     |
| routine-002 | 週報レポート生成           | weekly (金) | 18:00     |
| routine-003 | 停滞プロジェクト検知       | daily       | 12:00     |
| routine-004 | JIGGY BEATS SNSリマインド | weekly (水) | 20:00     |
| routine-005 | Overdue.進捗確認           | weekly (火) | 10:00     |

### エージェント階層（30名体制）

夜間セッションで18名を追加し30名体制に拡張。階層ルーティング
（`getAgentHierarchyLevel` / `getDivisionHeadForAgent`）＋ DELEGATE
ロスター注入が実装され、名前ではなく agentId を正確に渡せる状態に。

\`\`\`
ジェニー（秘書／チャット窓口・secretary endpoint）
├─ L1: 事業部長・統括（5名）
│   ├─ ティアラ：アプリ事業統括（横断）
│   ├─ アキ：アプリ事業統括（横断）
│   ├─ スコッティ：AIマーケ（秘匿）
│   ├─ ハル：個人事業部長（目標/ENG/音楽/SNS）
│   └─ リオ：音楽事業部長（JIGGY BEATS 品質責任）
├─ L2: プロジェクトPM（8名）
│   ├─ シバ太：WAVERS
│   ├─ ゴルディ：あげファンズ
│   ├─ ダッキー：NoBorder App
│   ├─ ボーディ：RealValue App
│   ├─ トム：Overdue.（申請素材・再提出）
│   ├─ ナギ：BizSim（Supabase・ゲームロジック）
│   ├─ コウ：x-to-issue（自動変換）
│   └─ イサ：jiggy-beats-site
└─ L3: 専門担当（17名）
    ├─ 個人プロジェクト: マンチー(目標) / ベンジ・ブルーノ(ENG) /
    │   メイン(音楽) / アビー(SNS)
    └─ 横断スペシャリスト: ジェシー(リサーチ) / サラ(コピー) /
        イヴ(法務) / フィン(財務) / ハナ(QA) / ダリ(デザイン) /
        グレイ(グロース) / オリー(社内オペ) / ミコ(音源) /
        モモ(ローカライズ) / レン(データ) / タビ(コミュニティ)
\`\`\`

### コスト最適化（夜間セッション実装）

- `classifyTask` の weight に応じて Haiku 4.5 / Sonnet 4 自動選択
- `runAutonomousMessage`（ルーティン発火）は Haiku デフォルト、
  おはようだけ Sonnet に昇格
- `getMemoryContext` はデフォルト 800字/ファイル、full=true で 2000字
- 配下ロスター注入で hallucinated agentId を抑止 → リトライを削減

### 再実行可能スクリプト

- `scripts/gen-agent-skills.js` — 既存12名の skill md 再生成
- `scripts/attach-skills.js` — agents.json の skills[] 配線更新
- `scripts/backfill-hierarchy.js` — hierarchyLevel 再計算
- `scripts/expand-roster.js` — 追加18名の書き出し（idempotent）
- `scripts/enrich-pm-skills.js` — PM md のプロジェクト固有部分追記
- `scripts/check-integrations.js` — Notion/Sheets/Calendar 接続確認
