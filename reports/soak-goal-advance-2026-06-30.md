# 自走ループ soak テスト 2026-06-30

要点:
- 連続dryRun 20回: クラッシュ無し、最大応答 8ms、巡回プロジェクト 3種
- コスト上限ガード: reason=`monthly_budget`(期待 daily_budget|monthly_budget) → ✅発火 / 設定復元 ✅
- 実走1回: スキップ(jenny_offline)

## 連続dryRun 巡回内訳
- Overdue.: 7回
- WAVERS: 7回
- あげファンズ: 6回

## currentState捏造検出（dryRun中）
- 検出なし

## エラー
- なし

---
生成: 2026-06-30T02:59:22.761Z / base=http://127.0.0.1:3939
