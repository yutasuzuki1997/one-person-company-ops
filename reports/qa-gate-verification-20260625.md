# QAゲート検証レポート（再実行・実出力ベース）

- 日付: 2026-06-25
- 担当: ベンジ（エンジニア / agent-sp-eng）
- 経緯: 先のQAゲート検証の完了報告が品質ゲートを通過せず差し戻し（理由: 成果物パス/URL無し・未来形のみ）。本レポートは**実際にロジックを実行した過去形の事実ベース**で再作成したもの。
- 検証対象: `lib/qa-gate.js`（新規追加）+ `server.js` 結線
- 環境: Node v25.6.1 / リポジトリ `/Users/ysuzuki_workpc/one-person-company-ops`

## 1. 検証対象が「何を・どう判定するか」（実コード読解）

`lib/qa-gate.js` は、エージェントの自己申告の完了報告テキストを受け取り、成果物の実体をプログラム検証する品質ゲート。LLMコスト0の純ロジック。狙いは「実作業せずCOMPLETED」「テストせず完了報告」の素通り防止。

公開API（`module.exports`）:
- `extractArtifacts(summary)`：報告テキストから成果物パスを抽出。`###ARTIFACT path="..."###` 記法を最優先、無ければ拡張子ベース（md/json/csv/txt/png/jpg/pdf/html/js/ts/tsx/css）でフォールバック抽出。
- `verifyArtifacts(paths, baseDir, sinceMs)`：抽出パスを `baseDir` 基準で `fs.statSync` 検証し `{exists, bytes, fresh, mtimeMs}` を返す。
- `runQaGate(summary, opts)`：ゲート本体。`verdict: 'pass' | 'suspect'` を返す。
- `MIN_BYTES`：中身の薄さ判定しきい値。**実測で 200**（テスト出力 `MIN_BYTES = 200`）。

判定フロー（`runQaGate`、qa-gate.js L57-89）:
1. 抽出パスを実ファイル検証。`exists && bytes >= 200` の実ファイルがあれば **pass**。
2. 実ファイルが無くても本文に `http(s)://` URL があれば **pass**（v1ではURL先の中身は未検証）。
3. いずれも無ければ **suspect**（差し戻し対象）。未来形マーカー（します/いたします/予定です/これから/着手します/進めます/will/going to）があれば理由を追記。
4. freshness（タスク開始以降に更新されたか）は pass 条件から外した **soft note** 扱い。古い既存レポート流用も pass し、reason に「今回更新されていない(既存流用の可能性)」が付くのみ。

server.js 側結線（実確認した行番号）:
- L20: `const { runQaGate } = require('./lib/qa-gate');`
- L84: `DATA_DIR`（`AI_AGENTS_DATA_DIR` 未設定時は `__dirname` = リポジトリルート）→ `reports/...` 相対パスが正しく解決される。
- L2991: 手動エンドポイントで `runQaGate(summary, { baseDir: DATA_DIR, sinceMs: 0 })` を実行し `reworkFired` を返す。
- L3878-3932 `handleAgentCompletion`: 成功報告のみ `runQaGate(summary, { baseDir: DATA_DIR, sinceMs })` を実行。`suspect` かつ `task.qaRetried` 未設定かつ `qaReworkStreak < QA_REWORK_MAX(=2)` なら **1回だけ自動差し戻し**（status=error, qaRetried=true）し、ジェニーへ再作業を自動注入して通常完了処理をスキップ（L3911 `return`）。上限到達時は自動注入を止めてYutaに通知（L3913-3921）。pass時は `qaReworkStreak=0` にリセットしQA結果を task に記録。

## 2. 実行した検証（実コマンド・実出力）

テストハーネス `/tmp/qa-gate-test.js` を作成し、`lib/qa-gate.js` を直接 require して 9 ケースを実行した。一時ディレクトリに実在ファイル（500B / 5B）を生成して実ファイル判定も実データで確認した。

実行コマンド:
```
node /tmp/qa-gate-test.js
```

