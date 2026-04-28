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

## 重要ファイル
- `server.js`：バックエンド全体
- `lib/agent-executor.js`：エージェント実行エンジン
- `lib/claude-code-executor.js`：Claude Code統合
- `lib/task-list.js`：Shared Task List
- `lib/agent-mailbox.js`：エージェント間通信
- `lib/task-classifier.js`：タスク重さ判定
- `lib/llm-router.js`：マルチプロバイダーLLMルーティング
- `core/prompts/secretary.md`：ジェニーのシステムプロンプト
- `app-settings.json`：APIキー・トークン設定

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
