import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKING_SERVER_ERROR_CODES,
  CURRENT_VERSION,
  INTENTION_TTL_MS,
  MAX_INTENTIONS,
  RETRY_AFTER_FALLBACK_S,
  RETRY_AFTER_MAX_S,
  STORAGE_KEY,
  createVoucherIdempotencyRepo,
  intentionFingerprint,
  isBlockingServerError,
  parseRetryAfterSeconds,
  parseStoredBundle,
  type KeyValueStorage,
} from './voucherIdempotency.ts';

const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';
const KEY_C = '33333333-3333-4333-8333-333333333333';
const KEY_D = '44444444-4444-4444-8444-444444444444';
const KEY_E = '55555555-5555-4555-8555-555555555555';
const KEY_F = '66666666-6666-4666-8666-666666666666';

function makeStorage(): KeyValueStorage & { map: Map<string, string>; writes: number } {
  const map = new Map<string, string>();
  const self = {
    map,
    writes: 0,
    async getItem(k: string) {
      return map.has(k) ? (map.get(k) as string) : null;
    },
    async setItem(k: string, v: string) {
      self.writes += 1;
      map.set(k, v);
    },
    async removeItem(k: string) {
      map.delete(k);
    },
  };
  return self;
}

function uuidSeq(...keys: string[]): () => string {
  let i = 0;
  return () => {
    const k = keys[i];
    if (!k) throw new Error('uuidSeq exhausted');
    i += 1;
    return k;
  };
}

const INTENTION = { routerId: 'r1', planId: 'p1', quantity: 3 };
const freshBundle = (entries: Array<[string, Record<string, unknown>]> = []) =>
  JSON.stringify({
    version: CURRENT_VERSION,
    intentions: Object.fromEntries(entries),
    recentOrder: entries.map(([k]) => k),
  });

// ── parseStoredBundle ────────────────────────────────────────────────────

test('parseStoredBundle: EMPTY on null', () => {
  assert.deepEqual(parseStoredBundle(null), { kind: 'EMPTY' });
});

test('parseStoredBundle: CORRUPTED on invalid JSON (no raw content leak)', () => {
  const state = parseStoredBundle('{{{{ not json');
  assert.deepEqual(state, { kind: 'CORRUPTED' });
  // Garantie : rien ne laisse fuiter le contenu brut via le résultat.
  assert.doesNotMatch(JSON.stringify(state), /not json/);
});

test('parseStoredBundle: UNSUPPORTED_VERSION when version differs', () => {
  const raw = JSON.stringify({ version: 999, intentions: {}, recentOrder: [] });
  const state = parseStoredBundle(raw);
  assert.equal(state.kind, 'UNSUPPORTED_VERSION');
});

test('parseStoredBundle: CORRUPTED on missing fields', () => {
  assert.equal(parseStoredBundle(JSON.stringify({ version: CURRENT_VERSION })).kind, 'CORRUPTED');
});

test('parseStoredBundle: CORRUPTED when any stored intention has forbidden extra key', () => {
  const intent = {
    key: KEY_A, routerId: 'r', planId: 'p', quantity: 1,
    createdAt: new Date().toISOString(), secret: 'LEAK',
  };
  const raw = freshBundle([[intentionFingerprint({ routerId: 'r', planId: 'p', quantity: 1 }), intent]]);
  assert.equal(parseStoredBundle(raw).kind, 'CORRUPTED');
});

// ── ensureKeyFor ─────────────────────────────────────────────────────────

test('ensureKeyFor: EMPTY → creates a fresh key on first call', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  const r = await repo.ensureKeyFor(INTENTION);
  assert.equal(r.kind, 'VALID');
  if (r.kind === 'VALID') assert.equal(r.intention.key, KEY_A);
});

test('ensureKeyFor: identical intention reuses the same key (retry after timeout/202)', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A, KEY_B));
  const r1 = await repo.ensureKeyFor(INTENTION);
  const r2 = await repo.ensureKeyFor(INTENTION);
  assert.equal(r1.kind, 'VALID');
  assert.equal(r2.kind, 'VALID');
  if (r1.kind === 'VALID' && r2.kind === 'VALID') assert.equal(r1.intention.key, r2.intention.key);
});

test('ensureKeyFor: TTL expired returns EXPIRED, no automatic new key', async () => {
  const storage = makeStorage();
  const createdAt = new Date(Date.now() - INTENTION_TTL_MS - 10_000).toISOString();
  const intent = { key: KEY_A, routerId: 'r1', planId: 'p1', quantity: 3, createdAt };
  await storage.setItem(STORAGE_KEY, freshBundle([[intentionFingerprint(INTENTION), intent]]));
  const beforeWrites = storage.writes;
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_B));
  const r = await repo.ensureKeyFor(INTENTION);
  assert.equal(r.kind, 'EXPIRED');
  assert.equal(storage.writes, beforeWrites, 'EXPIRED must not write');
});

test('ensureKeyFor: CORRUPTED bundle returns CORRUPTED, no new key generated', async () => {
  const storage = makeStorage();
  await storage.setItem(STORAGE_KEY, '{{{ corrupt');
  const writesBefore = storage.writes;
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  const r = await repo.ensureKeyFor(INTENTION);
  assert.equal(r.kind, 'CORRUPTED');
  assert.equal(storage.writes, writesBefore, 'CORRUPTED must not write');
});

