# Overdue. App Store 申請前チェックリスト（自走可能分の確定）

- 作成日: 2026-06-30
- 担当: agent-pm-overdue（トム）
- 位置づけ: 鈴木さんの実機操作に依存しない「申請前チェック」を実走で確定。重複調査はしない。
- 既調査（再掲しない / 前提）: `reports/appstore-rejection-overdue.md` / `reports/overdue-submission-prep.md` / `reports/overdue-43-differentiation.md` / `reports/overdue-fastlane-metadata.md` / `reports/overdue-qa-screenshots.md`
- 対象リポジトリ: `~/projects/PJ_Overdue`（本番ソース）。提出系コマンド（fastlane deliver / submit / TestFlight配布）は一切実行していない。

---

## 結論（3行）

1. **サポートURL `https://github.com/yutasuzuki1997/Overdue` は HTTP 404＝デッド。即修正必須**（主リポはprivate=公開サポート先として不適）。
2. **プライバシーポリシーURLは `https://yutasuzuki1997.github.io/overdue-privacy-policy/` が HTTP 200で生存・内容もData Not Collectedと整合**。ただしHTML本文が破損（見出しが1→2→5→6で飛び、2章本文途切れ、3・4章欠落、連絡先メール末尾欠落）→ **公開版・ローカル版とも要修正**。
3. **App Privacy=「Data Not Collected」の根拠は機械的に確定**（第三者SDKゼロをツリー走査で実証）。申告手順は本書 §2 に確定。

---

## 1. URL生存確認（実走 curl で判定）

`~/projects/PJ_Overdue/fastlane/metadata/{ja,en-US}/` を実調査した結果、`support_url.txt` のみ存在し、`privacy_url.txt` / `marketing_url.txt` は**ファイル自体が無い**。プライバシーポリシーURLはfastlaneメタデータに未設定で、ASCに直接入力する運用と判断。

| 種別 | URL | 実走判定 | 備考 |
|---|---|---|---|
| サポートURL（fastlane記載） | `https://github.com/yutasuzuki1997/Overdue` | **HTTP 404（デッド）** | 主リポ remote は `Overdue.git` だが Web は404＝private。public README/PRIVACY も全て404。**ストアのサポートURLとして使えない** |
| 開発者GitHubアカウント | `https://github.com/yutasuzuki1997` | HTTP 200 | アカウントは生存。リポ単体が非公開 |
| プライバシーポリシー（実体発見） | `https://yutasuzuki1997.github.io/overdue-privacy-policy/` | **HTTP 200（生存）** | GitHub Pages。リポ `overdue-privacy-policy`（public, HTTP 200）。`~/projects/PJ_Overdue/overdue-privacy-policy/`（ネスト独立リポ, origin `overdue-privacy-policy.git`）が実体 |

### 1-a. サポートURL: 要対応（鈴木さん or eng）
404のままだとGuideline 2.1（メタデータURL不備）でリジェクト確実。**代替案（いずれか）**:
- (A) 推奨・最速: **プライバシーポリシーと同じ GitHub Pages リポにサポートページ（簡単な使い方＋問い合わせメール）を1枚追加**し、その URL を `fastlane/metadata/{ja,en-US}/support_url.txt` に差し替え。例: `https://yutasuzuki1997.github.io/overdue-privacy-policy/support.html`。
- (B) `Overdue` リポを public 化し README を整備（コード非公開を望むなら不可）。
- (C) 暫定的に `mailto:` ベースの問い合わせ専用ページを1枚立てる。
- いずれも **fastlane の `support_url.txt` を更新するのはコード/ファイル変更＝eng案件**。本PMは内容のみ提示。

### 1-b. プライバシーポリシーHTML破損: 要対応（eng）
`overdue-privacy-policy/index.html`（ローカル・公開版とも同一破損）の問題:
- 見出しが **1 → 2 → 5 → 6** と欠番（3章・4章が消失）。
- 第2章「データの保存場所」本文が `<p>アプ` で途切れ、直後に第4章相当の通知文が混入（タグ破損）。
- 連絡先メールが `y.suzuki97stitt0531@` で途切れ（`gmail.com` 欠落）→ **問い合わせ不能＝2.1リスク**。
- 内容の方向性（「個人情報を一切収集しない／端末内のみ保存／外部送信なし」）は **Data Not Collected と整合**。壊れているのはHTML構造のみ。
- **対応**: index.html を全章そろえて再生成し、メールアドレスを完全表記に修正してデプロイ。コード（HTML）修正＝eng案件。本PMは実装しない。

---

## 2. App Privacy =「Data Not Collected」最終チェックリスト（根拠は実走で確定）

### 2-a. 根拠＝第三者SDK/解析/広告の有無（`~/projects/PJ_Overdue` を実走走査）

