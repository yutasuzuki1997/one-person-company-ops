# App Store審査リジェクト対策レポート — 習慣化アプリ「Overdue.」

- 対象: iPhone向け習慣トラッキング／リマインダーアプリ「Overdue.」
- 観点: 個人開発・習慣化／リマインダー／トラッキング系で実際に起きやすいリジェクト
- 調査日: 2026-06-16
- 情報源の時期: 2024-2026年（Apple公式 + 開発者フォーラム + 実体験記事）

---

## サマリ（このカテゴリで最も詰まりやすい順）

1. **Guideline 4.3（Spam / 類似アプリの飽和）** — 習慣化アプリは市場が飽和しており、テンプレ／ノーコード製・機能が薄いと「既存アプリの重複」と見なされ一発リジェクトされやすい。最重要。
2. **Guideline 2.1（App Completeness）** — 未解決リジェクトの40%超がここ。クラッシュ・ログイン情報不足・プレースホルダ残り。
3. **Guideline 5.1.1 / Privacy Manifest** — 2024年5月1日以降、必須化された`PrivacyInfo.xcprivacy`の不備（ITMS-91053）で機械的にリジェクト。
4. **通知の扱い** — 通知が「アプリの動作に必須」になっている、マーケ通知のオプトイン不備。
5. **Guideline 3.1.1（課金）** — Restore Purchasesボタン不在／非機能、サブスク条件文の不足。
6. **Guideline 2.3（Accurate Metadata）** — スクショが実機キャプチャでない／未実装機能を見せている。

---

## 1. Guideline 4.3 — Design: Spam（類似アプリの飽和）★最重要

### なぜ起きるか
- 4.3は「他の開発者または自分が提出済みのアプリと、コンテンツ・機能が重複するアプリ」をスパムとして扱う条項。習慣化／リマインダーは類似アプリが極めて多いカテゴリで、特に個人開発・テンプレート流用・ノーコード（FlutterFlow等）製は標的になりやすい。
- 典型トリガー: 既存アプリと同一のソースコード／アセット、購入したテンプレートの流用、複数の似たアプリの提出。
- 機能が「チェックリスト＋ローカル通知」だけだと、独自性が薄いと判断されやすい。
- 注意: 一度4.3を食らうと、機能追加・改善後も繰り返しリジェクトされる「4.3スパイラル」報告が複数ある（Apple Developer Forums thread/774834）。

### 具体的な回避策
- **独自機能を明確に作り込む**: 実際に4.3を突破した事例では「公開トラッキングプロフィール」「統計ウィジェット」「バックグラウンドフェッチ更新」「ログイン不要」といった差別化機能の追加が決め手になった（Apple Developer Forums thread/757374）。Overdue.なら、独自の「Overdue（やり残し）可視化」コンセプトを前面に出し、汎用Todoとの違いを機能で示す。
- **テンプレ／ノーコード臭を消す**: 購入テンプレートや他アプリと共有するソース・アセットを避け、UI・アイコン・オンボーディングを独自に作る。
- **アプリ名・説明・スクショで独自コンセプトを言語化**: レビュアーに「何が新しいか」を一目で伝える。
- **複数アカウント・複数類似アプリを出さない**。地域・チーム違いなどのバリエーションは1アプリ+IAPに統合する。
- **リジェクト時はResolution Centerで独自機能を箇条書き＋スクショ付きで反論**（appeal）。フォーラムでは詳細な独自機能ドキュメント提出で覆った事例が複数ある。

出典:
- https://developer.apple.com/forums/thread/757374
- https://developer.apple.com/forums/thread/774834
- https://www.oreateai.com/blog/indepth-analysis-and-solutions-for-apples-app-store-43-design-repetition-clause-in-2025/8ee4ed8fec5a6aed235934c69bafbc5e
- https://medium.com/@andriygordiychuk/our-4-3-design-spam-saga-33105602d255
- https://community.flutterflow.io/troubleshooting/post/app-store-review-help---guideline-4-3---design---since-we-do-not-QXsVHDrSQJRF3nu

---

## 2. Guideline 2.1 — App Completeness（クラッシュ・機能不全・情報不足）

### なぜ起きるか
- 未解決リジェクトの40%超が2.1関連。クラッシュ、プレースホルダの残り、不完全なバイナリ、デモアカウント不足が主因。
- ログイン機能があるのにデモアカウント／デモモードを提供していない。
- メタデータのURL（サポート・プライバシーポリシー）が空・リンク切れ。

### 具体的な回避策
- **TestFlightで実機テストを徹底**。レビュアー環境に最も近い。複数デバイス・OSバージョンで起動〜主要フローのクラッシュを潰す。
- **ログインがあるなら App Review Information にデモアカウントを記載**。提供できない場合は全機能を見せる組み込みデモモードを用意（事前承認が必要）。Overdue.が将来クラウド同期やアカウントを足す場合は必須。
- **プレースホルダ・"Coming soon"・ダミーテキストを提出前に全削除**。
- **サポートURL・プライバシーポリシーURLが実在し機能するか確認**（習慣化アプリでもプライバシーポリシーは事実上必須）。
- 初回起動時に通知許可ダイアログでブロックされて先に進めない等の「機能不全」に注意（通知拒否でもコア機能が動くこと）。

