import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalGenerationOutcome, shouldPushViaLan } from './voucherGeneration.ts';

// Exécuté par le runtime TypeScript natif de Node (>=22), comme metricsCsvRows.test.ts :
//   node --test src/lib/voucherGeneration.test.ts

const PUSH = {
  userProfile: 'p1',
  limitUptime: '60m',
  comment: 'mikrolan:batch',
};

test('LOCAL : lot GENERATING, push serveur absent, payload présent => le téléphone pousse en LAN', () => {
  assert.equal(shouldPushViaLan({ pushedByServer: false, push: PUSH }), true);
});

test('REMOTE COMPLETED / PARTIAL / FAILED : le serveur a déjà poussé => jamais de second push LAN', () => {
  // `push` est undefined quand le serveur a poussé, mais même un payload résiduel ne doit rien déclencher.
  for (const push of [undefined, PUSH]) {
    assert.equal(shouldPushViaLan({ pushedByServer: true, push }), false);
  }
});

test('LOCAL sans payload de push : rien à pousser', () => {
  assert.equal(shouldPushViaLan({ pushedByServer: false, push: undefined }), false);
});

test('issue finale LOCAL COMPLETED : 10 préparés, 10 confirmés', () => {
  assert.equal(finalGenerationOutcome(10, 10), 'SUCCESS');
});

test('issue finale LOCAL PARTIAL : 10 préparés, 8 confirmés', () => {
  assert.equal(finalGenerationOutcome(10, 8), 'PARTIAL_SUCCESS');
});

test('issue finale LOCAL FAILED : 10 préparés, 0 confirmé', () => {
  assert.equal(finalGenerationOutcome(10, 0), 'FAILED');
});

test('issue finale REMOTE : mêmes règles, calculées sur les tickets provisionnés', () => {
  assert.equal(finalGenerationOutcome(10, 10), 'SUCCESS');
  assert.equal(finalGenerationOutcome(10, 8), 'PARTIAL_SUCCESS');
  assert.equal(finalGenerationOutcome(10, 0), 'FAILED');
});
