# 1人会社 × AI Agents ダッシュボード

ダッシュボードは **AIメンバーの稼働（応答・状態）を俯瞰する窓**、裏側の運用モデルは **[cc-company](https://github.com/Shin-sibainu/cc-company)** が担う想定です。

## 役割の分け方

| 層 | 役割 |
|----|------|
| **cc-company**（Claude Code プラグイン） | `/company` で秘書を窓口に、TODO・メモ・部署追加。`.company/` に組織の「実体」がファイルとして溜まる。 |
| **このダッシュボード** | 名前付きの AI メンバー（秘書に相当する窓口や、開発・PM など）の **稼働状況を一覧**。API モードなら Anthropic 経由で即応答、tmux モードなら Claude Code 端末と連携。 |

概念図:

```
あなた
  ├─ Claude Code + cc-company … 日々の作業・.company/ への記録
  └─ AI Agents ダッシュボード … メンバー別の稼働・一斉指示・トーク
```

解説動画: [YouTube](https://www.youtube.com/watch?v=cfoE_8Llde0)

## セットアップの流れ

### 1. cc-company を入れる（Claude Code 側）

[cc-company README](https://github.com/Shin-sibainu/cc-company) のとおり:

```text
/plugin marketplace add Shin-sibainu/cc-company
/plugin install company@cc-company
```

プロジェクトで `/company` を実行し、秘書の初期セットアップまで進めると `.company/` ができます。

### 2. ダッシュボードと同じ「会社のルート」をプロジェクトに登録

**プロジェクト管理** で、`.company` があるリポジトリのパスを **作業ディレクトリ (repoPath)** に設定します。

- ダッシュボード上部の **「1人会社・秘書TODO」** バーに、その日の秘書 TODO（`secretary/todos/YYYY-MM-DD.md`）が表示されます。
- **API モード** の各エージェントには、「このユーザは cc-company で1人会社運用している」旨がシステムプロンプトに含まれ、**あなたのロールに沿って**応答しやすくなります。

### 3. 社員（エージェント）を部署に寄せる（推奨）

cc-company の部署例（秘書、PM、リサーチ、開発、経理…）に合わせて、[社員管理](https://github.com/Shin-sibainu/cc-company#%E9%83%A8%E7%BD%B2%E5%BF%85%E8%A6%81%E3%81%AB%E5%BF%9C%E3%81%98%E3%81%A6%E8%BF%BD%E5%8A%A0)と同じ名前・役職でエージェントを置くと、頭の中の対応が楽です。

- **秘書**に相当するエージェントを1人置き、ダッシュボードからも雑談・整理依頼ができる
- 開発・PM などは cc-company で部署が増えたタイミングに合わせてダッシュボードにも追加

## データの流れ

- **cc-company** → `.company/secretary/todos/*.md` などに **永続化**
- **ダッシュボード** → そのファイルを **読み取り専用で表示**（編集は引き続き Claude Code 側が主）

両方を同じマシン・同じ repoPath で使う前提です（Electron ならその Mac 上のパスが読める必要があります）。

## 参考リンク

- [Shin-sibainu/cc-company](https://github.com/Shin-sibainu/cc-company) — プラグイン本体（MIT）
- [解説動画](https://www.youtube.com/watch?v=cfoE_8Llde0)
