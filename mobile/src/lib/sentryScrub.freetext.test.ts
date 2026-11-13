import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubEvent, scrubString } from './sentryScrub.ts';

const gone = (text: string, ...secrets: string[]) => {
  const out = scrubString(text);
  for (const s of secrets) assert.equal(out.includes(s), false, `fuite : ${s} dans « ${out} »`);
  return out;
};

test('texte libre : code de ticket nu, avec ou sans mot-clé', () => {
  gone('échec pour code 4k2077 sur le routeur', '4k2077');
  gone('ticket 1m60477416 introuvable', '1m60477416');
  gone('le 7h5421251 vient de se connecter', '7h5421251');
});

test('texte libre : mot de passe et référence de paiement suivis de leur valeur', () => {
  gone('routeros pass NEW-FAKE-PW-42 refusé', 'NEW-FAKE-PW-42');
  gone('mot de passe: S3cr3t!x', 'S3cr3t!x');
  gone('saspay REF-NEW-FAKE-77 en attente', 'REF-NEW-FAKE-77');
  gone('password=abcd1234 ok', 'abcd1234');
});

test('texte libre : identifiants opaques entiers (CUID, UUID, ObjectId), sans reste de préfixe', () => {
  const out = gone('voucher ckvoucher000000000000009 batch ckbatch0000000000000009 u 0b8a1f4e-1111-2222-3333-444455556666 o 507f1f77bcf86cd799439011', 'ckvoucher', 'ckbatch', '0b8a1f4e', '507f1f77');
  assert.match(out, /\[id\]/);
});

test('texte libre : données utiles conservées (statut HTTP, dates ISO, numéro de build Android, route)', () => {
  assert.equal(scrubString('Request failed with status code 401'), 'Request failed with status code 401');
  assert.equal(scrubString('2026-11-12T15:41:30.673Z'), '2026-11-12T15:41:30.673Z');
  assert.equal(scrubString('CP2A.260205.001.A566BXXUEDZJ1'), 'CP2A.260205.001.A566BXXUEDZJ1');
  assert.equal(scrubString('GET /api/routers failed'), 'GET /api/routers failed');
});

test('téléphone : formats courants masqués', () => {
  gone('appeler +225 07 00 00 00 01', '07 00 00 00 01');
  gone('appeler 0700000001 vite', '0700000001');
});

test('contexts : l’intérieur est nettoyé, les contextes système du SDK sont conservés, device.id retiré', () => {
  const e = scrubEvent({
    contexts: {
      saspay: { reference: 'REF-X-1', body: { msisdn: '+2250700000001' } },
      device: { model: 'SM-A566B', id: 'deviceid-123' },
      os: { build: 'CP2A.260205.001' },
    },
  } as never) as unknown as { contexts: Record<string, Record<string, unknown>> };
  const out = JSON.stringify(e);
  assert.equal(out.includes('REF-X-1'), false);
  assert.equal(out.includes('2250700000001'), false);
  assert.equal(out.includes('deviceid-123'), false);
  assert.equal(e.contexts.device?.model, 'SM-A566B');
  assert.equal(e.contexts.os?.build, 'CP2A.260205.001');
  assert.equal(typeof e.contexts.saspay, 'object');
});

test('marqueurs bien formés : pas de crochet orphelin après masquage', () => {
  const out = scrubString('échec code 6x4408 voucher ckvoucher000000000000002 saspay REF-1');
  assert.equal((out.match(/\[/g) ?? []).length, (out.match(/\]/g) ?? []).length, out);
  assert.equal(out.includes('6x4408'), false);
});
