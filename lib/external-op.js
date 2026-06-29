// 外部影響のある操作(投稿/送信/課金/デプロイ/マージ/提出など)の検知。
// 目的: これらは承認ゲートのある native ジェニー経路に必ず乗せる(P1)。
// 安全側設計: 偽陽性(ただの下書き作成をジェニーに回す)はコスト増で済むが、
//   偽陰性(外部操作が承認なしで実行)は事故。よって取りこぼしを避けつつ、
//   「下書き作成」系の明白な誤検知だけは動詞接尾で除外する。

// 動詞 + 実行を示す接尾(して/する/します/してください/せよ 等)
const ACTION_VERBS = '投稿|ポスト|ツイート|tweet|送信|送付|送金|振込|振り込|課金|決済|支払|請求|デプロイ|deploy|マージ|merge|提出|申請|公開|リリース|release|配信|出品|予約投稿';
const ACTION_RE = new RegExp(`(?:${ACTION_VERBS})\\s*(?:して|する|します|してください|してね|せよ|しといて|しておいて|済ませ|を実行|を実施)`, 'i');

// 接尾が無くても外部操作が明白な強いフレーズ
const STRONG_RE = /(app\s*store|テストフライト|testflight)[^。]{0,8}(提出|申請|配信|公開|アップロード|審査)|本番(へ|に)?(デプロイ|反映|リリース)|pr(を|の)?(マージ|merge)|(メール|dm|slack|line|chatwork)(を|で)?[^。]{0,6}(送|配信|通知)|(送金|振込|振り込み|決済|課金|支払い?)(を|する|します)?/i;

// 英語の命令形(post/send/deploy/merge/publish/submit ...)
const ENGLISH_RE = /\b(post|tweet|send|email|deploy|merge|publish|submit|release|charge|pay|transfer)\b/i;

function detectExternalOp(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  return ACTION_RE.test(t) || STRONG_RE.test(t) || ENGLISH_RE.test(t);
}

module.exports = { detectExternalOp };