test('ensureKeyFor: UNSUPPORTED_VERSION bundle returns that state, no new key', async () => {
  const storage = makeStorage();
  await storage.setItem(STORAGE_KEY, JSON.stringify({ version: 42, intentions: {}, recentOrder: [] }));
  const writesBefore = storage.writes;
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  const r = await repo.ensureKeyFor(INTENTION);
  assert.equal(r.kind, 'UNSUPPORTED_VERSION');
  assert.equal(storage.writes, writesBefore);
});

test('ensureKeyFor: changing router does NOT destroy the previous ambiguous intention', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A, KEY_B));
  await repo.ensureKeyFor(INTENTION);
  await repo.ensureKeyFor({ ...INTENTION, routerId: 'r2' });
  const state = await repo.inspect();
  assert.equal(state.kind, 'LOADED');
  if (state.kind === 'LOADED') assert.equal(Object.keys(state.intentions).length, 2);
});

test('ensureKeyFor: changing plan does NOT destroy the previous ambiguous intention', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A, KEY_B));
  await repo.ensureKeyFor(INTENTION);
  await repo.ensureKeyFor({ ...INTENTION, planId: 'p2' });
  const state = await repo.inspect();
  assert.equal(state.kind, 'LOADED');
  if (state.kind === 'LOADED') assert.equal(Object.keys(state.intentions).length, 2);
});

test('ensureKeyFor: changing quantity does NOT destroy the previous ambiguous intention', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A, KEY_B));
  await repo.ensureKeyFor(INTENTION);
  await repo.ensureKeyFor({ ...INTENTION, quantity: 5 });
  const state = await repo.inspect();
  assert.equal(state.kind, 'LOADED');
  if (state.kind === 'LOADED') assert.equal(Object.keys(state.intentions).length, 2);
});

test('ensureKeyFor: MAX_INTENTIONS reached → LIMIT_REACHED, no new write', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A, KEY_B, KEY_C, KEY_D, KEY_E, KEY_F));
  for (let i = 0; i < MAX_INTENTIONS; i++) {
    await repo.ensureKeyFor({ ...INTENTION, quantity: i + 1 });
  }
  const writesBefore = storage.writes;
  const r = await repo.ensureKeyFor({ ...INTENTION, quantity: 99 });
  assert.equal(r.kind, 'LIMIT_REACHED');
  if (r.kind === 'LIMIT_REACHED') assert.equal(r.count, MAX_INTENTIONS);
  assert.equal(storage.writes, writesBefore, 'LIMIT_REACHED must not write');
});

test('ensureKeyFor: UUID generator producing non-v4 UUID is rejected (defensive)', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, () => 'not-a-uuid');
  await assert.rejects(() => repo.ensureKeyFor(INTENTION), /UUID v4/);
});

// ── attachBatchId / updateLanProgress / clearIfTerminal / forceClear ─────

test('attachBatchId: writes under matching key', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  const r = await repo.ensureKeyFor(INTENTION);
  assert.equal(r.kind, 'VALID');
  await repo.attachBatchId(KEY_A, 'batch-7');
  const lookup = await repo.lookup(INTENTION);
  assert.equal(lookup.kind, 'VALID');
  if (lookup.kind === 'VALID') assert.equal(lookup.intention.batchId, 'batch-7');
});

test('updateLanProgress: persists expected/confirmed (no voucher code)', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  await repo.ensureKeyFor(INTENTION);
  await repo.updateLanProgress(KEY_A, { expectedCount: 20, confirmedCount: 14 });
  const persisted = storage.map.get(STORAGE_KEY) ?? '';
  assert.match(persisted, /"expectedCount":20/);
  assert.match(persisted, /"confirmedCount":14/);
  assert.doesNotMatch(persisted, /voucher.{0,4}code|password|token|credential/i);
});

test('clearIfTerminal: LAN partial (14/20) keeps the key', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  await repo.ensureKeyFor(INTENTION);
  await repo.updateLanProgress(KEY_A, { expectedCount: 20, confirmedCount: 14 });
  const cleared = await repo.clearIfTerminal(KEY_A);
  assert.equal(cleared, false);
  const lookup = await repo.lookup(INTENTION);
  assert.equal(lookup.kind, 'VALID');
});

test('clearIfTerminal: LAN full confirmation (20/20) clears', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  await repo.ensureKeyFor(INTENTION);
  await repo.updateLanProgress(KEY_A, { expectedCount: 20, confirmedCount: 20 });
  const cleared = await repo.clearIfTerminal(KEY_A);
  assert.equal(cleared, true);
  const lookup = await repo.lookup(INTENTION);
  assert.equal(lookup.kind, 'EMPTY');
});

test('clearIfTerminal: REMOTE (no lan progress) clears on any terminal call', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  await repo.ensureKeyFor(INTENTION);
  const cleared = await repo.clearIfTerminal(KEY_A);
  assert.equal(cleared, true);
});

