# OneCompanyOps 開発スキル（Boris Cherny 30 Tips完全適用版）

## このプロジェクトの目的と設計思想

OneCompanyOpsは「AI会社」として動く。
- Yutaは社長。ジェニーに相談・指示する
- エージェントたちは自律的に仕事を見つけて進めて報告する
- Yutaが何も言わなくても会社が動いている状態が理想

---

## Tip 1：大きい変更はPlan Modeで分離する

以下の場合は必ずPlan Modeで調査してから実装する：
- `server.js` への変更（200行以上に影響する場合）
- 新しいエージェントの追加
- アーキテクチャの変更
- 複数ファイルにまたがる修正

並列開発時は worktree を使う：
```bash
git worktree add ../oco-agent-fix -b feat/agent-communication
git worktree add ../oco-briefing-fix -b feat/briefing-improvement
```

---

## Tip 4：同じミスを2回したらCLAUDE.mdに追記する

バグや間違いが再発したら即座に `.claude/CLAUDE.md` の「確認済みの禁止事項」に追記する。
追記フォーマット：`- {何をした} → {正しい対応}`

---

## Tip 5：繰り返し作業はスキル化する

以下のスクリプトは再実行可能なスキルとして保存済み：
- `scripts/check-integrations.js` — Notion/Sheets/Calendar接続確認
- `scripts/gen-agent-skills.js` — エージェントスキルmd再生成
- `scripts/expand-roster.js` — エージェント追加（idempotent）
- `scripts/backfill-hierarchy.js` — 階層レベル再計算
- `scripts/enrich-pm-skills.js` — PM md のプロジェクト固有部分追記

---

## Tip 6/7：設定とhookで自動化する（.claude/settings.json）

- ファイル編集後に `npm run build` を自動実行してエラーを即検知
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` でチーム機能を有効化
- 頻繁に使うBashコマンドはpermissions.allowに追加して確認ダイアログを削減

---

## Tip 9：subagentはClaude Code標準形式で定義する（.claude/agents/）

subagentファイルの形式：
```markdown
---
name: エージェント名
description: どんなときに呼び出すかの説明（具体的に！）
tools: Bash, Read, Write, WebSearch
---

# システムプロンプト
```

descriptionが曖昧だと自動振り分けが効かない。具体的なトリガー条件を書く。

---

## コスト最適化（必ず守ること）

### モデルルーティング（lib/llm-router.js）
| タスク種別 | モデル | 理由 |
|---|---|---|
| タスク分類・タイトル生成・曖昧さチェック | Gemini Flash 2.0 | 最安・十分な精度 |
| 朝ブリーフィング | Gemini Pro 1.5 | Sonnetより安い |
| instant/lightの返答 | Gemini Flash 2.0 | 簡単な応答に高品質不要 |
| ジェニーとYutaの会話（heavy以上） | Claude Sonnet | 最重要UXは品質優先 |
| エージェントの実作業 | Claude Sonnet | 複雑な推論が必要 |

### プロンプトの最適化
- 関係するエージェントのid・displayName・roleのみ渡す（全32名不要）
- ジェニーへのAPIコール：最新5件のみ
- Workspaceの記憶：5分間キャッシュ・関連プロジェクトのみ

---

## アーキテクチャの原則

### Shared Task List（lib/task-list.js）
- タスクは `Workspace/tasks/{pending|in-progress|completed}/` に保存
- エージェントはclaimしてから作業する
- 完了したらcompleteを呼んでから報告する

### エージェント間通信（lib/agent-mailbox.js）
- エージェントIDで直接メッセージを送る
- ポーリング間隔：30秒
- 未読は次回のルーティン発火で処理

### エージェント階層（30名体制）
```
ジェニー（秘書／チャット窓口）
├─ L1: 事業部長・統括（5名）
│   ├─ ティアラ (agent-5)：アプリ事業統括（横断）
│   ├─ アキ (agent-6)：アプリ事業統括（横断）
│   ├─ スコッティ (agent-1773292418821)：AIマーケ
│   ├─ ハル (agent-dh-personal)：個人事業部長
│   └─ リオ (agent-dh-music)：音楽事業部長
├─ L2: プロジェクトPM（8名）
│   ├─ シバ太 (agent-1)：WAVERS
│   ├─ ゴルディ (agent-2)：あげファンズ
│   ├─ ダッキー (agent-3)：NoBorder
│   ├─ ボーディ (agent-4)：RealValue
│   ├─ トム (agent-pm-overdue)：Overdue.
│   ├─ ナギ (agent-pm-bizsim)：BizSim
│   ├─ コウ (agent-pm-xtoissue)：x-to-issue
│   └─ イサ (agent-pm-jiggy-site)：jiggy-beats-site
└─ L3: 専門担当（17名）
    ├─ 個人: マンチー/ベンジ/ブルーノ/メイン/アビー
    └─ 横断: ジェシー/サラ/イヴ/フィン/ハナ/ダリ/グレイ/オリー/ミコ/モモ/レン/タビ
```

### DELEGATEプロトコル
```
###DELEGATE agentId="{id}" task="{詳細タスク}" progress="0" estimatedMinutes="{見積}"###
```

---

## 作業前チェックリスト（全項目YES でなければ実装を見直す）

- [ ] Yutaの作業を減らす実装か？（増やすなら間違い）
- [ ] エージェントが実際に作業するか？（テキスト生成だけなら不十分）
- [ ] 成果物がGitHubに残るか？（残らないなら設計を見直す）
- [ ] 次回の会話で文脈が引き継がれるか？（引き継がれないならWorkspace保存を追加）
- [ ] Yutaが何も言わなくても動くか？（操作が必要なら最小化する）

---

## 絶対にやってはいけないこと

1. 形だけの実装（実際にAPIを叩かない・ファイルが保存されない）
2. トークン無駄遣い（全エージェント情報を毎回渡す・長い履歴を渡す）
3. L1事業部長が自分で調査・実作業する（必ずL2にDELEGATE）
4. L2 PMが直接コード実装する（L3専門担当にDELEGATE）
5. 「〜します」でCOMPLETED（実際に作業せずに完了報告）
6. テストせずに完了報告
7. 人間の確認を求めて止まる
8. リモートにpushせずに終わる

---

## 完了報告フォーマット（core/skills/agents/_common.md）

```
✅ {自分の名前}が完了しました

📄 成果物：{ファイルパス or ページタイトル}
🔗 URL：{GitHub/Notion/Sheets URL}

要点：
・{具体的なデータ・数値・発見}
・{具体的なデータ・数値・発見}
・推奨アクション：{次にYutaがやる／誰かに振る作業}

###COMPLETED agentId="{自分のID}" summary="{要点100字}"###
```

---

## ルーティン一覧（core/skills/routines.json）

| id | 名前 | 頻度 | 時刻 (JST) |
|---|---|---|---|
| routine-001 | 毎朝のブリーフィング | daily | 09:00 |
| routine-002 | 週報レポート生成 | weekly (金) | 18:00 |
| routine-003 | 停滞プロジェクト検知 | daily | 12:00 |
| routine-004 | JIGGY BEATS SNSリマインド | weekly (水) | 20:00 |
| routine-005 | Overdue.進捗確認 | weekly (火) | 10:00 |

---

## リモートへのアップ（作業完了後に必ず実行）

```bash
npm run build
git add .
git commit -m "{作業内容}"
git push origin main
```
