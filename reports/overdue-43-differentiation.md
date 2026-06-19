# Overdue. Guideline 4.3 差別化文言ドラフト

- 作成日: 2026-06-19
- 目的: App Store審査 Guideline 4.3（類似アプリ飽和）対策。アプリ実体に基づく独自性を、名称・サブタイトル・説明・キーワードで明示する。
- 状態: **ドラフト（未適用）**。承認後に `fastlane/metadata/` ＋ App Store Connect に反映する。
- 根拠: ソース実機能（`OverdueWidget`/`NotificationService`/`ComplianceView`/`EditReasonSheet` 等）。創作なし。

---

## 0. 何が問題か（現状）
現メタデータは「**期限切れタスクを見逃さないためのシンプルなタスク管理アプリ**」＝最も埋もれる汎用Todo訴求。キーワードも `タスク,リマインダー,習慣,ToDo…` と独自性ゼロ。
→ レビュアーから「既存Todoの重複(4.3)」と見られるリスク。**実体は規律・督促特化の尖ったアプリ**なのに、それを自ら隠している。これを直すのが今回の核心。

---

## 1. 差別化コンセプト文（1段落・申請の軸）
> Overdue. は「やることリスト」ではなく「**自分との約束を守らせる**」アプリ。期限を過ぎても完了するまで通知が段階的に増え続け（15分→1時間→…→14日）、「期限遵守率」という独自指標で自己規律を可視化する。締切を自分で甘く動かせば遅延として記録され、辛口のフィードバックが返る。タスクを溜め込む汎用Todoとは逆に、機能を絞り「本当に大切なことだけ」を必ず実行させることに特化している。

---

## 2. 独自機能（4.3反論／レビュアー向けの事実リスト）
汎用Todo・習慣化アプリに無い、Overdue.固有の要素：

1. **期限超過後の段階的エスカレーション通知** — 完了するまで15分/1h/3h/6h/12h/1日/2日/3〜14日と通知が増える（通常Todoは期限前1回で終わる）。Time Sensitive通知。
2. **行動を促す心理的な通知文言** — 「"約束を守らない人"でいたいのですか？」等、独自トーンで実行を促す。
3. **期限遵守率（Compliance Rate）という独自KPI** — 達成数でなく「期限内完了率」を中核指標化し期間別に可視化。
4. **遵守率連動の辛口パーソナル評価** — 「You are sabotaging your own credibility.」等、自己規律・信用をテーマにした独特のフィードバック。
5. **編集・削除に理由選択を強制し、自己都合は"遅延"として記録** — 締切を甘く動かす行為に遵守率ペナルティ。一般Todoは無条件に期限変更可。
6. **"本当に大切なことだけ"の設計思想** — カテゴリ4種固定・機能を意図的に削減。汎用Todoの逆方向。
7. **超過状態の強い視覚化** — 超過=赤背景、緊急=赤点滅、ウィジェットも超過で赤・緊急でオレンジに変色。

補足（4.3に有利な事実）: **完全無料・IAP無し・アカウント無し・SwiftDataローカル完結**。テンプレ/ノーコード製でない独自実装。

---

## 3. メタデータ書き換えドラフト

### 日本語（ja）
- **App名（30字以内）**: `Overdue. 締切を破らない習慣`
- **サブタイトル（30字以内）**: `期限を守らせる督促型タスク管理`
- **プロモーション文（170字以内）**:
  `「あとでやる」を許さないタスクアプリ。期限を過ぎても完了するまで通知が増え続け、あなたの「期限遵守率」を記録します。締切を自分で甘くすれば遅延として残る——本当に大切なことだけを、必ずやり切るために。`