test('forceClear: unconditional removal (operator acknowledgement)', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  await repo.ensureKeyFor(INTENTION);
  await repo.updateLanProgress(KEY_A, { expectedCount: 20, confirmedCount: 1 });
  await repo.forceClear(KEY_A);
  const lookup = await repo.lookup(INTENTION);
  assert.equal(lookup.kind, 'EMPTY');
});

test('restoration after simulated app restart yields the same intention', async () => {
  const storage = makeStorage();
  const repoA = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  const first = await repoA.ensureKeyFor(INTENTION);
  const repoB = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_B));
  const restored = await repoB.lookup(INTENTION);
  assert.equal(restored.kind, 'VALID');
  if (first.kind === 'VALID' && restored.kind === 'VALID') {
    assert.equal(first.intention.key, restored.intention.key);
  }
});

// ── Synchronous double-submit guard ──────────────────────────────────────

test('synchronous double call: single key, single storage write', async () => {
  // Reproduit la garde qu'implémente le screen : un useRef verrou fait tourner
  // le SECOND appel vers un no-op. On vérifie ici qu'ensureKeyFor + une garde
  // triviale produisent exactement UNE écriture.
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A, KEY_B));
  let locked = false;
  async function guardedEnsure() {
    if (locked) return null;
    locked = true;
    try {
      return await repo.ensureKeyFor(INTENTION);
    } finally {
      locked = false;
    }
  }
  const [r1, r2] = await Promise.all([guardedEnsure(), guardedEnsure()]);
  // Exactement un appel a fait l'écriture.
  assert.equal(storage.writes, 1);
  // Le second est reparti immédiatement (null) ou a retrouvé la même clé.
  const keys = [r1, r2].filter(Boolean).map((x) => (x?.kind === 'VALID' ? x.intention.key : null));
  assert.ok(keys.includes(KEY_A));
  assert.ok(!keys.includes(KEY_B), 'KEY_B must not have been consumed');
});

// ── parseRetryAfterSeconds ───────────────────────────────────────────────

test('parseRetryAfterSeconds: valid integer within bounds', () => {
  assert.equal(parseRetryAfterSeconds('5'), 5);
});

test('parseRetryAfterSeconds: null / missing → fallback', () => {
  assert.equal(parseRetryAfterSeconds(null), RETRY_AFTER_FALLBACK_S);
  assert.equal(parseRetryAfterSeconds(undefined), RETRY_AFTER_FALLBACK_S);
});

test('parseRetryAfterSeconds: empty → fallback', () => {
  assert.equal(parseRetryAfterSeconds('   '), RETRY_AFTER_FALLBACK_S);
});

test('parseRetryAfterSeconds: non-numeric → fallback', () => {
  assert.equal(parseRetryAfterSeconds('later'), RETRY_AFTER_FALLBACK_S);
});

test('parseRetryAfterSeconds: negative → fallback', () => {
  assert.equal(parseRetryAfterSeconds('-5'), RETRY_AFTER_FALLBACK_S);
});

test('parseRetryAfterSeconds: zero or fractional → fallback', () => {
  assert.equal(parseRetryAfterSeconds('0'), RETRY_AFTER_FALLBACK_S);
  assert.equal(parseRetryAfterSeconds('1.5'), RETRY_AFTER_FALLBACK_S);
});

test('parseRetryAfterSeconds: excessive value clamped to max', () => {
  assert.equal(parseRetryAfterSeconds('99999'), RETRY_AFTER_MAX_S);
});

// ── Blocking error codes ─────────────────────────────────────────────────

test('isBlockingServerError: VOUCHER_GENERATION_STALE and VOUCHER_REPLAY_SNAPSHOT_MISSING', () => {
  assert.equal(isBlockingServerError('VOUCHER_GENERATION_STALE'), true);
  assert.equal(isBlockingServerError('VOUCHER_REPLAY_SNAPSHOT_MISSING'), true);
  assert.equal(isBlockingServerError('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'), false);
  assert.equal(isBlockingServerError(undefined), false);
  assert.equal(isBlockingServerError(null), false);
  assert.ok(BLOCKING_SERVER_ERROR_CODES.has('VOUCHER_GENERATION_STALE'));
  assert.ok(BLOCKING_SERVER_ERROR_CODES.has('VOUCHER_REPLAY_SNAPSHOT_MISSING'));
});

// ── Anti-leak (no raw key in logs-serializable payload) ──────────────────

test('stored payload contains no password, token, credential, or voucher code', async () => {
  const storage = makeStorage();
  const repo = createVoucherIdempotencyRepo(storage, uuidSeq(KEY_A));
  await repo.ensureKeyFor(INTENTION);
  await repo.attachBatchId(KEY_A, 'batch-x');
  await repo.updateLanProgress(KEY_A, { expectedCount: 2, confirmedCount: 1 });
  const persisted = storage.map.get(STORAGE_KEY) ?? '';
  assert.doesNotMatch(persisted, /password/i);
  assert.doesNotMatch(persisted, /token/i);
  assert.doesNotMatch(persisted, /credential/i);
  assert.doesNotMatch(persisted, /voucher.{0,6}code/i);
});