出典:
- https://www.revenuecat.com/blog/growth/the-ultimate-guide-to-app-store-rejections/
- https://nextnative.dev/blog/app-store-review-guidelines
- https://developer.apple.com/forums/thread/116044
- https://developer.apple.com/forums/thread/116236

---

## 3. Guideline 5.1.1 — Privacy（データ収集の説明 / Privacy Manifest / ATT）

### 3-a. Privacy Manifest（2024年5月1日〜必須）
- **2024年5月1日以降、新規アプリ・アップデートともに`PrivacyInfo.xcprivacy`が必須**。Required Reason APIを使う第三者SDKを含む場合、宣言がないと機械的にリジェクト。
- 典型エラー: **ITMS-91053: Missing API declaration**。`UserDefaults`、ファイルタイムスタンプ、ディスク空き容量、システム稼働時間（`systemUptime`）などの「Required Reason API」を使うと該当する。習慣化アプリは`UserDefaults`をほぼ確実に使うため対象になりやすい。

  回避策:
  - アプリ本体とすべての第三者SDK（解析・課金・クラッシュ系: RevenueCat, Firebase, Adjust等）に`PrivacyInfo.xcprivacy`を用意し、使用APIごとに「reason」コードを記載。
  - Xcodeの「App Privacy Report」やビルド警告でRequired Reason APIを洗い出す。
  - SDKが署名付き（signed）で自前のmanifestを同梱しているか確認。古いSDKは更新する。

  出典:
  - https://developer.apple.com/news/?id=pvszzano
  - https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest
  - https://www.avanderlee.com/xcode/missing-api-declaration-required-reason-itms-91053/
  - https://bitrise.io/blog/post/enforcement-of-apple-privacy-manifest-starting-from-may-1-2024

### 3-b. Privacy Nutrition Label（App Privacy）
- App Store Connectの「App Privacy」で収集データ種別と用途を正確に申告。実装と申告の不一致はリジェクト・後日削除の対象。
- **回避策**: ローカル完結（ヘルスデータや習慣ログを端末内のみ保持）なら「Data Not Collected」を正直に申告できる。実装をローカル完結に寄せるほど審査も信頼も楽になる。解析SDKを入れた瞬間に申告義務が発生する点に注意。

### 3-c. ATT（App Tracking Transparency）
- 広告・解析でユーザーを**クロスapp/サイトでトラッキングする場合、ATTプロンプト（`requestTrackingAuthorization`）が必須**。出さずにトラッキングすると審査で即リジェクトor後日削除。
- 「Ask App Not to Track」を選んだユーザーをトラッキングするのも違反。
- **回避策**: Overdue.のような習慣化アプリは本来クロスappトラッキング不要。**広告SDK・IDFA取得をそもそも入れない**のが最も安全。入れるならATTプロンプトを実装し、Privacy Labelの「Tracking」欄と整合させる。トラッキングしないなら「Tracking」に何も申告しない（過剰申告も避ける）。

出典:
- https://shopapper.com/fix-apple-att-rejection-guideline-5-1-2-explained/
- https://developer.apple.com/forums/thread/704985
- https://developer.apple.com/forums/thread/701508

---

## 4. 通知（プッシュ／ローカル通知）の権限・利用

### なぜ起きるか
- **通知をアプリの動作に必須にしてはいけない**。通知拒否でコア機能が使えなくなる設計はリジェクト対象。
- 広告・プロモ・直接マーケ目的の通知は、**ユーザーが明示的にオプトインしていない限り送れない**（オプトインUIとオプトアウト手段の両方が必要）。Appleは規約改定でマーケ通知を許可したが、明示同意が条件。
- ローカル通知とプッシュ通知は審査上ほぼ同列に扱われる（リマインダーはローカル通知中心のはず）。

### 具体的な回避策
- **通知許可を拒否してもアプリのコア機能（習慣の記録・閲覧）が動くようにする**。リマインダーは付加機能の位置づけに。
- リマインダー通知（=ユーザー自身が設定した習慣のリマインド）は問題なし。**マーケ／再エンゲージ目的の通知を送るなら、設定画面で明示オプトイン＋オプトアウトを用意**。
- 通知許可ダイアログを起動直後に強制せず、リマインダー設定など文脈のある場面で出す（拒否率低下＆審査リスク低減）。

出典:
- https://www.appstorereviewguidelineshistory.com/articles/2020-03-04-push-notifications-marketing-and-more/
- https://www.airship.com/blog/apple-push-notification-guidelines-update/
- https://developer.apple.com/forums/thread/699455

---

## 5. Guideline 3.1.1 — In-App Purchase / サブスク（課金がある場合）

