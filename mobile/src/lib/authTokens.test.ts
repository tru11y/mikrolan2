import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredTokens, serializeTokens } from './authTokens.ts';

test('aller-retour : la paire sérialisée se relit à l’identique', () => {
  const tokens = { accessToken: 'acc-1', refreshToken: 'ref-1' };
  assert.deepEqual(parseStoredTokens(serializeTokens(tokens)), tokens);
});

test('valeur absente ou vide → null', () => {
  assert.equal(parseStoredTokens(null), null);
  assert.equal(parseStoredTokens(''), null);
});

test('JSON corrompu → null (pas d’exception)', () => {
  assert.equal(parseStoredTokens('{not json'), null);
});

test('paire incomplète → null (jamais de session à moitié restaurée)', () => {
  assert.equal(parseStoredTokens(JSON.stringify({ v: 1, accessToken: 'a' })), null);
  assert.equal(parseStoredTokens(JSON.stringify({ v: 1, refreshToken: 'r' })), null);
  assert.equal(parseStoredTokens(JSON.stringify({ v: 1, accessToken: 1, refreshToken: 2 })), null);
});