- **説明文（description）**:
```
Overdue. は「やることリスト」ではありません。自分との約束を必ず守らせるための、規律重視のタスク管理アプリです。

■ 期限を過ぎても、終わるまで追いかける
一般的なリマインダーは期限前に一度通知して終わり。Overdue. は期限を過ぎてからも、完了するまで段階的に通知が増え続けます（15分後→1時間後→…→数日後）。「あとでやる」を物理的に許しません。

■ 期限遵守率で自分を可視化
完了した数ではなく「期限内に終わらせた割合（遵守率）」を中核指標に。全期間・半年・1ヶ月・1週間で推移を確認でき、遵守率に応じた率直なフィードバックが返ります。

■ 締切を甘くしたら、記録に残る
タスクの編集・削除には理由の選択が必要。自己都合で期限を動かすと「遅延」として記録され、遵守率に反映されます。締切から逃げられません。

■ 本当に大切なことだけ
カテゴリは仕事・プライベート・習慣・その他の4つだけ。あれこれ詰め込む汎用Todoとは逆に、機能を絞って「絶対に達成したいこと」に集中させます。

■ 主な機能
・単発タスク／繰り返しルーティン（毎日・毎週・毎月・毎年、曜日や第N曜日指定、終了条件）
・期限超過の段階的エスカレーション通知（Time Sensitive）
・期限遵守率グラフと辛口の評価メッセージ
・完了履歴・編集削除履歴
・ホーム画面ウィジェット（締切が近いタスクを表示、超過で赤く変化）
・ライト/ダークテーマ、24時間表示

■ プライバシー
データは端末内に保存（SwiftData）。アカウント登録・課金・サーバー送信は一切ありません。完全無料。
```
- **キーワード（100字以内・カンマ区切り）**: `締切,期限,督促,遵守率,自己管理,規律,習慣化,ルーティン,リマインダー,先延ばし,タスク,継続`

### 英語（en-US）
- **App Name（30 chars）**: `Overdue. Beat Your Deadlines`
- **Subtitle（30 chars）**: `Relentless deadline reminders`
- **Promotional text（170 chars）**:
  `The task app that won't let you procrastinate. Miss a deadline and reminders keep escalating until you finish. Track your compliance rate. Get what truly matters done.`
- **Description**:
```
Overdue. isn't a to-do list. It's a discipline-first task app built to make you keep your promises to yourself.

CHASES YOU UNTIL IT'S DONE
Most reminders notify you once before the deadline and stop. Overdue. keeps escalating notifications AFTER the deadline—until you actually finish (15 min, 1 hour, … up to days later). "I'll do it later" is no longer an option.

SEE YOUR COMPLIANCE RATE
Your core metric isn't how many tasks you completed—it's the share you finished ON TIME. Track it across all-time, 6 months, 1 month, and 1 week, with blunt feedback based on your rate.

MOVE A DEADLINE? IT'S ON THE RECORD
Editing or deleting a task requires a reason. Loosen a deadline for your own convenience and it's logged as a delay that lowers your compliance rate. No escaping your commitments.

ONLY WHAT TRULY MATTERS
Just four categories: Work, Private, Habit, Others. Unlike everything-bucket to-do apps, Overdue. stays minimal so you focus on what you absolutely must get done.

KEY FEATURES
- One-time tasks and recurring routines (daily/weekly/monthly/yearly, weekday or Nth-weekday rules, end conditions)
- Escalating overdue notifications (Time Sensitive)
- Compliance-rate charts with candid feedback
- Completion and edit/delete history
- Home screen widget (shows upcoming deadlines, turns red when overdue)
- Light/Dark themes, 24-hour time

PRIVACY
All data stays on your device (SwiftData). No account, no purchases, no servers. Completely free.
```
- **Keywords（100 chars）**: `deadline,overdue,procrastination,discipline,accountability,compliance,routine,reminder,habit,task`

---

## 4. もしリジェクトされたら（Resolution Center 反論テンプレ・英語）
> Overdue. is not a duplicate of existing reminder/to-do apps. It is a discipline/accountability app with mechanics not found in generic task managers:
> 1) Post-deadline escalating notifications that continue until completion (not a single pre-deadline alert);
> 2) A "compliance rate" metric (on-time completion ratio) with period-based charts and candid feedback;
> 3) Mandatory reason logging for edits/deletes, where self-serving deadline changes are recorded as delays and penalize the rate;
> 4) An intentionally minimal, "only what matters" design (fixed 4 categories).
> The app is fully native (SwiftUI/SwiftData), free, with no IAP, no account, and all data stored locally. Screenshots and the feature list above demonstrate the unique concept.

---

## 5. 適用手順（承認後）
1. `fastlane/metadata/ja/` と `en-US/` に name.txt / subtitle.txt / promotional_text.txt / description.txt / keywords.txt を作成・更新
2. スクショに独自要素（超過の赤表示・遵守率グラフ・督促通知）が伝わるカットを含める（2.3とも連動、`reports/overdue-submission-prep.md` D項）
3. App Store Connect で App Privacy =「Data Not Collected」を設定
4. 再提出
```
