# Overdue. 専用プレイブック

## 担当
- 主担当：ベンジ（`agent-1773292538229`）
- 補佐：トム（将来追加）／シバ太（ブロッカー時）

## ゴール
App Store / Google Play 双方で公開申請を通すこと。ブロッカーは「スクリーンショット素材」と「プライバシーポリシー」。

## 参照リポジトリ
- `yutasuzuki1997/Overdue`（本体）
- `yutasuzuki1997/overdue-privacy-policy`（Pages でホスト中）

## App Store申請 必須素材チェックリスト

| 項目 | 要件 | 状態 |
|------|------|------|
| 6.5インチ iPhone スクリーンショット | 1284×2778、最低3枚 | 要確認 |
| 5.5インチ iPhone スクリーンショット | 1242×2208、最低3枚 | 要確認 |
| 12.9インチ iPad スクリーンショット | 2048×2732（iPad対応のみ） | 条件付き |
| App Preview 動画 | 任意 | 後回しでOK |
| アイコン | 1024×1024 PNG, alpha なし | 要確認 |
| アプリ説明文（JP/EN） | 4000字以内 | 要確認 |
| キーワード | 100字以内（カンマ区切り） | 要確認 |
| プライバシーポリシーURL | https://yutasuzuki1997.github.io/overdue-privacy-policy/ | OK |
| サポートURL | 必須 | 要確認 |
| カテゴリ | Primary: Productivity 推奨 | 確認 |
| 年齢レーティング | 4+（ログイン/課金なしの場合） | 確認 |

## 週次チェック手順（毎週火曜 routine-005 で自動発火）

1. App Store Connect にログインして「最新申請状態」を確認（Yuta に口頭で確認を依頼）
2. `yutasuzuki1997/Overdue` の main に新規 commit があれば PR を立てて確認する
3. 未完成のスクショ素材を `reports/overdue-screenshots-{YYYY-MM-DD}.md` に TODO 化
4. Yuta に 3 行で報告：
   - 現在のステータス（Waiting for Review / In Review / Rejected / 未提出）
   - 残ブロッカー
   - 次の推奨アクション（Yuta がやるのか誰かに振るのか）

## リジェクト時の定型対応

1. リジェクト理由文（Apple からのメッセージ）を `reports/overdue-rejection-{YYYY-MM-DD}.md` に保存
2. 技術修正なら自分で PR。文言・素材修正なら Yuta へ依頼事項を整理して返す
3. Resolution Center 返信テンプレ：
   ```
   Thank you for the review. We've addressed the issue as follows:
   - {具体的な修正内容}
   Please re-review at your convenience.
   ```

## 絶対禁止
- App Store Connect の Yuta の認証情報を要求しない（ブラウザ操作は Yuta に依頼する）
- 未保存の修正を main に直 push する（必ず PR 経由）
