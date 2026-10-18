import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLatestFailure,
  decideVersion,
  deserializePolicy,
  evaluateGate,
  parsePolicy,
  serializePolicy,
  type LatestOutcome,
} from './versionPolicy.ts';

const policy = { versionCode: 40, minVersionCode: 38, versionName: '1.2.0' };

test('decideVersion : sous le minimum → bloqué', () => {
  assert.equal(decideVersion(37, policy), 'blocked');
  assert.equal(decideVersion(1, policy), 'blocked');
});

test('decideVersion : égal au minimum → bannière, pas de blocage (borne)', () => {
  assert.equal(decideVersion(38, policy), 'update');
});

test('decideVersion : entre minimum et dernière → bannière', () => {
  assert.equal(decideVersion(39, policy), 'update');
});

test('decideVersion : égal ou supérieur à la dernière → aucune action', () => {
  assert.equal(decideVersion(40, policy), 'ok');
  assert.equal(decideVersion(41, policy), 'ok');
});

test('decideVersion : release obligatoire (min = latest) → bloque toute version antérieure', () => {
  const required = { versionCode: 40, minVersionCode: 40, versionName: '1.2.0' };
  assert.equal(decideVersion(39, required), 'blocked');
  assert.equal(decideVersion(40, required), 'ok');
});

test('decideVersion : version installée illisible ou politique absente → jamais de blocage', () => {
  assert.equal(decideVersion(null, policy), 'ok');
  assert.equal(decideVersion(37, null), 'ok');
  assert.equal(decideVersion(null, null), 'ok');
});

test('decideVersion : pas de minimum (0) → seulement la bannière', () => {
  assert.equal(decideVersion(1, { versionCode: 40, minVersionCode: 0, versionName: '' }), 'update');
});

test('parsePolicy : accepte une réponse /releases/latest complète et ignore le reste', () => {
  const out = parsePolicy({ ...policy, downloadUrl: 'https://s3/x?sig=1', releaseNotes: 'n', isActive: true });
  assert.deepEqual(out, policy);
});

test('parsePolicy : rejette les formes inutilisables ou incohérentes', () => {
  assert.equal(parsePolicy(null), null);
  assert.equal(parsePolicy('x'), null);
  assert.equal(parsePolicy({}), null);
  assert.equal(parsePolicy({ versionCode: '40', minVersionCode: 38 }), null);
  assert.equal(parsePolicy({ versionCode: 0, minVersionCode: 0 }), null);
  assert.equal(parsePolicy({ versionCode: 40.5, minVersionCode: 1 }), null);
  assert.equal(parsePolicy({ versionCode: 40, minVersionCode: -1 }), null);
  // minimum supérieur à la dernière version : donnée corrompue, on ne bloque pas sur cette base
  assert.equal(parsePolicy({ versionCode: 40, minVersionCode: 41 }), null);
});

test('parsePolicy : versionName absent devient une chaîne vide', () => {
  assert.equal(parsePolicy({ versionCode: 5, minVersionCode: 1 })?.versionName, '');
});

test('cache : aller-retour, et un cache corrompu ou vide est ignoré', () => {
  assert.deepEqual(deserializePolicy(serializePolicy(policy)), policy);
  assert.equal(deserializePolicy(null), null);
  assert.equal(deserializePolicy(''), null);
  assert.equal(deserializePolicy('{pas du json'), null);
  assert.equal(deserializePolicy('{"versionCode":"x"}'), null);
});

// ── Garde fail-open strict (B1 / B2) ─────────────────────────────────────────
// Politique « obligatoire » : minimum = dernière version (40), installée 39.
const required = { versionCode: 40, minVersionCode: 40, versionName: '1.2.0' };
const live = (downloadable: boolean): LatestOutcome => ({ kind: 'live', policy: required, downloadable });
// Un cache qui, lui, serait bloquant : il ne doit jamais bloquer seul.
const blockingCache = { versionCode: 41, minVersionCode: 41, versionName: '1.3.0' };