実出力（抜粋・実測値）:
```
MIN_BYTES = 200

--- T1 未来形のみ・成果物/URLなし
verdict = suspect
reasons = ["完了報告に成果物パスもURLも含まれていない","「〜します」等の未来形のみで実成果物がない"]

--- T2 空文字
verdict = suspect
reasons = ["完了報告に成果物パスもURLも含まれていない"]

--- T3 外部URL提示
verdict = pass
reasons = ["外部URLを成果物として提示(中身は未検証)"]

--- T4 ARTIFACT記法・実在500B
verdict = pass
artifacts = [{"path":"reports/real.md","exists":true,"bytes":500,"fresh":true,...}]

--- T5 ARTIFACT不在パス
verdict = suspect
reasons = ["成果物が確認できない: reports/missing.md(不在)"]

--- T6 実在だが薄い5B
verdict = suspect
reasons = ["成果物が確認できない: reports/tiny.md(5B/中身が薄い)"]

--- T7 extractArtifacts 優先順位
result = ["reports/b.md"]              （裸の other.md を無視しARTIFACT記法のみ抽出）

--- T8 freshでない(既存流用) pass+note
verdict = pass
reasons = ["成果物 reports/real.md は今回更新されていない(既存流用の可能性)"]

--- T9 フォールバック抽出 URL混入確認
result = ["data/out.csv","x.com/y.md","notes.txt"]
```

## 3. 結果一覧（期待 vs 実測）

| # | ケース | 期待 | 実測 verdict/result | 判定 |
|---|--------|------|------|------|
| T1 | 未来形のみ・成果物/URL無し | suspect（未来形理由付き） | suspect（未来形理由付き） | PASS |
| T2 | 空文字 | suspect | suspect | PASS |
| T3 | 外部URL提示 | pass | pass | PASS |
| T4 | ARTIFACT記法・実在500B | pass | pass（artifact 500B） | PASS |
| T5 | ARTIFACT不在パス | suspect | suspect（不在） | PASS |
| T6 | 実在だが5B（薄い） | suspect | suspect（5B/中身が薄い） | PASS |
| T7 | ARTIFACT記法を裸パスより優先 | `["reports/b.md"]` のみ | `["reports/b.md"]` | PASS |
| T8 | 既存流用（freshでない） | pass + soft note | pass + 「今回更新されていない」note | PASS |
| T9 | フォールバックでURL混入の有無 | URL除外が理想 | `x.com/y.md` を誤抽出 | 既知バグ（下記） |

機能テスト 8/8 が期待どおり。差し戻し理由だった「成果物パスもURLも無い未来形報告」が **実行上 suspect になる**ことを T1/T2 で実証した。

## 4. 発見事項

### [中] フォールバック抽出が http URL のパス部分を誤抽出（T9で実証）
- 該当: `extractArtifacts` フォールバック正規表現（qa-gate.js L27-32）。
- 実測: 入力 `"see data/out.csv and http://x.com/y.md and notes.txt"` の抽出結果が `["data/out.csv","x.com/y.md","notes.txt"]`。本来除外すべき `x.com/y.md` が混入。
- 原因: 正規表現が `[A-Za-z0-9_]` 始まりのため `http://` の `//` 直後 `x.com/y.md` からマッチが始まり、L30 の `p.startsWith('http')` 除外をすり抜ける。
- 実害（限定的）: 誤抽出パスは実ファイルとして不在 → exists=false。かつ `runQaGate` は本文にURLがあれば先に pass するため、**verdict が誤判定に転ぶ実害は現状ほぼ無い**。ただし `task.qa.artifacts` に偽パスが記録されログ/UI表示が誤誘導され得る。
- 修正案: フォールバック適用前にURLを除去、または `(?<![:/\w])` の負の後読みで `//` 直後の開始を抑止。
- 本レポートでは qa-gate.js 本体は未修正（差し戻し対応＝検証成果物の作成が今回の依頼範囲のため）。修正可否はYutaの判断を仰ぐ。

### [情報] freshness は意図的に pass 条件から除外（仕様どおり・T8で実証）
古い既存レポート流用でも pass（reason に note のみ）。コメント記載の設計意図どおりでバグではない。

## 5. 結論
QAゲートのコア責務（未来形のみ/成果物なしを suspect、実在200B超を pass、ARTIFACT記法優先、薄いファイルを suspect、freshness soft note、server.js での1回限り自動差し戻し結線）は**実行で確認した範囲ですべて期待どおり**動作した。フォールバック抽出のURL誤抽出1件（中・実害限定）を要修正候補として記録した。

## 6. 制約・未検証
- server.js の `handleAgentCompletion` 全体（差し戻しのジェニー注入・broadcast・tasks.json永続化）はサーバー起動とエージェント実行を伴うため、本検証では**静的読解**にとどめた。`runQaGate` 単体の入出力はすべて実行で確認済み。
- ジェニーへの `sendToJenny` 自動注入は `agentTeamsManager.isJennyOnline()` 真のとき発火する条件分岐であり、起動環境が必要なため未実行。