| 確認項目 | コマンド/対象 | 結果 |
|---|---|---|
| SPM依存 | `Package.resolved` 検索（build配下除く） | **存在せず＝SPM依存ゼロ** |
| CocoaPods/Carthage | `Podfile` / `Cartfile` | **どちらも無し** |
| xcodeproj のpackage参照 | `project.pbxproj` の `XCRemoteSwiftPackageReference`/`repositoryURL` | **参照ゼロ** |
| 解析/広告/トラッキング痕跡 | `*.swift` を `Firebase\|GoogleAnalytics\|Amplitude\|Mixpanel\|AppsFlyer\|Adjust\|Sentry\|Crashlytics\|RevenueCat\|Facebook\|AdMob\|IDFA\|requestTrackingAuthorization\|ATTrackingManager` でgrep | **ヒットゼロ** |
| Privacy Manifest（本体） | `Overdue/PrivacyInfo.xcprivacy` | NSPrivacyTracking=false / CollectedDataTypes=空 / UserDefaults reason `CA92.1` のみ申告 |
| Privacy Manifest（ウィジェット） | `OverdueWidget/PrivacyInfo.xcprivacy` | Tracking=false / CollectedDataTypes=空 / AccessedAPITypes=空 |

→ **収集主体（SDK・サーバー・アカウント）が存在しない**ことを機械的に確認。データは端末内SwiftData完結＝on-device処理は「収集」に当たらない（Apple定義）。よって **「Data Not Collected」申告が正当**。ATTも不要（トラッキング無し）。

### 2-b. App Store Connect での申告手順（確定）
1. ASC → 対象アプリ → サイドバー **App Privacy**。
2. 「Do you or your third-party partners collect data from this app?」→ **「No, we do not collect data from this app」** を選択 → **Save**。
3. 結果ラベルが **"Data Not Collected"** になることを確認。追加質問には答えない。
4. **整合チェック（リジェクト防止）**: プライバシーポリシー本文・スクショ・説明文（「サーバー送信は一切ありません／完全無料」）と "Data Not Collected" が矛盾しないこと。§1-b のHTML破損を直してから申告すると整合性が完全になる。
5. 将来クラッシュ/解析SDK・サーバー同期を追加したら、この申告は無効化される→Label再申告＋（該当時）ATT実装をセットで実施。

> この手順自体はASC上の操作＝鈴木さん。SDK根拠（2-a）は本PMが確定済みなので、鈴木さんは§2-bの5手順を実行するだけでよい。

---

## 3. 鈴木さん依頼チェックリスト（実機QA=C項 / スクショ差別化=D項）

> 使い方: TestFlightビルドを実機に入れ、上から順に。各行の「合否」に O / X を記入。X が出たら原因を本書末尾の「不具合メモ」へ記録し、コード修正が必要ならジェニー経由で `agent-sp-eng` に委託（PMはコードを書かない）。
> 詳細な背景は `reports/overdue-qa-screenshots.md` を参照。本表はワンシート版。

### C. 実機QA（完成度 2.1 / メタデータ整合 2.3）

| # | 確認項目 | 合否 |
|---|---|---|
| C1 | タスクを新規作成できる（タイトル・期限・カテゴリ4種） | ☐ |
| C2 | 期限を過去〜直近に設定し、超過で**赤背景＋延滞日数**が正しく表示 | ☐ |
| C3 | 繰り返しルーティン（毎日/週/月/年、曜日・第N曜日、終了条件）→次回分が正しく生成 | ☐ |
| C4 | タスク完了→完了履歴に記録され、遵守率に反映 | ☐ |
| C5 | 編集/削除時に**理由選択シート**が出る／締切を遅らせると"遅延"記録 | ☐ |
| C6 | 期限遵守率グラフが全期間/半年/1ヶ月/1週間で切替、数値が破綻しない | ☐ |
| C7 | 遵守率に応じた**フィードバック文言**が表示 | ☐ |
| C8 | 期限超過後に**段階的エスカレーション通知**（15分→1h→…）が実機で発火 | ☐ |
| C9 | 通知がTime Sensitiveとして集中モード中でも届く（許可時） | ☐ |
| C10 | **通知をOSで「拒否」してもコア機能（記録・閲覧・遵守率）が動く** | ☐ |
| C11 | 通知拒否→許可に戻すと通知が再び正常動作 | ☐ |
| C12 | ホーム画面ウィジェットを追加でき、近い締切表示／超過で赤・緊急でオレンジ | ☐ |
| C13 | アプリ側でタスク変更→ウィジェットが妥当なタイミングで更新 | ☐ |
| C14 | 起動〜各画面遷移でクラッシュしない（コールド/復帰） | ☐ |
| C15 | 大量タスク（50件以上）でも一覧・グラフが固まらない | ☐ |
| C16 | 端末日付を進める/戻すで延滞日数・遵守率が異常値にならない | ☐ |
| C17 | バックグラウンド復帰・端末再起動後もデータ保持（SwiftData） | ☐ |
| C18 | iOS最新実機で全フロー確認 | ☐ |
| C19 | iOS1世代前（サポート最小OS）で確認 | ☐ |
| C20 | 大画面（Pro Max系）と小画面（SE/mini系）でレイアウト崩れなし | ☐ |
| C21 | ライト/ダーク両テーマで表示確認 | ☐ |
| C22 | 日本語で文言が見切れない（英語提出時はen表示も） | ☐ |
| C23 | **サポートURLがブラウザで開ける**（→現状404。§1-aの差し替え後に再確認） | ☐ |
| C24 | **プライバシーポリシーURLがブラウザで開け、内容が「端末内保持・収集しない」と整合**（→§1-bのHTML修正後に再確認） | ☐ |
| C25 | アプリ内に「Coming soon」「ダミー」「TODO」等のプレースホルダが1つも無い（走査済・実機目視で最終確認） | ☐ |
| C26 | アプリ名・スクショ・説明文（差別化）が実機の実機能と矛盾しない | ☐ |

