# Overdue. fastlane メタデータ反映レポート（差別化文言 → fastlane/metadata）

- 作成日: 2026-06-29
- 担当: agent-sp-eng（ベンジ）
- 対象タスク: `reports/overdue-qa-screenshots.md` 残タスク表「1. 差別化メタデータを fastlane/metadata/ja|en-US/ に反映」
- 元文言: `reports/overdue-43-differentiation.md`（Guideline 4.3 差別化ドラフト）
- 対象リポジトリ: `~/projects/PJ_Overdue`（本番ソースツリー）
- **提出系コマンド（fastlane deliver 等）は一切実行していない。コード/ファイル反映と検証のみ。**

---

## 結論（3行）

1. 差別化文言は `~/projects/PJ_Overdue/fastlane/metadata/ja|en-US/` に**反映済み・git commit済み**（コミット `f259df1 feat(metadata): 4.3対策でApp Storeメタデータを差別化訴求に刷新`）。git status はクリーン（未コミット差分なし）。
2. 全フィールドが `overdue-43-differentiation.md` の確定文言と一致し、**App Store の文字数制限を全て満たす**（超過なし＝削り作業は不要だった）。
3. 残るのは鈴木さんの操作（App Privacy 設定・スクショ・実機QA・URL生存確認）と、承認が必要な提出フローのみ。本作業で追加の反映は不要。

---

## 確認した fastlane 構成

`~/projects/PJ_Overdue/fastlane/` は整備済み（Appfile / Fastfile / metadata / screenshots）。
deliver 標準構成のメタデータが ja・en-US の両ロケールに存在：

```
fastlane/metadata/ja/      name.txt subtitle.txt promotional_text.txt keywords.txt description.txt release_notes.txt support_url.txt  (+ release_notes/default.txt)
fastlane/metadata/en-US/   同上
```

---

## 反映済みファイルと最終文言・文字数チェック

App Store の上限: name=30 / subtitle=30 / promotional_text=170 / keywords=100 / description=4000（文字数は前後の改行を除いた実コンテンツでカウント）。

### 日本語（ja）

| ファイル | 最終文言 | 文字数 | 上限 | 判定 |
|---|---|---|---|---|
| `fastlane/metadata/ja/name.txt` | `Overdue. 締切を破らない習慣` | 18 | 30 | OK |
| `fastlane/metadata/ja/subtitle.txt` | `期限を守らせる督促型タスク管理` | 15 | 30 | OK |
| `fastlane/metadata/ja/promotional_text.txt` | 「あとでやる」を許さない…必ずやり切るために。 | 100 | 170 | OK |
| `fastlane/metadata/ja/keywords.txt` | `締切,期限,督促,遵守率,自己管理,規律,習慣化,ルーティン,リマインダー,先延ばし,タスク,継続` | 49 | 100 | OK |
| `fastlane/metadata/ja/description.txt` | ドラフト3章の本文（「やることリストではない」〜「完全無料」）と一致 | 693 | 4000 | OK |

### 英語（en-US）

| ファイル | 最終文言 | 文字数 | 上限 | 判定 |
|---|---|---|---|---|
| `fastlane/metadata/en-US/name.txt` | `Overdue. Beat Your Deadlines` | 28 | 30 | OK |
| `fastlane/metadata/en-US/subtitle.txt` | `Relentless deadline reminders` | 29 | 30 | OK |
| `fastlane/metadata/en-US/promotional_text.txt` | `The task app that won't let you procrastinate. … Get what truly matters done.` | 167 | 170 | OK |
| `fastlane/metadata/en-US/keywords.txt` | `deadline,overdue,procrastination,discipline,accountability,compliance,routine,reminder,habit,task` | 97 | 100 | OK |
| `fastlane/metadata/en-US/description.txt` | ドラフト3章の英文（CHASES YOU…〜PRIVACY）と一致 | 1463 | 4000 | OK |

すべて上限内のため、差別化軸を保ったまま削った箇所は**なし**。

### 反映前後の差分（要点）

- 差分の実体はコミット `f259df1`（旧「シンプルなタスク管理アプリ」系の汎用訴求 → 督促/規律/遵守率の差別化訴求へ全面刷新）。本作業時点でワーキングツリーは clean。
- `keywords.txt` は ja/en ともに**末尾改行なし**（fastlane/ASC が末尾改行を1文字として誤カウントしないための正しい形）。
- `release_notes.txt` は対象外（1.2.2 の不具合修正ノートが既に入っており、差別化メタデータとは別管理）。本作業では変更していない。

### 軽微な表記メモ（リジェクト要因にはならない）

- en-US description の省略記号がドラフトの `…`(U+2026) ではなく ASCII `...` で格納されている（ASCII セーフ・意味同一）。ja description は `…` のまま。是正は任意。

---

## 既存ワークフローへの影響

- `Fastfile` の `update_whats_new` / `submit` レーンはいずれも `metadata_path: ./fastlane/metadata` を参照。メタデータ構成は標準のままなので**既存レーンは無改変で従来通り動作**する。
- 本作業ではファイル内容の検証のみで、Fastfile・Appfile・lane の変更や `deliver` 実行は行っていない。

---

## 未解決点 / 次に鈴木さんの実機QA・承認が必要な点

メタデータ反映自体は完了。再提出に進む前に以下が必要（`overdue-qa-screenshots.md` の残タスク表と整合）：

1. **実機QA（C項チェックリスト）** — 説明文・名称が実機の実機能と矛盾しないこと（2.3整合）を実機で目視確認。とくに「段階的エスカレーション通知」「遵守率グラフ」「編集理由シート」が説明文どおり動くこと。
2. **スクショ刷新（D項・6.9インチ6枚＋任意2枚）** — `fastlane/screenshots/` の現行カットが差別化軸（延滞赤表示・督促通知・遵守率）を伝えているか要確認。未反映なら agent-sp-designer 連携。
3. **App Privacy = "Data Not Collected"** を App Store Connect で設定（ASC操作・鈴木さん）。
4. **サポートURL / プライバシーポリシーURL の生存確認**（`fastlane/metadata/ja|en-US/support_url.txt` のURLがブラウザで開けるか）。
5. **en-US の `...`→`…` 是正**（任意・審査影響なし）。
6. **★承認が必要（自走では実行しない）**:
   - TestFlight 配布（外部テスターはビルド審査に回る）
   - App Store 本番再提出（`fastlane submit` / ASC からの提出）
   - これらは `###APPROVAL###` で方針提示し、鈴木さんの承認後にのみ実行。本エージェントは提出系コマンドを一切実行していない。
