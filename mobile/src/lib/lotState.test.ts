import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotState } from './lotState.ts';

// node --test src/lib/lotState.test.ts
const lot = (o: { status: 'PENDING' | 'GENERATING' | 'COMPLETED' | 'PARTIAL_SUCCESS' | 'FAILED'; quantity: number; voucherCount: number; provisionedCount: number }) => o;

test('A — COMPLETED 10/10 : complet, 10 disponibles', () => {
  assert.deepEqual(lotState(lot({ status: 'COMPLETED', quantity: 10, voucherCount: 10, provisionedCount: 10 })), { state: 'completed', available: 10, missing: 0 });
});

test('B — PARTIAL_SUCCESS 8/10 (10 en base) : partiel, 8 disponibles, 2 non disponibles', () => {
  assert.deepEqual(lotState(lot({ status: 'PARTIAL_SUCCESS', quantity: 10, voucherCount: 10, provisionedCount: 8 })), { state: 'partial', available: 8, missing: 2 });
});

test('B bis — PARTIAL_SUCCESS 8/10 sans les 2 tickets en base : toujours 2 non disponibles', () => {
  assert.deepEqual(lotState(lot({ status: 'PARTIAL_SUCCESS', quantity: 10, voucherCount: 8, provisionedCount: 8 })), { state: 'partial', available: 8, missing: 2 });
});

test('C — FAILED 0/10 : échec, 0 disponible (aucune distribution)', () => {
  assert.equal(lotState(lot({ status: 'FAILED', quantity: 10, voucherCount: 0, provisionedCount: 0 })).state, 'failed');
  assert.equal(lotState(lot({ status: 'FAILED', quantity: 10, voucherCount: 10, provisionedCount: 0 })).available, 0);
});

test('règle par compteur : COMPLETED mais 0 provisionné avec des tickets en base = échec', () => {
  assert.equal(lotState(lot({ status: 'COMPLETED', quantity: 10, voucherCount: 10, provisionedCount: 0 })).state, 'failed');
});

test('lot réussi dont tous les tickets ont été supprimés (nettoyage) : vide, pas un échec', () => {
  assert.equal(lotState(lot({ status: 'COMPLETED', quantity: 10, voucherCount: 0, provisionedCount: 0 })).state, 'empty');
});

test('PENDING / GENERATING : création en cours', () => {
  assert.equal(lotState(lot({ status: 'GENERATING', quantity: 10, voucherCount: 0, provisionedCount: 0 })).state, 'generating');
  assert.equal(lotState(lot({ status: 'PENDING', quantity: 10, voucherCount: 0, provisionedCount: 0 })).state, 'generating');
});
