import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDayTime, fmtPlanDuration, verdictSpec, type TicketState } from './ticketVerification.ts';

// Exécuté par le runtime TypeScript natif de Node (>=22) :
//   node --test src/lib/ticketVerification.test.ts

test('un ticket non provisionné n\'est JAMAIS présenté comme valide', () => {
  const v = verdictSpec('UNAVAILABLE');
  assert.equal(v.tone, 'invalid');
  assert.equal(v.title, 'states.UNAVAILABLE');
  assert.notEqual(v.title, 'valid');
});

test('jamais utilisé et en cours sont des états positifs ; révoqué, expiré et indisponible sont invalides', () => {
  const tone = (s: TicketState) => verdictSpec(s).tone;
  assert.equal(tone('AVAILABLE'), 'valid');
  assert.equal(tone('IN_USE'), 'valid');
  assert.equal(tone('USED'), 'used');
  assert.equal(tone('ENDED'), 'used');
  for (const s of ['REVOKED', 'EXPIRED', 'UNAVAILABLE'] as const) assert.equal(tone(s), 'invalid');
});

test('un état inconnu du backend retombe sur « non disponible », jamais sur « valide »', () => {
  assert.equal(verdictSpec('SOMETHING_NEW' as TicketState).tone, 'invalid');
});

test('fmtDayTime : format FR « JJ/MM/AAAA à HH:MM », null si absent ou invalide', () => {
  const local = new Date(2026, 9, 5, 8, 30);
  assert.equal(fmtDayTime(local.toISOString()), '05/10/2026 à 08:30');
  assert.equal(fmtDayTime(null), null);
  assert.equal(fmtDayTime(undefined), null);
  assert.equal(fmtDayTime('pas une date'), null);
});

test('fmtPlanDuration : jours, heures, minutes sans surcharge', () => {
  assert.equal(fmtPlanDuration(4320), '3 j');
  assert.equal(fmtPlanDuration(1440 + 12 * 60), '1 j 12 h');
  assert.equal(fmtPlanDuration(150), '2 h 30 min');
  assert.equal(fmtPlanDuration(45), '45 min');
  assert.equal(fmtPlanDuration(0), '0 min');
});
