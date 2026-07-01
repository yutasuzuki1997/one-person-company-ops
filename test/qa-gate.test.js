const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runQaGate, extractArtifacts } = require('../lib/qa-gate');

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
