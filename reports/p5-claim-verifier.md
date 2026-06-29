# P5: 主張検証(Claim Verifier) — 実装＆検証レポート

2026-06-29 / 関連: QAゲート(`lib/qa-gate.js`) / 自走ループ(`runGoalDrivenAdvance`)

## 目的
完了報告・currentStateに書かれた「コミットハッシュ/PR参照」をGitHub上で実在検証し、
実在しないコミット/PRの捏造をQAゲートで差し戻す。誤検知は最小化(検証不能=無罪)。

## 実装
- 新規 `lib/claim-verifier.js`
  - 抽出: 40桁フルSHAは無条件、7〜12桁短縮SHAは[a-f]含み＋commit文脈語が近傍にある時のみ(純数字ID誤検出を回避)。PRは `github.com/owner/repo/(pull|issues)/N` URL形式のみ。
  - 検証: `gh api repos/OWNER/REPO/commits/SHA`。`app-settings.json.repositories` を候補にしproject名一致を優先。
  - 判定: found=実在 / missing=全候補で不在確定 / unverified=候補なし・gh未認証・到達不可。**missingのみ捏造**扱い。
- `server.js handleAgentCompletion` のQAブロックに統合。捏造検出時はQAをsuspect化→既存の1回差し戻し経路に合流。`task.qa.claims`に記録、再指示に「実在する事実のみ・ハッシュ/PR創作禁止」の注記を追加。
- 自走プロンプト(server.js)に同趣旨の事前制約を追記。
- 無効化: `app-settings.json` `claimVerify=false`(既定ON)。

## 検証結果
- ユニット(モックrunner) 10/10 pass: 抽出規則・found/missing/unverified分岐・誤検知ゼロ(network error→unverified)。
- 実gh E2E:
  - 実在ハッシュ `f259df1` → **found**(no false positive)。
  - 捏造ハッシュ `deadbee1f23` → **fabricated**(差し戻し対象)。
- バグ修正: 存在しないSHAはcommits APIが**404でなく422 "No commit found for SHA"**を返す。これを不在シグナルに追加(`NOT_FOUND_RE`)。これが無いと真の捏造を見逃していた。

## バックログ前提の訂正
バックログ記載「agent-pm-overdue が実在しないf259df1を記載」は**誤り**。f259df1は
Overdueリポジトリの実在コミット(`f259df121b8...`「feat(metadata): 4.3対策…」2026-06-19)。
ローカルops repoに無かっただけ。→ ローカルのみ照合する素朴な実装なら誤差し戻ししていた。
本実装は複数リポジトリ横断＋GitHub実在照合で、この誤検知を回避している。

## 残課題
- 裸の `#123` はリポジトリ曖昧のため未対応(URL形式PRのみ)。
- currentState(goals.json)の事後スキャンは未実装。現状は完了報告summary経由で検出。
