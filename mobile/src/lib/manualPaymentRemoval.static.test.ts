// Garde statique : le flux de paiement manuel (preuve + validation humaine) est retiré de l'interface.
// Seul flux officiel : checkout SasPay -> webhook signé -> activation automatique.
//   node --test --experimental-strip-types src/lib/manualPaymentRemoval.static.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.ts$/.test(e)) out.push(p);
  }
  return out;
}
const sources = [...walk('app'), ...walk('src')];

test('app/payment.tsx n existe plus', () => {
  assert.equal(existsSync('app/payment.tsx'), false);
});

test('aucun écran ne pointe vers /payment (hors payment-saspay / payment-history)', () => {
  const bad = sources.filter((f) => /['"`]\/payment['"`?]/.test(read(f)));
  assert.deepEqual(bad, []);
});

test('plus de uploadProof / paymentInfo / upload-proof / payment-info', () => {
  const bad = sources.filter((f) => /uploadProof|paymentInfo\b|upload-proof|payment-info/.test(read(f)));
  assert.deepEqual(bad, []);
});

test('validateInvoice / rejectInvoice ni exposés ni appelés', () => {
  const bad = sources.filter((f) => /validateInvoice|rejectInvoice/.test(read(f)));
  assert.deepEqual(bad, []);
});

test('admin-tenant : aucune action manuelle, libellé d état à la place', () => {
  const s = read('app/admin-tenant.tsx');
  assert.ok(!/adminTenant\.(validateInvoice|rejectInvoice)/.test(s));
  assert.ok(/invoicePaymentKey\(inv\.provider, inv\.status\)/.test(s));
});

test('onglet Demandes : lecture seule', () => {
  const s = read('src/components/admin/AdminRequestsTab.tsx');
  assert.ok(!/subscriptions\.activate|useMutation|ConfirmDialog|validatePayment|activateButton/.test(s));
  assert.ok(/invoicePaymentKey\(inv\.provider, inv\.status\)/.test(s));
  assert.ok(/status: 'PENDING'/.test(s));
});

test('checkout SasPay accessible depuis PRO', () => {
  assert.ok(/pathname:\s*'\/payment-saspay'/.test(read('app/pro.tsx')));
  assert.ok(existsSync('app/payment-saspay.tsx'));
  assert.ok(existsSync('app/payment-history.tsx'));
});

test('pro.tsx : plus de texte serveur instructions, message d activation automatique', () => {
  const s = read('app/pro.tsx');
  assert.ok(!/res\.instructions/.test(s));
  assert.ok(/t\('pro\.activationAuto'\)/.test(s));
});

for (const lang of ['fr', 'en'] as const) {
  const j = JSON.parse(read(`src/i18n/locales/${lang}.json`)) as Record<string, Record<string, string>>;

  test(`[${lang}] aucun texte de validation manuelle dans le parcours abonnement`, () => {
    const scope = JSON.stringify({ pro: j['pro'], saspay: j['saspay'] });
    assert.ok(!/validation manuelle|validé par un administrateur|preuve|capture d.écran|validated by an administrator|proof|screenshot/i.test(scope));
  });

  test(`[${lang}] activation annoncée APRÈS confirmation SasPay, jamais immédiate`, () => {
    const t = j['pro']!['activationAuto']!;
    assert.ok(/SasPay/.test(t) && /(après confirmation|once the .* confirmed)/i.test(t));
    assert.ok(!/immédiat|immediate|instant/i.test(t));
  });

  test(`[${lang}] section payment supprimée, adminPayments présente`, () => {
    assert.equal('payment' in j, false);
    assert.ok(j['adminPayments']);
  });
}
