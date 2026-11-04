// Garde statique sur le SOURCE de l'écran Vendeurs (il ne rend pas le composant).
//   node --test --experimental-strip-types src/lib/vendeursScreen.static.test.ts
// Le rendu réel est validé sur appareil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync('app/vendeurs.tsx', 'utf8').toString();
const api = readFileSync('src/lib/api.ts', 'utf8').toString();
const mgmt = readFileSync('src/lib/verifierMgmt.ts', 'utf8').toString();

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

test('every mutation of the screen forces the network and disables automatic retries', () => {
  const mutations = count(/useMutation\(\{/g, screen);
  assert.equal(mutations, 5);
  assert.equal(count(/\.\.\.MUTATION_OPTIONS,/g, screen), mutations);
  const opts = screen.slice(screen.indexOf('const MUTATION_OPTIONS'), screen.indexOf('as const;', screen.indexOf('const MUTATION_OPTIONS')));
  assert.ok(/networkMode: 'always'/.test(opts));
  assert.ok(/retry: false/.test(opts));
});

test('the 5 sensitive calls go through the hard deadline and pass the signal', () => {
  // 5 mutations + la relecture de réconciliation (elle aussi bornée dans le temps).
  assert.equal(count(/callWithDeadline\(/g, screen), 6);
  assert.ok(/RECONCILE_DEADLINE_MS = 10000/.test(screen));
  assert.ok(/retry: false,\s*networkMode: 'always'/.test(screen));
  for (const m of ['create', 'assign', 'setStatus', 'resetPassword', 'remove']) {
    assert.ok(new RegExp(`api\\.ticketVerifiers\\.${m}\\([\\s\\S]{0,90}?signal`).test(screen), m);
  }
  assert.ok(/MUTATION_DEADLINE_MS = 20000/.test(mgmt));
});

test('the API methods forward the signal to Axios', () => {
  const block = api.slice(api.indexOf('ticketVerifiers: {'), api.indexOf('export type VerifierStatus'));
  assert.equal(count(/\{ signal \}/g, block), 5);
});

test('each action goes through a synchronous lock', () => {
  assert.ok(count(/createActionLock\(\)/g, screen) >= 2);
  assert.ok(/lock\.current\.run\(/.test(screen));
});

test('the screen never logs anything (no password or form data in logs)', () => {
  assert.equal(count(/console\./g, screen), 0);
});
