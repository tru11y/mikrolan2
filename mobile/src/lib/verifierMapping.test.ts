// Pure-function tests runnable without jest/vitest:
//   node --test --experimental-strip-types mobile/src/lib/verifierMapping.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionLabel,
  httpErrorView,
  isValidLength,
  normalizeTicketCode,
  verdictView,
  KNOWN_STATUSES,
} from './verifierMapping.ts';
import type { TicketVerificationResponse } from './api.ts';

function mkRes(
  status: TicketVerificationResponse['status'],
  action: TicketVerificationResponse['recommendedAction'],
): TicketVerificationResponse {
  return { status, message: 'ignored-by-mapping', recommendedAction: action };
}

test('normalizeTicketCode trims surrounding whitespace', () => {
  assert.equal(normalizeTicketCode('  ABC123  '), 'ABC123');
});

test('normalizeTicketCode preserves case and inner spaces', () => {
  assert.equal(normalizeTicketCode(' AbC 12 3 '), 'AbC 12 3');
});

test('isValidLength rejects empty / whitespace-only / too long', () => {
  assert.equal(isValidLength(''), false);
  assert.equal(isValidLength('   '), false);
  assert.equal(isValidLength('A'.repeat(65)), false);
  assert.equal(isValidLength('A'.repeat(64)), true);
  assert.equal(isValidLength('ABC123'), true);
});

test('verdictView VALID → success + ALLOW_CUSTOMER label', () => {
  const v = verdictView(mkRes('VALID', 'ALLOW_CUSTOMER'));
  assert.equal(v.title, 'Ticket valide');
  assert.equal(v.tone, 'success');
  assert.equal(v.actionLabel, 'Autoriser le client');
  assert.equal(v.subtitle, null);
});

test('verdictView ALREADY_USED → warning + DO_NOT_REPLACE', () => {
  const v = verdictView(mkRes('ALREADY_USED', 'DO_NOT_REPLACE'));
  assert.equal(v.title, 'Ticket déjà utilisé');
  assert.equal(v.tone, 'warning');
  assert.equal(v.actionLabel, 'Ne pas remplacer le ticket');
});

test('verdictView EXPIRED → danger + SELL_NEW_TICKET', () => {
  const v = verdictView(mkRes('EXPIRED', 'SELL_NEW_TICKET'));
  assert.equal(v.title, 'Ticket expiré');
  assert.equal(v.tone, 'danger');
  assert.equal(v.actionLabel, 'Proposer un nouveau ticket');
});

test('verdictView BLOCKED → danger + CONTACT_MANAGER', () => {
  const v = verdictView(mkRes('BLOCKED', 'CONTACT_MANAGER'));
  assert.equal(v.title, 'Ticket bloqué');
  assert.equal(v.tone, 'danger');
  assert.equal(v.actionLabel, 'Contacter le responsable');
});

test('verdictView NOT_FOUND → muted + check-code subtitle', () => {
  const v = verdictView(mkRes('NOT_FOUND', 'CHECK_ENTERED_CODE'));
  assert.equal(v.title, 'Ticket inexistant');
  assert.equal(v.tone, 'muted');
  assert.equal(v.subtitle, 'Vérifiez le code saisi.');
});

test('verdictView TEMPORARILY_UNAVAILABLE → primary + retry subtitle', () => {
  const v = verdictView(mkRes('TEMPORARILY_UNAVAILABLE', 'RETRY_LATER'));
  assert.equal(v.title, 'Vérification temporairement indisponible');
  assert.equal(v.tone, 'primary');
  assert.equal(v.subtitle, 'Réessayez dans quelques instants.');
});

test('verdictView never surfaces the server message field', () => {
  const v = verdictView({
    status: 'VALID',
    message: 'MALICIOUS SERVER TEXT',
    recommendedAction: 'ALLOW_CUSTOMER',
  });
  assert.notEqual(v.title, 'MALICIOUS SERVER TEXT');
  assert.notEqual(v.actionLabel, 'MALICIOUS SERVER TEXT');
});

test('httpErrorView 400 → warning, non-blocking', () => {
  const e = httpErrorView(400);
  assert.equal(e.blocking, false);
  assert.equal(e.tone, 'warning');
});

test('httpErrorView 403 → blocking + generic', () => {
  const e = httpErrorView(403);
  assert.equal(e.blocking, true);
  assert.equal(e.tone, 'danger');
  // Generic text: no internal guard reason leaked.
  assert.ok(!/scope|assignment|suspend|tenant/i.test(e.subtitle));
});

test('httpErrorView 429 → warning, non-blocking', () => {
  const e = httpErrorView(429);
  assert.equal(e.blocking, false);
  assert.equal(e.tone, 'warning');
});

test('httpErrorView network/500 (undefined status) → neutral retry', () => {
  const e = httpErrorView(undefined);
  assert.equal(e.blocking, false);
  assert.equal(e.tone, 'primary');
});

test('KNOWN_STATUSES exhaustive — matches the public contract', () => {
  assert.deepEqual([...KNOWN_STATUSES], [
    'VALID',
    'ALREADY_USED',
    'EXPIRED',
    'BLOCKED',
    'NOT_FOUND',
    'TEMPORARILY_UNAVAILABLE',
  ]);
});

test('actionLabel covers all stable codes', () => {
  assert.equal(actionLabel('ALLOW_CUSTOMER'), 'Autoriser le client');
  assert.equal(actionLabel('DO_NOT_REPLACE'), 'Ne pas remplacer le ticket');
  assert.equal(actionLabel('SELL_NEW_TICKET'), 'Proposer un nouveau ticket');
  assert.equal(actionLabel('CONTACT_MANAGER'), 'Contacter le responsable');
  assert.equal(actionLabel('RETRY_LATER'), 'Réessayer plus tard');
  assert.equal(actionLabel('CHECK_ENTERED_CODE'), 'Vérifiez le code saisi');
});