test('1. minimum requis + downloadUrl null → pas de blocage, « mise à jour disponible » + lien indisponible', () => {
  const g = evaluateGate(39, live(false), null);
  assert.equal(g.decision, 'update');
  assert.equal(g.downloadUnavailable, true);
});

test('1b. stockage désactivé / erreur S3 / erreur de signature (tous = downloadUrl null côté API) → pas de blocage', () => {
  // Couverts côté backend (tenant-releases.spec : « stockage indisponible → downloadUrl null ») :
  // le garde reçoit alors 200 + downloadUrl null, même entrée que le cas 1.
  assert.notEqual(evaluateGate(39, live(false), blockingCache).decision, 'blocked');
});

test('2. minimum requis + 500 backend → pas de blocage (même avec un cache bloquant)', () => {
  const outcome: LatestOutcome = { kind: classifyLatestFailure(500) };
  assert.equal(outcome.kind, 'unavailable');
  assert.notEqual(evaluateGate(39, outcome, blockingCache).decision, 'blocked');
  assert.notEqual(evaluateGate(39, outcome, null).decision, 'blocked');
});

test('3. minimum requis + timeout → pas de blocage (statut absent)', () => {
  const outcome: LatestOutcome = { kind: classifyLatestFailure(null) };
  assert.equal(outcome.kind, 'unavailable');
  assert.notEqual(evaluateGate(39, outcome, blockingCache).decision, 'blocked');
});

test('4. minimum requis + hors ligne / réseau indisponible → pas de blocage', () => {
  for (const status of [null, 0, 502, 503, 504]) {
    const outcome: LatestOutcome = { kind: classifyLatestFailure(status) };
    assert.notEqual(evaluateGate(39, outcome, blockingCache).decision, 'blocked', `status ${status}`);
  }
});

test('4b. réponse invalide (JSON incohérent) → pas de blocage, cache plafonné', () => {
  const invalid: LatestOutcome = { kind: 'live', policy: parsePolicy({ versionCode: 40, minVersionCode: 99 }), downloadable: true };
  assert.equal(evaluateGate(39, invalid, null).decision, 'ok');
  assert.notEqual(evaluateGate(39, invalid, blockingCache).decision, 'blocked');
});

test('5. 404 RELEASE_NOT_FOUND → aucune politique, pas de blocage, le cache est ignoré', () => {
  const outcome: LatestOutcome = { kind: classifyLatestFailure(404) };
  assert.equal(outcome.kind, 'no-release');
  const g = evaluateGate(39, outcome, blockingCache);
  assert.equal(g.decision, 'ok');
  assert.equal(g.policy, null);
});

test('6. version = latest → aucune bannière', () => {
  assert.equal(evaluateGate(40, live(true), null).decision, 'ok');
  assert.equal(evaluateGate(41, live(true), null).decision, 'ok');
});

test('7. version < latest (≥ minimum) → bannière, lien disponible', () => {
  const p = { versionCode: 40, minVersionCode: 30, versionName: '1.2.0' };
  const g = evaluateGate(35, { kind: 'live', policy: p, downloadable: true }, null);
  assert.equal(g.decision, 'update');
  assert.equal(g.downloadUnavailable, false);
});

test('8. version < minimum + downloadUrl valide → blocage', () => {
  const g = evaluateGate(39, live(true), null);
  assert.equal(g.decision, 'blocked');
  assert.equal(g.downloadUnavailable, false);
});

test('B2. le cache ne produit jamais « blocked » seul, mais peut produire la bannière', () => {
  const g = evaluateGate(39, { kind: 'unavailable' }, blockingCache);
  assert.equal(g.decision, 'update');
  assert.equal(g.fromCache, true);
  assert.equal(evaluateGate(39, { kind: 'unavailable' }, null).decision, 'ok');
});
