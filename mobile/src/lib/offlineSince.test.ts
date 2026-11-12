import test from 'node:test';
import assert from 'node:assert/strict';
import { offlineSince } from './offlineSince.ts';

test('aucune lecture réussie → never', () => {
  assert.deepEqual(offlineSince(0, 1_000_000), { kind: 'never' });
  assert.deepEqual(offlineSince(undefined, 1_000_000), { kind: 'never' });
});

test('dernière lecture il y a 3 h → since 10800 s', () => {
  const now = 10_000_000_000;
  assert.deepEqual(offlineSince(now - 3 * 3600 * 1000, now), { kind: 'since', ageSeconds: 10800 });
});

test('horloge en avance → âge jamais négatif', () => {
  assert.deepEqual(offlineSince(2_000, 1_000), { kind: 'since', ageSeconds: 0 });
});
