import test from 'node:test';
import assert from 'node:assert/strict';
import { createLanResolver, isGenericIdentity, LanIdentityMismatchError, TTL_VERIFIED_MS, verifySessionIdentity, type LanDeps } from './lanRouting.core.ts';

type Creds = { host: string; port: number; username: string; password: string };

// Deux routeurs DIFFÉRENTS, MÊME adresse LAN (cas réel des hotspots MikroTik).
const ROUTERS: Record<string, { identity: string; creds: Creds | null }> = {
  A: { identity: 'ROUTER_A', creds: { host: '10.10.10.1', port: 8728, username: 'u', password: 'p' } },
  B: { identity: 'ROUTER_B', creds: { host: '10.10.10.1', port: 8728, username: 'u', password: 'p' } },
};

function setup(opts: { physical?: 'A' | 'B' | null; wifi?: { gateway: string; ipAddress: string } | null; expected?: Record<string, string | null>; unreachable?: boolean } = {}) {
  let now = 1_000_000;
  const state = {
    physical: opts.physical === undefined ? 'A' : opts.physical,
    wifi: opts.wifi === undefined ? { gateway: '10.10.10.1', ipAddress: '10.10.10.57' } : opts.wifi,
    reads: 0,
    unreachable: opts.unreachable ?? false,
  };
  const deps: LanDeps<Creds> = {
    getCreds: async (id) => ROUTERS[id]?.creds ?? null,
    getWifi: async () => state.wifi,
    expectedIdentity: async (id) => (opts.expected ? (opts.expected[id] ?? null) : (ROUTERS[id]?.identity ?? null)),
    readIdentity: async () => {
      state.reads += 1;
      if (state.unreachable || !state.physical) throw new Error('timeout');
      return ROUTERS[state.physical].identity;
    },
    now: () => now,
  };
  const resolver = createLanResolver(deps);
  return { resolver, state, advance: (ms: number) => (now += ms) };
}

test('TEST A/B : téléphone sur le Wi-Fi de A, routeur B sélectionné, MÊME 10.10.10.1 → MISMATCH, aucun credential LAN rendu', async () => {
  const { resolver } = setup({ physical: 'A' });
  const b = await resolver.resolve('B');
  assert.equal(b.state, 'MISMATCH');
  assert.equal(b.creds, null); // aucune lecture / reboot / push / report possible pour B via A
  assert.equal(b.observedIdentity, 'ROUTER_A');
  const a = await resolver.resolve('A');
  assert.equal(a.state, 'VERIFIED'); // A reste utilisable
  assert.deepEqual(a.creds, { ...ROUTERS.A.creds, expectedIdentity: 'ROUTER_A' });
});

test('A. bon Wi-Fi + bonne identité → VERIFIED', async () => {
  const { resolver } = setup({ physical: 'B' });
  const r = await resolver.resolve('B');
  assert.equal(r.state, 'VERIFIED');
  assert.equal(r.observedIdentity, 'ROUTER_B');
});

test('C. Wi-Fi absent / 4G → NO_LAN, aucune lecture réseau', async () => {
  const { resolver, state } = setup({ wifi: null });
  assert.equal((await resolver.resolve('A')).state, 'NO_LAN');
  assert.equal(state.reads, 0);
});

test('C2. hôte hors du réseau courant → NO_LAN (jamais de socket hors sous-réseau)', async () => {
  const { resolver, state } = setup({ wifi: { gateway: '192.168.1.1', ipAddress: '192.168.1.20' } });
  assert.equal((await resolver.resolve('A')).state, 'NO_LAN');
  assert.equal(state.reads, 0);
});

test('D. candidat LAN qui ne répond pas → UNREACHABLE', async () => {
  const { resolver } = setup({ unreachable: true });
  const r = await resolver.resolve('A');
  assert.equal(r.state, 'UNREACHABLE');
  assert.equal(r.creds, null);
});

test('E. identité attendue générique / absente → UNVERIFIABLE, jamais MATCH (aucune lecture inutile)', async () => {
  for (const expected of ['MikroTik', 'RouterOS', null, '']) {
    const { resolver, state } = setup({ expected: { A: expected } });
    const r = await resolver.resolve('A');
    assert.equal(r.state, 'UNVERIFIABLE');
    assert.equal(r.creds, null);
    assert.equal(state.reads, 0);
  }
});

test('F. VERIFIED mis en cache : pas de commande identity à chaque poll ; expire après le TTL', async () => {
  const { resolver, state, advance } = setup();
  await resolver.resolve('A');
  await resolver.resolve('A');
  await resolver.resolve('A');
  assert.equal(state.reads, 1);
  advance(TTL_VERIFIED_MS + 1);
  await resolver.resolve('A');
  assert.equal(state.reads, 2);
});

