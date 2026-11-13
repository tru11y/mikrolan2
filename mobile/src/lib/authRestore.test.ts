import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchProfileWithRetry, isTransientError } from './authRestore.ts';

const http = (status: number) => ({ response: { status } });
const noSleep = async () => {};

test('erreurs transitoires : réseau, délai, 408, 429, 5xx', () => {
  assert.equal(isTransientError(new Error('Network Error')), true);
  assert.equal(isTransientError({ code: 'ECONNABORTED' }), true);
  for (const s of [408, 429, 500, 502, 503, 504]) assert.equal(isTransientError(http(s)), true, String(s));
});

test('rejets définitifs : 400, 401, 403, 404', () => {
  for (const s of [400, 401, 403, 404]) assert.equal(isTransientError(http(s)), false, String(s));
});

test('relecture du profil : succès après 2 pannes réseau', async () => {
  let calls = 0;
  const waits: number[] = [];
  const out = await fetchProfileWithRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error('Network Error');
      return 'profil';
    },
    { sleep: async (ms) => void waits.push(ms) },
  );
  assert.equal(out, 'profil');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2500]);
});

test('relecture du profil : un 401 n’est jamais réessayé', async () => {
  let calls = 0;
  await assert.rejects(
    fetchProfileWithRetry(async () => { calls++; throw http(401); }, { sleep: noSleep }),
  );
  assert.equal(calls, 1);
});

test('relecture du profil : pannes persistantes → erreur rendue après les essais prévus', async () => {
  let calls = 0;
  await assert.rejects(fetchProfileWithRetry(async () => { calls++; throw http(503); }, { sleep: noSleep }));
  assert.equal(calls, 3);
});

const root = join(import.meta.dirname, '..', '..');

test('statique : le démarrage de l’app n’efface plus les jetons sur une erreur transitoire', () => {
  const src = readFileSync(join(root, 'src', 'providers', 'auth-provider.tsx'), 'utf8');
  const boot = src.slice(src.indexOf("reportSilent('auth.restore-session'"), src.indexOf("reportSilent('auth.restore-session'") + 400);
  assert.match(boot, /isTransientError\(e\)/);
  assert.equal(/catch \(e\) \{\s*reportSilent\('auth\.restore-session', e\);\s*await clearAuthTokens\(\);/.test(src), false);
});

test('statique : l’intercepteur ne vide pas la session quand le rafraîchissement échoue sur le réseau', () => {
  const src = readFileSync(join(root, 'src', 'lib', 'api.ts'), 'utf8');
  assert.match(src, /refreshed === 'transient'/);
});
