# OneCompanyOps - Yuta

## プロジェクト概要
Yuta鈴木が1人で複数の事業を運営するための「AI会社」。
ジェニー（統括秘書）と30名のエージェントが自律的に動く。
目的：Yutaが指示しなくてもエージェントたちが仕事を進めて報告してくる状態を作る。

## ⚠️ 同じミスを2回したら必ずここに追記すること（Boris Tip 4）

### 確認済みの禁止事項
- L1（事業部長）が自分で調査・実作業する → L2（PM）に DELEGATE する
- L2（PM）が直接コードを書く・Web検索する → L3（専門担当）に DELEGATE する
- エージェントが調査結果を長文でチャットに貼る → GitHub reports/ に保存してURLと要点3行

## アーキテクチャ（2026-06 ネイティブ移行済み）
秘書ジェニーは **Claude Code ネイティブのサブエージェント機能(`Agent`ツール)** で配下に委託する。
サーバー(server.js)は1つの `claude` 秘書セッションを spawn し、stream-json を「観測」して
UI broadcast / tasks.json / コスト記録 / 承認キューに反映する。自前spawn(SPAWN_TEAMMATE)は廃止。
- 委託＝`Agent`ツール。`subagent_type` = エージェント定義(.claude/agents/*.md)の frontmatter `name`。
- 観測シグナル: `system/task_started`(委託開始) / `task_notification`(完了) / `parent_tool_use_id`(中間出力) / `result.total_cost_usd`(コスト)。
- ジェニー未起動時は従来の `lib/agent-executor.js`(API直叩き)にフォールバック。

## 重要ファイル
- `server.js`：バックエンド全体（manager配線3373付近 / 承認確認 /api/action/confirm / コスト /api/cost/today / 自走 runGoalDrivenAdvance）
- `lib/agent-teams-manager.js`：ネイティブAgent委託の起動・stream-json観測・承認検出・再起動バックオフ
- `lib/agent-executor.js`：フォールバック用のエージェント実行エンジン（API直叩き）
- `lib/cost-tracker.js`：トークン/コスト記録・日次集計・上限ガード（cost-ledger.json）
- `.claude/agents/*.md`：エージェント定義（frontmatter `name`=agentId 規約。これが subagent_type になる）
- `goals.json`：目標駆動の前進ループが読むゴール定義
- `lib/task-classifier.js`：タスク重さ判定
- `lib/llm-router.js`：マルチプロバイダーLLMルーティング
- `core/prompts/secretary.md`：（旧）ジェニーのプロンプト。現行の秘書プロンプトは `.claude/agents/jenny.md`
- `app-settings.json`：APIキー・トークン設定（コスト関連: `dailyBudgetJpy`, `usdJpyRate`）

## 注意（実態）
- 本物のサブエージェントとして起動できるのは frontmatter を持つ .md のみ。frontmatter 無しの定義はロードされない。
- `lib/claude-code-executor.js` / `lib/task-list.js` / `lib/agent-mailbox.js` は**存在しない**（過去の設計の名残）。タスク状態は tasks.json、通知は WebSocket broadcast。

## 起動方法
```bash
cd ~/one-person-company-ops-yuta
lsof -ti:3000 | xargs kill -9 2>/dev/null
npm run desktop  # 開発版起動
npm run dist:mac # インストール版ビルド
```

## APIキー同期（開発版起動時に自動実行）
`syncSettingsFromInstalled()` が `mainCli()` 先頭で実行される。
インストール版のAPIキーが開発版に自動コピーされる。

## 作業前に必ず読むこと
```bash
cat .claude/skills/onecompanyops-dev.md
```

## Plan Modeを使うべき場面（Boris Tip 1）
- `server.js` への大きな変更
- 新しいエージェントの追加
- アーキテクチャの変更
- 複数ファイルにまたがる修正
