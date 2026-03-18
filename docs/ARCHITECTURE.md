# AI Agents — アーキテクチャ

## 構成

| 層 | 役割 |
|----|------|
| **Electron** (`electron/main.cjs`) | デスクトップ枠。`userData` を `AI_AGENTS_DATA_DIR` に渡してサーバーを起動。 |
| **Express + WS** (`server.js`) | REST・WebSocket・定期ブロードキャスト。 |
| **静的 UI** (`public/`) | ダッシュボード・設定・トーク画面。 |

## 接続モード（`app-settings.json`）

1. **`anthropic_api`（既定）**  
   - ユーザが [Anthropic Console](https://console.anthropic.com/) で発行した API キーを保存。  
   - 各エージェントは **Messages API** でストリーミング応答。会話はエージェントごとにサーバメモリ上で保持。  
   - tmux / Claude Code は不要。

2. **`tmux`**  
   - 従来どおり `tmux` セッション `one-person-company-ops` 上の Claude Code と連携。  
   - `start-agents.sh` が必要。

## データの置き場所

| 実行方法 | データディレクトリ |
|----------|-------------------|
| `npm start` / `node server.js` | リポジトリ直下（`agents.json` 等） |
| **Electron アプリ** | OS のアプリデータ領域（macOS: `~/Library/Application Support/one-person-company-ops/` 相当） |

API キーは **`app-settings.json`** に平文保存（ユーザ専用マシン想定）。リポジトリに含めないこと（`.gitignore` 済み）。

## 1人会社（cc-company）連携

[cc-company](https://github.com/Shin-sibainu/cc-company) の `.company/` がある `repoPath` をプロジェクトに登録すると、ダッシュボードが秘書TODOを表示し、API エージェントのプロンプトに組織文脈が入る。詳細は [ONE_PERSON_COMPANY.md](./ONE_PERSON_COMPANY.md)。

## npm スクリプト

- `npm start` — ブラウザ + ローカルサーバー（ポート 3000 前後）
- `npm run desktop` — Electron デスクトップアプリ
- `npm run pack:mac` — macOS 用 `.app` / zip ビルド（要 Xcode コマンドラインツール）