### D. スクショ差別化反映確認（メタデータ正確性 2.3 / 4.3）

> 要件（裏取り済）: iPhone **6.9インチ（1320×2868px）1セット**を用意すればASCが全シェルフへ自動縮小。**5〜8枚**。実機キャプチャのみ・モック禁止。各カットに日本語キャプション帯OK（オーバーレイは2.3.3可）。1枚目で「延滞可視化」差別化が一目で伝わること。

| # | スクショ（実機キャプチャ対象） | 想定キャプション | 反映合否 |
|---|---|---|---|
| D1 ★ | メイン一覧で超過タスクが**赤背景＋「延滞◯日」**が複数並んだ状態 | 「"あとでやる"は、もう許さない。」 | ☐ |
| D2 | 超過タスクの**段階的エスカレーション通知**（ロック画面/通知センター実機キャプチャ） | 「終わるまで、追いかける。」 | ☐ |
| D3 | **期限遵守率グラフ**（期間切替が見える） | 「"何個やったか"ではなく"期限内に終えたか"。」 | ☐ |
| D4 | 遵守率に応じた**辛口フィードバック**画面 | 「甘い言葉はかけません。」 | ☐ |
| D5 | **編集/削除の理由選択シート**（締切変更=遅延記録） | 「締切から、逃げられない。」 | ☐ |
| D6 | **ホーム画面ウィジェット**（超過で赤変色した実機ホーム） | 「ホーム画面でも、見逃させない。」 | ☐ |
| D7（任意） | 新規タスク作成/繰り返し設定画面 | 「単発も、習慣も。」 | ☐ |
| D8（任意） | 完了/編集・削除履歴画面 | 「すべて、記録に残る。」 | ☐ |
| D共通 | 全カット 6.9インチ・実機キャプチャ・モック合成なし・テーマ統一 | — | ☐ |
| D共通 | `~/projects/PJ_Overdue/fastlane/screenshots/` の現行カットが上記差別化軸を満たすか（未反映なら agent-sp-designer 連携） | — | ☐ |

---

## 残課題サマリ（要対応＝コード/ファイル変更はeng、ASC操作は鈴木さん）

| 順 | 課題 | 種別 | 担当 | 承認要否 |
|---|---|---|---|---|
| 1 | サポートURL 404 → 公開サポートページ作成＆`support_url.txt`差し替え（§1-a） | コード/ファイル | **agent-sp-eng**（ジェニー経由上申） | 反映=可 |
| 2 | プライバシーポリシーHTML破損修正＋メール完全表記＋再デプロイ（§1-b） | コード/ファイル | **agent-sp-eng** | 反映=可 |
| 3 | プライバシーポリシーURLを fastlane に明示 or ASC privacy URL欄に登録（`privacy_url.txt`無し） | ファイル/ASC | eng＋鈴木さん | — |
| 4 | App Privacy="Data Not Collected" をASCで申告（§2-b・根拠は確定済） | ASC操作 | 鈴木さん | — |
| 5 | 実機QA C1〜C26 消化 | 実機 | 鈴木さん | — |
| 6 | スクショ差別化反映 D1〜D8 | 実機/加工 | 鈴木さん＋agent-sp-designer | — |
| 7 | QAで出た不具合のコード修正（あれば） | コード | agent-sp-eng | — |
| 8 | **TestFlight配布 / App Store本番提出** | 外部影響 | 鈴木さん | **★要承認（###APPROVAL###）** |

## 不具合メモ（QAで発覚分を追記する欄）
- （C/Dで X が出た項目と症状をここに記録 → eng委託の判断材料）

---

## 出典（URL判定の裏取り・実走 curl 実施）
- サポートURL 404 / GitHub Pages 200 は 2026-06-30 に `curl -sL -w "%{http_code}"` で実走確認。
- App Store スクショ要件: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- App Review Guidelines（2.1 / 2.3.3）: https://developer.apple.com/app-store/review/guidelines/
- App Privacy Details / Manage app privacy: https://developer.apple.com/app-store/app-privacy-details/ , https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
