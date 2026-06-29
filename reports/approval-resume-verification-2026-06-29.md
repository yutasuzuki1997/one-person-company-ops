# 承認→再開フロー 実走検証レポート

- 検証日: 2026-06-29
- 対象: OneCompanyOps 外部操作の承認ゲートと再開注入(`###APPROVAL###` → `/api/action/confirm` → `sendToJenny`)
- 関連: 自走ループ検証レポート(L61)で次候補に挙げていた「承認→再開フロー」
- 結論: **サーバー側の配管(キュー/永続化/復元/消費/再開注入)は端から端まで動作を確認。** ただし2件のギャップを発見(1件は修正済、2件は別タスクへ記録)。

---

## 1. 修正したバグ

### (a) オフライン承認のサイレント消失 ✅修正
`/api/action/confirm` が `pendingActions.delete`/`removeApprovalMirror` を**オンライン判定の前**に実行していた。
→ ジェニー(秘書セッション)停止中に承認すると、承認は消費されるが再開されず**消える**。
**修正**: APPROVAL分岐ではオンライン確認後にのみ消費。オフライン時は409で「承認待ちは保持」を返す(server.js)。

### (b) 承認ブロック検出が属性順序に脆弱 ✅修正
検出正規表現が `kind→summary→options` の固定順・全属性必須だった。
**修正**: ブロックを拾ってから各属性を個別抽出(順不同・options省略可・summary必須)。`lib/agent-teams-manager.js`。

## 2. 実走で確認した経路(決定論的に検証)

検証用エンドポイント `POST /api/approval/simulate` を追加し、承認キューを直接積んで配管を確認。

| 経路 | 観測 | 判定 |
|---|---|---|
| 承認キュー投入 | `[approval] 承認待ちに追加: pend-... post ...` + `approvals.json` ミラー | ✅ |
| 承認(approve) | confirm → `→ジェニー: 承認されました: ...。実行して報告して` 注入 / `resumed:true` | ✅ |
| 却下(reject) | confirm → `→ジェニー: 却下されました: ...。代替案を提示して` 注入 / `resumed:true` | ✅ |
| 二重承認 | 同一pendingIdの再confirm → `404 already processed`(冪等消費) | ✅ |
| 再起動復元 | サーバー再起動 → `[approval] 1件の承認待ちを復元`(approvals.jsonから復元) | ✅ |
| ミラー整合 | 承認/却下済みは approvals.json から除去、未処理のみ残存 | ✅ |

## 3. 発見したギャップ(別タスクへ記録・未修正)

### (G1) lightタスクは承認ゲートを迂回する
`/api/secretary/message` に「Xに投稿して」を送ると **weight=light** 判定となり、native ジェニー(承認ブロックを出す経路)ではなく**旧 `lib/agent-executor.js`(API直叩き)に流れた**。
承認ゲートは native ジェニー経路にしか無いため、**lightに分類された外部操作は人間承認を経ずに実行されうる**。
→ 影響大。task-classifier が外部操作(投稿/送信/課金/デプロイ等)を検知したら weight に関係なく native 経路へ寄せる、もしくは agent-executor 側にも承認ゲートを設ける必要。

### (G2) isJennyOnline() は spawn直後からtrueを返す
`jennyProcess !== null && !killed` 判定のため、claude 本体がまだ起動中(stdin応答前)でも online 扱い。
→ (a)の409は「マネージャ未起動/クラッシュ時」にのみ発火。ブート中はstdinにバッファされるので実害は小さいが、「online=実際に応答可能」ではない点は要注意。

## 4. 未検証(任意・課金)
ジェニーLLMの**ウォーム再開**(実タスク中に自分で `###APPROVAL###` を出し、承認後にその操作を実行し切る)エンドツーエンド。
本検証は配管を決定論的に確認したが、コールド注入(事前文脈なし)のためLLMの継続実行までは追っていない。
ウォーム検証には G1 を解消して native 経路へ確実に乗せる必要がある。

## 5. 変更ファイル
- `server.js`: confirmのオフライン消費順序修正 + `/api/approval/simulate` 検証API
- `lib/agent-teams-manager.js`: 承認ブロック検出の属性順不同化
- `.gitignore`: `approvals.json` / `core/skills/auto-generated/` を実行時生成物として除外
