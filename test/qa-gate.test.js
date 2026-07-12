const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runQaGate, runQaGateAsync, extractUrls, extractArtifacts } = require('../lib/qa-gate');

// テスト用の擬似fetch: URL→{status, body} のマップを返す
function fakeFetch(map) {
  return async (url) => {
    const e = map[url];
    if (!e) throw new Error('ネットワーク到達不可');
    if (e.abort) { const err = new Error('aborted'); err.name = 'AbortError'; throw err; }
    return { status: e.status, headers: { get: () => e.contentType || 'text/html' }, text: async () => e.body || '' };
  };
}

function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-gate-'));
  fs.mkdirSync(path.join(d, 'reports'), { recursive: true });
  return d;
}
const FILLER = 'x'.repeat(300); // MIN_BYTES(200)超え

test('extractArtifacts: ###ARTIFACT###を最優先抽出', () => {
  assert.deepEqual(extractArtifacts('完了 ###ARTIFACT path="reports/a.md"###'), ['reports/a.md']);
});

test('pass: 実在する成果物ファイル(中身あり)', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'reports/a.md'), FILLER);
  const r = runQaGate('完了 ###ARTIFACT path="reports/a.md"###', { baseDir: d });
  assert.equal(r.verdict, 'pass');
});

test('pass: 外部URLの提示', () => {
  const d = tmp();
  const r = runQaGate('完了しました https://notion.so/abc123', { baseDir: d });
  assert.equal(r.verdict, 'pass');
});

test('pass: 明示なしでもタスク中生成のreports/成果物を検出(フォールバック)', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'reports/auto.md'), FILLER); // 直近mtime
  const r = runQaGate('作業が一段落しました', { baseDir: d, nowMs: Date.now() });
  assert.equal(r.verdict, 'pass');
  assert.ok(r.artifacts.some((a) => a.path === 'reports/auto.md'));
});

test('suspect: 成果物もURLも無い', () => {
  const d = tmp();
  const r = runQaGate('対応します。これから進めます。', { baseDir: d });
  assert.equal(r.verdict, 'suspect');
});

test('suspect: 宣言したファイルが不在', () => {
  const d = tmp();
  const r = runQaGate('完了 ###ARTIFACT path="reports/missing.md"###', { baseDir: d });
  assert.equal(r.verdict, 'suspect');
});

// ---- runQaGateAsync: 外部URL中身検証 ----

test('extractUrls: http(s)を重複排除・末尾句読点除去', () => {
  const urls = extractUrls('完了: https://a.example/x 。 参考 https://a.example/x と http://b.example/y)');
  assert.deepEqual(urls, ['https://a.example/x', 'http://b.example/y']);
});

test('async suspect: 外部URLが唯一の根拠で404', async () => {
  const d = tmp();
  const url = 'https://github.com/foo/overdue';
  const r = await runQaGateAsync(`完了しました ${url}`, {
    baseDir: d, fetchImpl: fakeFetch({ [url]: { status: 404 } }),
  });
  assert.equal(r.verdict, 'suspect');
  assert.ok(r.reasons.some((x) => x.includes('リンク切れ')));
});

test('async suspect: 本文が404文言(Notion風)で破損', async () => {
  const d = tmp();
  const url = 'https://x.notion.site/dead';
  const r = await runQaGateAsync(`まとめました ${url}`, {
    baseDir: d, fetchImpl: fakeFetch({ [url]: { status: 200, body: 'This page could not be found' } }),
  });
  assert.equal(r.verdict, 'suspect');
});

test('async suspect: 連絡先メールがドメイン欠落で途切れ', async () => {
  const d = tmp();
  const url = 'https://user.github.io/privacy/';
  const body = '<h1>Privacy</h1><p>連絡先: y.suzuki97stitt0531@</p>';
  const r = await runQaGateAsync(`ポリシー公開 ${url}`, {
    baseDir: d, fetchImpl: fakeFetch({ [url]: { status: 200, body } }),
  });
  assert.equal(r.verdict, 'suspect');
});

test('async pass: 生きたURL(2xxで正常本文)は維持', async () => {
  const d = tmp();
  const url = 'https://user.github.io/privacy/';
  const body = '<h1>Privacy Policy</h1><p>連絡先: hello@example.com までご連絡ください。full content here.</p>';
  const r = await runQaGateAsync(`公開しました ${url}`, {
    baseDir: d, fetchImpl: fakeFetch({ [url]: { status: 200, body } }),
  });
  assert.equal(r.verdict, 'pass');
  assert.ok(r.reasons[0].includes('ok=1'));
});

test('async 無罪: 到達不能/タイムアウト/認証要はpass維持', async () => {
  const d = tmp();
  const timeout = 'https://slow.example/x';
  const auth = 'https://notion.so/private';
  const r1 = await runQaGateAsync(`完了 ${timeout}`, { baseDir: d, fetchImpl: fakeFetch({ [timeout]: { abort: true } }) });
  assert.equal(r1.verdict, 'pass');
  const r2 = await runQaGateAsync(`完了 ${auth}`, { baseDir: d, fetchImpl: fakeFetch({ [auth]: { status: 403 } }) });
  assert.equal(r2.verdict, 'pass');
  const r3 = await runQaGateAsync('完了 https://unreachable.example/z', { baseDir: d, fetchImpl: fakeFetch({}) });
  assert.equal(r3.verdict, 'pass');
});

test('async: ローカル成果物があればURL検証はスキップ(passBasis=file)', async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'reports/a.md'), FILLER);
  const dead = 'https://dead.example/404';
  let fetched = false;
  const r = await runQaGateAsync(`完了 ###ARTIFACT path="reports/a.md"### 参考 ${dead}`, {
    baseDir: d, fetchImpl: async () => { fetched = true; return { status: 404, headers: { get: () => '' }, text: async () => '' }; },
  });
  assert.equal(r.verdict, 'pass');
  assert.equal(fetched, false); // URLはfetchされない
});

test('async: verifyUrls=falseでURL検証を無効化', async () => {
  const d = tmp();
  const url = 'https://dead.example/404';
  const r = await runQaGateAsync(`完了 ${url}`, {
    baseDir: d, verifyUrls: false, fetchImpl: fakeFetch({ [url]: { status: 404 } }),
  });
  assert.equal(r.verdict, 'pass');
});
