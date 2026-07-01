const { test } = require('node:test');
const assert = require('node:assert');
const { extractCommits, extractPrs, extractBareRefs, verifyClaims } = require('../lib/claim-verifier');

const SHA = 'f259df121b8e4c0a9d3f5a6b7c8d9e0f1a2b3c4d'; // 40桁hex
const SETTINGS = { repositories: [{ owner: 'me', repo: 'foo', name: 'foo' }, { owner: 'me', repo: 'bar', name: 'bar' }] };

// gh のモック。map: endpoint -> 'found' | 'h404' | 'sha422' | 'auth'。未指定は404(missing)。
function mockRunner(map) {
  return (args) => {
    const endpoint = args[1];
    const resp = map[endpoint];
    if (resp === 'found') return '';
    if (resp === 'sha422') throw new Error('gh: No commit found for SHA: ' + endpoint);
    if (resp === 'auth') throw new Error('gh: To get started with GitHub CLI, please run: gh auth login');
    throw new Error('gh: Not Found (HTTP 404)'); // default & 'h404'
  };
}

test('extractCommits: 40桁SHAは無条件、短縮SHAは文脈語が必要', () => {
  assert.deepEqual(extractCommits(`commit ${SHA}`), [SHA]);
  assert.deepEqual(extractCommits('コミット a1b2c3d で対応'), ['a1b2c3d']); // 文脈語あり
  assert.deepEqual(extractCommits('注文番号 1234567 です'), []); // 純数字は除外
  assert.deepEqual(extractCommits('値 a1b2c3d だけ'), []); // 文脈語なし
});

test('extractPrs: github.com の pull/issues URLのみ', () => {
  const prs = extractPrs('https://github.com/me/foo/pull/5 と https://github.com/me/bar/issues/9');
  assert.equal(prs.length, 2);
  assert.deepEqual(prs[0], { owner: 'me', repo: 'foo', kind: 'pull', number: '5' });
});

test('extractBareRefs: 文脈語が近傍にある #N のみ', () => {
  assert.deepEqual(extractBareRefs('PR #42 をマージ'), ['42']);
  assert.deepEqual(extractBareRefs('単価は #42 円'), []); // 文脈語なし
});

test('verifyClaims: 実在コミット → found / verdict ok', () => {
  const runner = mockRunner({ [`repos/me/foo/commits/${SHA}`]: 'found' });
  const r = verifyClaims(`commit ${SHA}`, { settings: SETTINGS, runner });
  assert.equal(r.verdict, 'ok');
  assert.equal(r.claims[0].status, 'found');
  assert.equal(r.claims[0].repo, 'me/foo');
});

test('verifyClaims: 全候補で404 → missing / verdict fabricated', () => {
  const r = verifyClaims(`commit ${SHA}`, { settings: SETTINGS, runner: mockRunner({}) });
  assert.equal(r.verdict, 'fabricated');
  assert.equal(r.claims[0].status, 'missing');
});

test('verifyClaims: 422 No commit found も missing 扱い', () => {
  const runner = mockRunner({ [`repos/me/foo/commits/${SHA}`]: 'sha422', [`repos/me/bar/commits/${SHA}`]: 'sha422' });
  const r = verifyClaims(`commit ${SHA}`, { settings: SETTINGS, runner });
  assert.equal(r.verdict, 'fabricated');
});

test('verifyClaims: gh認証エラー(到達不能) → unverified / 無罪', () => {
  const runner = mockRunner({ [`repos/me/foo/commits/${SHA}`]: 'auth', [`repos/me/bar/commits/${SHA}`]: 'auth' });
  const r = verifyClaims(`commit ${SHA}`, { settings: SETTINGS, runner });
  assert.equal(r.verdict, 'ok');
  assert.equal(r.claims[0].status, 'unverified');
});

test('verifyClaims: 裸#N で project曖昧 → unverified(スキップ), repo=null', () => {
  const r = verifyClaims('PR #42 をマージ', { settings: SETTINGS, runner: mockRunner({}) });
  const ref = r.claims.find((c) => c.type === 'ref');
  assert.equal(ref.status, 'unverified');
  assert.equal(ref.repo, null);
  assert.equal(r.verdict, 'ok'); // スキップは無罪
});

test('verifyClaims: 裸#N で project特定可 → 当該repoで照合', () => {
  const runner = mockRunner({ 'repos/me/foo/issues/42': 'found' });
  const r = verifyClaims('PR #42 をマージ', { settings: SETTINGS, project: 'foo', runner });
  const ref = r.claims.find((c) => c.type === 'ref');
  assert.equal(ref.status, 'found');
  assert.equal(ref.repo, 'me/foo');
});

test('verifyClaims: PR URLが404 → fabricated', () => {
  const r = verifyClaims('https://github.com/me/foo/pull/5', { settings: SETTINGS, runner: mockRunner({}) });
  assert.equal(r.verdict, 'fabricated');
  assert.equal(r.claims[0].type, 'pr');
});
