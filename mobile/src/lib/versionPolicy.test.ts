import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideVersion,
  deserializePolicy,
  parsePolicy,
  resolvePolicy,
  serializePolicy,
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

test('resolvePolicy : le live prime sur le cache, le cache sur rien', () => {
  const cached = { versionCode: 30, minVersionCode: 30, versionName: 'old' };
  assert.equal(resolvePolicy(policy, cached), policy);
  assert.equal(resolvePolicy(null, cached), cached);
  assert.equal(resolvePolicy(null, null), null);
});

test('cache : aller-retour, et un cache corrompu ou vide est ignoré', () => {
  assert.deepEqual(deserializePolicy(serializePolicy(policy)), policy);
  assert.equal(deserializePolicy(null), null);
  assert.equal(deserializePolicy(''), null);
  assert.equal(deserializePolicy('{pas du json'), null);
  assert.equal(deserializePolicy('{"versionCode":"x"}'), null);
});

test('hors ligne avec un minimum connu : le blocage persiste grâce au cache', () => {
  const cached = deserializePolicy(serializePolicy({ versionCode: 41, minVersionCode: 41, versionName: '1.3.0' }));
  assert.equal(decideVersion(39, resolvePolicy(null, cached)), 'blocked');
});
