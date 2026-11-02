// Static guard on the verifier screen source: the raw backend status code
// (VALID, BLOCKED, ...) must never be rendered. This does NOT render the
// component; the real rendering is confirmed on device.
//   node --test --experimental-strip-types src/lib/verifyScreen.static.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Run from the mobile/ directory (npm run test:unit).
const src = readFileSync('app/(verifier)/verify.tsx', 'utf8').toString();

test('verify.tsx has no Pill badge component', () => {
  assert.ok(!/\bPill\b/.test(src));
});

test('verify.tsx never renders the raw status code as text or label', () => {
  assert.ok(!/\{\s*state\.result\.status\s*\}/.test(src));
  assert.ok(!/label=\{\s*state\.result\.status\s*\}/.test(src));
});

test('result title and action come from verdictView', () => {
  assert.ok(/verdictView\(result\)/.test(src));
  assert.ok(/\{state\.view\.title\}/.test(src));
  assert.ok(/\{state\.view\.actionLabel\}/.test(src));
});

test('result title is colored by the view tone', () => {
  assert.ok(/toneColor\(state\.view\.tone\)/.test(src));
});

// Décision produit : un ticket révoqué est indistinguable d'un code inexistant.
// Plus aucun rendu ni type public « bloqué » côté vendeur.
const sources = [
  readFileSync('src/lib/verifierMapping.ts', 'utf8').toString(),
  readFileSync('app/(verifier)/verify.tsx', 'utf8').toString(),
];

test('no public BLOCKED / Ticket bloqué / CONTACT_MANAGER rendering in the vendor mobile sources', () => {
  for (const s of sources) {
    assert.ok(!/BLOCKED/.test(s));
    assert.ok(!/Ticket bloqué/.test(s));
    assert.ok(!/CONTACT_MANAGER/.test(s));
    assert.ok(!/Contacter le responsable/.test(s));
  }
});

test('the public status/action types no longer include BLOCKED / CONTACT_MANAGER', () => {
  const api = readFileSync('src/lib/api.ts', 'utf8').toString();
  const block = api.slice(api.indexOf('export type TicketVerificationStatus'), api.indexOf('export interface TicketVerificationResponse'));
  assert.ok(block.includes("'NOT_FOUND'"));
  assert.ok(!/BLOCKED|CONTACT_MANAGER/.test(block));
});
