import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveState, fmtDayTime, fmtPlanDuration, fmtRemaining, remainingMs, verdictSpec, type TicketState } from './ticketVerification.ts';

// Exécuté par le runtime TypeScript natif de Node (>=22) :
//   node --test src/lib/ticketVerification.test.ts

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);

test('un ticket non provisionné n\'est JAMAIS présenté comme valide', () => {
  const v = verdictSpec('UNAVAILABLE');
  assert.equal(v.tone, 'invalid');
  assert.equal(v.title, 'states.UNAVAILABLE');
});

test('états : disponible et en cours positifs ; expiré, révoqué, indisponible invalides', () => {
  const tone = (s: TicketState) => verdictSpec(s).tone;
  assert.equal(tone('AVAILABLE'), 'valid');
  assert.equal(tone('IN_USE'), 'valid');
  assert.equal(tone('ENDED'), 'used');
  for (const s of ['REVOKED', 'EXPIRED', 'UNAVAILABLE'] as const) assert.equal(tone(s), 'invalid');
  assert.equal(verdictSpec('SOMETHING_NEW' as TicketState).tone, 'invalid');
});

test('A. jamais connecté, durée 3 jours : pas d\'expiration, temps restant = durée complète « 3 j »', () => {
  const rem = remainingMs({ expiresAt: null, durationSeconds: 3 * 86400, nowMs: NOW });
  assert.equal(rem, 3 * D);
  assert.equal(fmtRemaining(rem), '3 j');
});

test('B. première connexion il y a 2 h, durée 24 h : environ 22 h restantes', () => {
  const expiresAt = new Date(NOW - 2 * H + D).toISOString();
  const rem = remainingMs({ expiresAt, durationSeconds: 86400, nowMs: NOW });
  assert.equal(rem, 22 * H);
  assert.equal(fmtRemaining(rem), '22 h');
  assert.equal(effectiveState('IN_USE', 'x', rem), 'IN_USE');
});

test('C. première connexion il y a 2 j, durée 1 j : expiré, temps restant jamais négatif', () => {
  const expiresAt = new Date(NOW - 2 * D + D).toISOString();
  const rem = remainingMs({ expiresAt, durationSeconds: 86400, nowMs: NOW });
  assert.equal(rem, 0);
  assert.equal(fmtRemaining(rem), 'Expiré');
  assert.equal(effectiveState('IN_USE', 'x', rem), 'EXPIRED');
});

test('D./E. l\'état explicite garde la priorité sur le calcul de durée', () => {
  assert.equal(effectiveState('REVOKED', 'x', 2 * D), 'REVOKED');
  assert.equal(effectiveState('UNAVAILABLE', 'x', 2 * D), 'UNAVAILABLE');
  assert.equal(effectiveState('REVOKED', 'x', 0), 'REVOKED');
  assert.equal(effectiveState('AVAILABLE', null, 3 * D), 'AVAILABLE');
});

test('format du temps restant : 3 j, 2 j 4 h, 8 h 17 min, 42 min, < 1 min, Expiré', () => {
  assert.equal(fmtRemaining(3 * D), '3 j');
  assert.equal(fmtRemaining(2 * D + 4 * H + 59_000), '2 j 4 h');
  assert.equal(fmtRemaining(8 * H + 17 * 60_000 + 30_000), '8 h 17 min');
  assert.equal(fmtRemaining(42 * 60_000), '42 min');
  assert.equal(fmtRemaining(30_000), '< 1 min');
  assert.equal(fmtRemaining(0), 'Expiré');
  assert.equal(fmtRemaining(-12345), 'Expiré');
  assert.equal(fmtRemaining(Number.NaN), 'Expiré');
});

test('l\'écart d\'horloge serveur/téléphone est corrigé et le temps restant reste borné à 0', () => {
  const expiresAt = new Date(NOW + H).toISOString();
  assert.equal(remainingMs({ expiresAt, durationSeconds: 0, nowMs: NOW, clockOffsetMs: 30 * 60_000 }), 30 * 60_000);
  assert.equal(remainingMs({ expiresAt: 'pas une date', durationSeconds: 0, nowMs: NOW }), 0);
});

test('fmtDayTime : format FR « JJ/MM/AAAA à HH:MM », null si absent ou invalide', () => {
  assert.equal(fmtDayTime(new Date(2026, 9, 5, 8, 30).toISOString()), '05/10/2026 à 08:30');
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