test('F2. polls concurrents : UNE seule lecture identity (dédoublonnage)', async () => {
  const { resolver, state } = setup();
  await Promise.all(Array.from({ length: 10 }, () => resolver.resolve('A')));
  assert.equal(state.reads, 1);
});

test('G. changement de Wi-Fi : cache invalidé (clé différente) et invalidate() vide tout', async () => {
  const { resolver, state } = setup({ physical: 'A' });
  assert.equal((await resolver.resolve('A')).state, 'VERIFIED');
  // Le téléphone passe sur le Wi-Fi de B (même plan d'adressage, autre IP) : nouvelle clé → nouvelle preuve.
  state.wifi = { gateway: '10.10.10.1', ipAddress: '10.10.10.99' };
  state.physical = 'B';
  const afterSwitch = await resolver.resolve('A');
  assert.equal(afterSwitch.state, 'MISMATCH');
  assert.equal(state.reads, 2);
  // Même clé mais le routeur physique change (reconnexion) : invalidate() force la re-preuve.
  state.physical = 'A';
  resolver.invalidate();
  assert.equal((await resolver.resolve('A')).state, 'VERIFIED');
  assert.equal(state.reads, 3);
});

test('NO_CREDS : routeur sans identifiants locaux', async () => {
  const { resolver } = setup();
  ROUTERS.C = { identity: 'ROUTER_C', creds: null };
  assert.equal((await resolver.resolve('C')).state, 'NO_CREDS');
});

test('creds exposés UNIQUEMENT si VERIFIED (invariant)', async () => {
  for (const physical of ['A', 'B', null] as const) {
    const { resolver } = setup({ physical });
    for (const id of ['A', 'B']) {
      const r = await resolver.resolve(id);
      assert.equal(r.creds !== null, r.state === 'VERIFIED');
    }
  }
});

test('identités génériques', () => {
  for (const v of ['MikroTik', 'mikrotik', 'RouterOS', 'MikroTik-2', '', '  ', null, undefined]) assert.equal(isGenericIdentity(v), true, String(v));
  for (const v of ['ROUTER_A', 'rb951_BZ_akdo sinacassi_dec_2025', 'FREEDOM HOME']) assert.equal(isGenericIdentity(v), false, v);
});

// ── Preuve d'identité DANS la session qui exécute l'action (jamais un cache de 60 s) ──────────────────────

const fakeClient = (read: () => Promise<string>) => ({ systemIdentity: async () => ({ name: await read() }) });

test("SESSION 1 : identité lue dans la session = attendue → l'action peut s'exécuter", async () => {
  await assert.doesNotReject(verifySessionIdentity(fakeClient(async () => 'ROUTER_A'), 'ROUTER_A'));
});

test('SESSION 2 : identité différente → refus typé, AVANT toute action', async () => {
  await assert.rejects(
    verifySessionIdentity(fakeClient(async () => 'ROUTER_A'), 'ROUTER_B'),
    (e: unknown) => e instanceof LanIdentityMismatchError && e.reason === 'MISMATCH',
  );
});

test('SESSION 3 : identité illisible (timeout) → refus, fail closed', async () => {
  await assert.rejects(
    verifySessionIdentity(fakeClient(async () => { throw new Error('timeout'); }), 'ROUTER_A'),
    (e: unknown) => e instanceof LanIdentityMismatchError && e.reason === 'UNREADABLE',
  );
});

test('SESSION 4 : identité attendue vide ou générique → refus (jamais une preuve)', async () => {
  for (const expected of ['', '  ', 'MikroTik']) {
    await assert.rejects(verifySessionIdentity(fakeClient(async () => expected), expected), LanIdentityMismatchError);
  }
});

test("SESSION 5 : les credentials VERIFIED portent l'identité attendue ; MISMATCH ne rend rien", async () => {
  const a = await setup({ physical: 'A' }).resolver.resolve('A');
  assert.equal(a.state, 'VERIFIED');
  assert.equal(a.creds?.expectedIdentity, 'ROUTER_A');
  const b = await setup({ physical: 'A' }).resolver.resolve('B');
  assert.equal(b.creds, null);
});

test("SESSION 6 (TOCTOU) : preuve A en cache, le téléphone bascule sur B SANS événement réseau → l'action est refusée", async () => {
  const { resolver, state } = setup({ physical: 'A' });
  const proof = await resolver.resolve('A'); // VERIFIED, mis en cache pour 60 s
  assert.equal(proof.state, 'VERIFIED');
  state.physical = 'B'; // même 10.10.10.1, aucune invalidation
  const cached = await resolver.resolve('A');
  assert.equal(cached.state, 'VERIFIED'); // le cache croit encore A…
  let mutated = false;
  await assert.rejects(async () => {
    await verifySessionIdentity(fakeClient(async () => ROUTERS[state.physical as 'A' | 'B'].identity), cached.creds!.expectedIdentity);
    mutated = true; // reboot / push / écriture config
  }, LanIdentityMismatchError);
  assert.equal(mutated, false);
});
