# AI Agents（1人会社 Ops）

**会社ごと**に独立したデータで、CEO・セクレタリー・各担当の AI メンバーを運用します。詳細は [docs/MULTI_COMPANY.md](./docs/MULTI_COMPANY.md)。

## 使い方

### デスクトップアプリ（自分の Mac で開発・試用）

```bash
npm install
npm run desktop
```

ターミナルは **閉じないでください**（閉じるとアプリも終わります）。ずっとこのやり方でも動きますが、**他の人に渡す用途には向きません**（Node やソースが必要）。

初回は **社員管理** → **API・接続** で [Anthropic](https://console.anthropic.com/) の API キーを各自登録します。

### 他の人に使ってもらう（配布用ビルド）

あなたの Mac で一度ビルドし、**生成されたファイルだけ**を渡します。

```bash
cd one-person-company-ops
npm install
npm run pack:mac
```

`dist/` に出るものの例:

| ファイル | 使い方 |
|---------|--------|
| **`.dmg`** | 開いてアプリを Applications にドラッグ → 渡した相手も同様にインストール |
| **`.zip`** | 解凍して `AI Agents.app` をそのまま配る |

- **各ユーザーは自分の Anthropic API キーを** アプリ内「API・接続」で登録する必要があります（キーは共有しない運用が安全です）。
- 初回起動で **「開発元が未確認」** と出たら、システム設定 → プライバシーとセキュリティ → **「このまま開く」** で開けます。会社や不特定多数に配るなら、後述の **署名・公証** を検討してください。

**Windows 向け**（Windows PC で実行）:

```bash
npm run pack:win
```

`dist/` にインストーラー（`.exe`）ができます。

### ブラウザ

```bash
npm start
```

- 既定は **Anthropic API** モード（tmux 不要）。
- 従来の **tmux + Claude Code** にする場合は、社員管理 → API・接続で「tmux」に切り替え、`./start-agents.sh` を実行。

### macOS アプリをビルド

```bash
npm run pack:mac
```

成果物は `dist/` に出力されます。

詳細は [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) を参照。

## 1人会社（cc-company）と組み合わせる

Claude Code の [cc-company](https://github.com/Shin-sibainu/cc-company) で `.company/` を育てつつ、ダッシュボードでメンバー稼働を見る運用ができます。

- **プロジェクト管理**で `.company` があるフォルダを `repoPath` に登録 → 上部バーに**秘書のTODO**が表示されます。
- 解説: [docs/ONE_PERSON_COMPANY.md](./docs/ONE_PERSON_COMPANY.md) · [動画](https://www.youtube.com/watch?v=cfoE_8Llde0)
