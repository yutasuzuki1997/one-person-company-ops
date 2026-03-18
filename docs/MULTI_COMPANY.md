# 複数会社モデル

## データの分離

- **会社ごと**に `companies/{会社ID}/` 以下に `agents.json`・`projects.json`・`company-settings.json`（APIキー・モデル）を保存。
- **WebSocket・REST** は常に `companyId` でスコープ。別会社のエージェント出力や設定は混在しない。
- **会社をまたいだ参照**は API `POST /api/cross-company` で拒否（将来・明示指示時のみ拡張予定）。

## UI

1. **① 指示ダッシュボード** — メンバー（CEO・セクレタリー・各担当）の稼働表示・一斉送信・会社別 API 設定。
2. **② 開発・ファイル構成** — 会社ワークスペース（Git リポジトリ想定）のパス、`ceo/` `secretary/` `departments/` `Knowledge/` のひな形生成、ツリー表示。
3. **③ ナレッジ** — `Knowledge/` 配下とプロジェクトに紐づく `knowledgePath` の一覧。

## 推奨リポジトリ構成

```
会社ルート/
  CLAUDE.md
  ceo/CLAUDE.md, ceo/skills/
  secretary/…, departments/engineering/…
  Knowledge/_shared/, Knowledge/{プロジェクト}/
```

「＋ 会社を追加」で新規会社を作成すると、既定で CEO・秘書・開発・PM・ナレッジ担当の5名が生成されます。
