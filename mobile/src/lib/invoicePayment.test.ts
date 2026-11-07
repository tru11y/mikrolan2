// Libellés d'état des factures d'abonnement (écrans admin). Aucune action manuelle n'existe.
//   node --test --experimental-strip-types src/lib/invoicePayment.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { invoicePaymentKey } from './invoicePayment.ts';

test('SASPAY PENDING : en attente de confirmation', () => {
  assert.equal(invoicePaymentKey('SASPAY', 'PENDING'), 'saspayPending');
});
test('SASPAY PAID : confirmé', () => {
  assert.equal(invoicePaymentKey('SASPAY', 'PAID'), 'saspayPaid');
});
test('SASPAY FAILED : échoué', () => {
  assert.equal(invoicePaymentKey('SASPAY', 'FAILED'), 'saspayFailed');
});
test('MANUAL historique : lecture seule, quel que soit le statut', () => {
  for (const s of ['PENDING', 'PAID', 'FAILED', 'REFUNDED']) assert.equal(invoicePaymentKey('MANUAL', s), 'manualHistory');
});
test('provider inconnu (backend actuel) : libellé neutre, jamais SasPay', () => {
  for (const p of [undefined, null, '', 'OTHER']) {
    assert.equal(invoicePaymentKey(p, 'PENDING'), 'pending');
    assert.equal(invoicePaymentKey(p, 'PAID'), 'paid');
    assert.equal(invoicePaymentKey(p, 'FAILED'), 'failed');
    assert.equal(invoicePaymentKey(p, 'REFUNDED'), 'other');
  }
});
test('statut inattendu : repli other', () => {
  assert.equal(invoicePaymentKey('SASPAY', 'WHATEVER'), 'other');
});

type Loc = { adminPayments: Record<string, string> };
const fr = JSON.parse(readFileSync('src/i18n/locales/fr.json', 'utf8')) as Loc;
const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as Loc;

test('chaque clé produite existe en français et en anglais', () => {
  const produced = new Set<string>();
  for (const p of ['SASPAY', 'MANUAL', undefined]) for (const s of ['PENDING', 'PAID', 'FAILED']) produced.add(invoicePaymentKey(p, s));
  for (const k of produced) {
    assert.ok(fr.adminPayments[k], `fr.adminPayments.${k} manquant`);
    assert.ok(en.adminPayments[k], `en.adminPayments.${k} manquant`);
  }
});

test('textes exacts demandés (français)', () => {
  assert.equal(fr.adminPayments['saspayPending'], 'Paiement SasPay en attente de confirmation');
  assert.equal(fr.adminPayments['saspayFailed'], 'Paiement SasPay échoué');
  assert.equal(fr.adminPayments['saspayPaid'], 'Paiement SasPay confirmé');
});
