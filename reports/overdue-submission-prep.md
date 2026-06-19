# Overdue. App Store 申請素材 整備プラン（実作業フェーズ）

- 作成日: 2026-06-19
- 前提: 調査レポート `reports/appstore-rejection-overdue.md`（2026-06-16）の対策を実アクションに落とし込む。
- 目的: 「調査」から「実作業」へ移行。最大リスク（4.3 / 5.1.1）を潰し、再提出可能な状態にする。

---

## このドキュメントの位置づけ

調査は完了済み。本ファイルは**実際に作る成果物のチェックリストと担当割り**。各項目が完了したら goals.json の Overdue. currentState を更新する。

---

## 進捗（2026-06-19 更新）

本番リポジトリ `~/projects/PJ_Overdue` で着手・実施済み：
- ✅ **B. Privacy Manifest**: 本体＋ウィジェットに `PrivacyInfo.xcprivacy` 作成・登録（UserDefaults=CA92.1, Tracking無）。実機ビルドで同梱を実証（BUILD SUCCEEDED）。→ ITMS-91053リスク解消
- ✅ **B. 第三者SDK**: SDK皆無を確認（manifest同梱不要）
- ✅ **B/5.1.1 ATT**: 広告・トラッキング・解析SDK無し → ATT不要。App Privacyは「Data Not Collected」で申告可
- ✅ **C. プレースホルダ走査**: Coming soon/ダミー/TODO 検出ゼロ
- ✅ **A. 差別化文言**: ドラフト作成 → `reports/overdue-43-differentiation.md`（名称/サブタイトル/説明/キーワードja+en、反論テンプレ含む）
- ⬜ 残: App Store Connectで App Privacy=「Data Not Collected」設定、スクショ刷新（独自要素を可視化）、メタデータ反映、再提出

---

## A. Guideline 4.3（類似アプリ飽和）★最優先

「やり残し（Overdue）可視化」という独自コンセプトを、機能・名称・ストア表現の3層で言語化する。

- [ ] **差別化コンセプト文（1段落）** — 汎用Todo/習慣化アプリとの違いを1文で。例の方向性: 「やるべきだったのに放置しているタスクの“延滞日数”を可視化し、罪悪感ではなく回収を促す」。担当: agent-sp-copywriter
- [ ] **独自機能の明文化（箇条書き＋スクショ対応表）** — 4.3突破事例に倣い「延滞日数の可視化／延滞ランキング／ログイン不要」等の独自要素を列挙。担当: agent-pm-overdue
- [ ] **App名・サブタイトル・説明文ドラフト** — 「Overdue.」と機能の整合（2.3も同時担保）。担当: agent-sp-copywriter
- [ ] テンプレ/他アプリ共有のソース・アセットを使っていないことを確認。担当: agent-sp-eng

## B. Guideline 5.1.1 / Privacy Manifest（機械リジェクト回避）

- [ ] 本体に `PrivacyInfo.xcprivacy` を用意し、Required Reason API（`UserDefaults` 等）の reason コードを記載 → ITMS-91053 回避。担当: agent-sp-eng
- [ ] 全third-party SDK（課金/解析/クラッシュ系）が署名付きmanifestを同梱しているか確認、古いSDKは更新。担当: agent-sp-eng
- [ ] App Privacy（Nutrition Label）を実装と一致させて申告。ローカル完結なら「Data Not Collected」を正直に申告。担当: agent-pm-overdue
- [ ] 広告/トラッキングSDKを入れない（推奨）。入れるならATTプロンプト実装＋Label整合。担当: agent-sp-eng

## C. Guideline 2.1（完成度）

- [ ] TestFlightで実機・複数OSでクラッシュ＆主要フロー検証。担当: agent-sp-qa
- [ ] プレースホルダ・"Coming soon"・ダミーテキストを全削除。担当: agent-sp-eng
- [ ] サポートURL / プライバシーポリシーURL の生存確認。担当: agent-pm-overdue
- [ ] 通知拒否でもコア機能（記録・閲覧）が動くことを確認。担当: agent-sp-qa

## D. Guideline 2.3（スクショ・メタデータ）

- [ ] スクショは実機キャプチャのみ。未実装機能を見せない。担当: agent-sp-designer
- [ ] スクショに独自コンセプト（延滞可視化）が一目で伝わるよう構成。担当: agent-sp-designer

## E. Guideline 3.1.1（課金がある場合のみ）

- [ ] Restore Purchases ボタンを設定＋ペイウォール両方に配置、実機で購入→削除→復元フローをテスト。担当: agent-sp-eng
- [ ] ペイウォールにサブスク名/期間/価格/自動更新＋規約(EULA)/プライバシーリンクを明記。担当: agent-pm-overdue

---

## 推奨着手順

1. **B（Privacy Manifest）** — 機械リジェクトなので最初に潰す。確認が早い。
2. **A（差別化）** — 4.3は再提出でも繰り返されやすい。文言＋独自機能ドキュメントを先に固める。
3. **C → D → E** — 提出直前の総点検。

## 承認が必要な操作（自走では実行しない）
- App Store への実提出 / TestFlight配布 / 本番デプロイ → 必ず鈴木さんの承認（###APPROVAL###）。
