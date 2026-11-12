import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Le vendeur (TICKET_VERIFIER) n'a accès, côté serveur, qu'à : POST /ticket-verification/verify et, pour
// son compte, /auth (me, change-password, logout-all, push-token, legal-consent) + /releases/latest.
const dir = join(import.meta.dirname, '..', '..', 'app', '(verifier)');
const ALLOWED = new Set(['api.ticketVerification.verify', 'api.auth.me', 'api.auth.logout', 'api.auth.changePassword', 'api.auth.logoutAll', 'api.auth.acceptLegal']);

test('les écrans vendeur n’appellent que des routes de l’allowlist serveur', () => {
  const calls = new Set<string>();
  for (const f of readdirSync(dir)) {
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/api\.[a-zA-Z]+\.[a-zA-Z]+/g)) calls.add(m[0]);
  }
  assert.ok(calls.has('api.ticketVerification.verify'), 'l’écran de vérification doit appeler verify');
  for (const c of calls) assert.ok(ALLOWED.has(c), `appel hors allowlist vendeur : ${c}`);
});

test('le flux d’évènements et la déconnexion ne sollicitent pas de route interdite au vendeur', () => {
  const root = join(import.meta.dirname, '..', 'providers');
  const live = readFileSync(join(root, 'live-events-provider.tsx'), 'utf8');
  assert.match(live, /role !== 'TICKET_VERIFIER'/);
  const auth = readFileSync(join(root, 'auth-provider.tsx'), 'utf8');
  assert.match(auth, /role !== 'TICKET_VERIFIER'\) await clearAllLocalRouterCredentials/);
});