### なぜ起きるか
- **Restore Purchasesボタンが無い／実装が形だけで動かない**のが最頻出。「以前の購入を復元する方法が見つからない」とリジェクトされる。
- 外部決済への誘導（"other payment mechanisms"）は不可。
- サブスクの場合、**Apple必須の開示情報（価格・期間・自動更新条件、利用規約/EULAとプライバシーポリシーへのリンク）がペイウォールに不足**すると3.1.2でリジェクト。

### 具体的な回避策
- **「Restore Purchases」ボタンを設定画面とペイウォールの両方に配置**し、StoreKitを呼んでApple ID紐付けの有効トランザクションからエンタイトルメントを再付与する実装を、`購入→アンインストール→復元→解放`の実機フローでテスト。
- ペイウォールに**サブスク名・長さ・価格・自動更新の旨**を明記し、**利用規約（EULA）とプライバシーポリシーへのリンク**を置く。
- すべての課金はIn-App Purchase経由。アプリ内から外部決済サイトへ誘導しない。
- RevenueCat等を使う場合は、そのSDKのPrivacy Manifest同梱も忘れない（第3章と連動）。

出典:
- https://iossubmissionguide.com/guideline-3-1-in-app-purchase/
- https://rorklab.net/en/articles/rork-dev/rork-iap-restore-purchases-not-working-fix
- https://blog.wenhaofree.com/en/posts/articles/app-store-guideline-3-1-2-subscription-fix/
- https://community.revenuecat.com/general-questions-7/app-store-review-rejected-due-to-other-payment-mechanisms-3406

---

## 6. Guideline 2.3 — Accurate Metadata（スクショ・説明文）

### なぜ起きるか
- **スクショが2.3リジェクトの最大要因**。実機キャプチャでなくデザインツールで作ったモック、アプリに無いUI/機能を見せる、"Coming soon"でコア機能を約束する、などが該当。
- 説明文の誇大表現・無関係キーワードの詰め込み（2.3.7）、アプリ名と実態の不一致も対象。

### 具体的な回避策
- **スクショは必ず実機（または正確なシミュレータ）から実際の画面をキャプチャ**。マーケ用の装飾フレームは可だが、表示中のUI・機能は実装済みのものに限る。
- 未実装機能・"近日対応"をスクショや説明で約束しない。
- 説明文はアプリの実機能を正確に。キーワードスタッフィングを避ける。
- アプリ名「Overdue.」と説明・機能の整合を取る（習慣化／リマインダーであることが伝わる説明に）。

出典:
- https://iossubmissionguide.com/guideline-2-3-accurate-metadata/
- https://buddyboss.com/docs/app-store-guideline-2-3-3-performance-accurate-metadata/
- https://shopapper.com/fix-app-store-metadata-rejection-guideline-5-2-1-2-3-7/

---

## 提出前チェックリスト（Overdue.向け）

- [ ] 独自コンセプト（やり残し可視化等）を機能・名称・スクショで明示 → 4.3対策
- [ ] テンプレ／他アプリ共有のソース・アセットを使っていない → 4.3対策
- [ ] 実機TestFlightでクラッシュ・主要フローを検証 → 2.1
- [ ] プレースホルダ・"Coming soon"を全削除、サポート/プライバシーURL生存確認 → 2.1 / 2.3
- [ ] 本体＋全SDKに`PrivacyInfo.xcprivacy`、Required Reason API宣言（ITMS-91053回避） → 5.1.1
- [ ] App Privacy（Nutrition Label）を実装と一致させて申告。ローカル完結なら正直に申告 → 5.1.1
- [ ] 広告/トラッキングSDKを入れないか、入れるならATTプロンプト実装＋Label整合 → 5.1.1
- [ ] 通知拒否でもコア機能が動く。マーケ通知はオプトイン/アウトを用意 → 4.5 / 通知
- [ ]（課金ありなら）Restore Purchasesを設定+ペイウォールに配置し実機テスト、規約/プライバシーリンク → 3.1.1 / 3.1.2
- [ ] スクショは実機キャプチャ・未実装機能を見せない → 2.3

## 出典一覧（主要）
- Apple Developer News（Privacy必須化）: https://developer.apple.com/news/?id=pvszzano
- Apple TN3183（Required Reason API）: https://developer.apple.com/documentation/technotes/tn3183-adding-required-reason-api-entries-to-your-privacy-manifest
- RevenueCat ultimate guide to rejections: https://www.revenuecat.com/blog/growth/the-ultimate-guide-to-app-store-rejections/
- NextNative 2025 guidelines checklist: https://nextnative.dev/blog/app-store-review-guidelines
- 4.3突破事例（Forums）: https://developer.apple.com/forums/thread/757374
- ITMS-91053解説（avanderlee）: https://www.avanderlee.com/xcode/missing-api-declaration-required-reason-itms-91053/
- 2.3 Accurate Metadata: https://iossubmissionguide.com/guideline-2-3-accurate-metadata/
- 3.1.1 Restore: https://iossubmissionguide.com/guideline-3-1-in-app-purchase/
