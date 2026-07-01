const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordQaMetric, summarizeQaMetrics, summarizeClaims } = require('../lib/qa-metrics');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-metrics-')); }

test('summarizeClaims: status分布と裸#Nスキップを数える', () => {
  const s = summarizeClaims([
    { type: 'commit', status: 'found' },
    { type: 'commit', status: 'missing' },
    { type: 'pr', status: 'unverified', repo: 'me/foo' },
    { type: 'ref', status: 'unverified', repo: null }, // 裸#Nスキップ
  ]);
  assert.deepEqual(s, { found: 1, missing: 1, unverified: 2, bareRefSkipped: 1 });
});

test('record→summarize: verdict と llm_review を集計', () => {
  const d = tmp();
  recordQaMetric(d, { kind: 'verdict', taskId: 't1', verdict: 'pass', claim: summarizeClaims([{ type: 'commit', status: 'found' }]) });
  recordQaMetric(d, { kind: 'verdict', taskId: 't2', verdict: 'suspect', claim: summarizeClaims([{ type: 'ref', status: 'unverified', repo: null }]) });
  recordQaMetric(d, { kind: 'llm_review', taskId: 't1', flagged: true });
  recordQaMetric(d, { kind: 'llm_review', taskId: 't3', flagged: false });
  const a = summarizeQaMetrics(d);
  assert.equal(a.total, 2);
  assert.equal(a.pass, 1);
  assert.equal(a.suspect, 1);
  assert.equal(a.claimsFound, 1);
  assert.equal(a.bareRefSkipped, 1);
  assert.equal(a.llmReviews, 2);
  assert.equal(a.llmFlagged, 1);
});

test('summarizeQaMetrics: ファイル無しでも空集計を返す', () => {
  const a = summarizeQaMetrics(tmp());
  assert.equal(a.total, 0);
});
