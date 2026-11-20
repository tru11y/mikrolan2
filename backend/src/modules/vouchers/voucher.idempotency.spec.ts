import { HttpStatus, Logger } from '@nestjs/common';
import {
  ManagementMode,
  Prisma,
  VoucherBatchStatus,
  VoucherStatus,
} from '@prisma/client';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { addHotspotUser } from '../../common/routeros/hotspot.ops';
import { ErrorCode } from '../../common/error-codes';
import { BusinessException } from '../../common/exceptions/business.exception';
import { VoucherService } from './voucher.service';
import {
  canonicalFingerprint,
  hashIdempotencyKey,
  isIdempotencyConstraintViolation,
  isStaleGenerating,
  parseLanPushParamsSnapshot,
  STALE_GENERATING_THRESHOLD_MS,
  IDEMPOTENCY_UNIQUE_INDEX_NAME,
} from './voucher-idempotency';
import { extractIdempotencyKey } from '../../common/decorators/idempotency-key.decorator';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'ADMIN' })),
}));

jest.mock('../../common/routeros/hotspot.ops', () => ({
  addHotspotUser: jest.fn(),
  ensureUserProfile: jest.fn().mockResolvedValue(undefined),
  removeHotspotUser: jest.fn().mockResolvedValue(undefined),
}));

const KEY = '11111111-1111-4111-8111-111111111111';
const OTHER_KEY = '22222222-2222-4222-8222-222222222222';
const UUID_V1 = '3b58b0a0-c2ab-11ee-8c99-0242ac120002'; // version digit `1` → refusé

const VALID_LAN_SNAPSHOT = {
  userProfile: 'p1',
  limitUptime: '60m',
  comment: 'mikrolan:batch-x',
};

const PLAN = {
  id: 'plan-1',
  userProfile: 'p1',
  durationMinutes: 60,
  dataLimitMb: null,
  downloadKbps: null,
  uploadKbps: null,
  sharedUsers: 1,
  codePrefix: null,
  codeLength: 8,
  codeFormat: 'ALPHANUMERIC' as const,
};

function voucherRow(batchId: string, i: number, mikrotikId: string | null) {
  return {
    id: `${batchId}-v${i}`,
    code: `C${batchId}${i}`,
    password: `C${batchId}${i}`,
    status: VoucherStatus.GENERATED,
    planId: 'plan-1',
    routerId: 'router-1',
    batchId,
    mikrotikId,
    expiresAt: null,
    usedAt: null,
    createdAt: new Date(),
  };
}

function makePrisma(overrides: Record<string, any> = {}) {
  const base = {
    router: {
      findFirst: jest.fn().mockResolvedValue({ id: 'router-1', mode: ManagementMode.LOCAL }),
    },
    plan: { findFirst: jest.fn().mockResolvedValue(PLAN) },
    remotePeer: { findFirst: jest.fn().mockResolvedValue(null) },
    voucher: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    voucherBatch: {
      findFirst: jest.fn(),
      // Re-lecture par id en fin de flux normal (par id, non composite).
      findUnique: jest.fn().mockResolvedValue({ status: 'GENERATING', generated: 0 }),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return { ...base, ...overrides };
}

function makeService(prisma: any, remote: any = { run: jest.fn() }) {
  return new VoucherService(prisma, remote, makeEventLogStub() as any, { get: () => false } as any);
}

describe('canonicalFingerprint — JSON canonicalisation stable', () => {
  const INPUT = { tenantId: 't', routerId: 'r', planId: 'p', quantity: 5 };

  it('is deterministic across calls', () => {
    expect(canonicalFingerprint(INPUT)).toBe(canonicalFingerprint(INPUT));
  });

  it('is based on a positional JSON tuple, not a free-form object', () => {
    // Le format figé est documenté : si un contributeur le modifie, ce test rend
    // visible la rupture du contrat persistant de `requestFingerprint`.
    const { createHash } = require('node:crypto');
    const expected = createHash('sha256').update(JSON.stringify(['t', 'r', 'p', 5])).digest('hex');
    expect(canonicalFingerprint(INPUT)).toBe(expected);
  });

  it('changes when any field changes', () => {
    const base = canonicalFingerprint(INPUT);
    expect(canonicalFingerprint({ ...INPUT, quantity: 6 })).not.toBe(base);
    expect(canonicalFingerprint({ ...INPUT, planId: 'p2' })).not.toBe(base);
    expect(canonicalFingerprint({ ...INPUT, routerId: 'r2' })).not.toBe(base);
    expect(canonicalFingerprint({ ...INPUT, tenantId: 't2' })).not.toBe(base);
  });

  it('is not spoofable by concatenating fields', () => {
    // JSON échappe les crochets et virgules → aucune collision possible par
    // concaténation volontaire d'un champ textuel.
    const a = canonicalFingerprint({ tenantId: 'a', routerId: 'b","c', planId: 'x', quantity: 1 });
    const b = canonicalFingerprint({ tenantId: 'a', routerId: 'b', planId: 'c","x', quantity: 1 });
    expect(a).not.toBe(b);
  });

  it('distinguishes a numeric quantity from its string form', () => {
    const num = canonicalFingerprint(INPUT);
    const str = canonicalFingerprint({ ...INPUT, quantity: '5' as unknown as number });
    expect(num).not.toBe(str);
  });
});

describe('hashIdempotencyKey — truncated non-reversible', () => {
  it('returns a 16-hex-char digest, never the raw key', () => {
    const h = hashIdempotencyKey(KEY);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain(KEY);
  });
});

describe('isStaleGenerating — threshold is 1 hour', () => {
  it('considers fresh batches not stale', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    const createdAt = new Date(now.getTime() - 30 * 60_000);
    expect(isStaleGenerating(createdAt, now)).toBe(false);
  });
  it('considers batches older than 1h stale', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    const createdAt = new Date(now.getTime() - STALE_GENERATING_THRESHOLD_MS - 1);
    expect(isStaleGenerating(createdAt, now)).toBe(true);
  });
});

describe('parseLanPushParamsSnapshot — fail-closed validator', () => {
  const VALID = { userProfile: 'p', limitUptime: '60m', comment: 'mikrolan:x' };

  it('accepts a minimal valid snapshot', () => {
    expect(parseLanPushParamsSnapshot(VALID)).toEqual(VALID);
  });

  it('accepts all optional fields with correct types', () => {
    const full = { ...VALID, rateLimit: '128k/128k', sharedUsers: 2, limitBytesTotal: 1024 };
    expect(parseLanPushParamsSnapshot(full)).toEqual(full);
  });

  it('rejects null / undefined / primitives / arrays', () => {
    expect(parseLanPushParamsSnapshot(null)).toBeNull();
    expect(parseLanPushParamsSnapshot(undefined)).toBeNull();
    expect(parseLanPushParamsSnapshot('x')).toBeNull();
    expect(parseLanPushParamsSnapshot(42)).toBeNull();
    expect(parseLanPushParamsSnapshot([])).toBeNull();
  });

  it('rejects an object with any forbidden key (credential, token, password, code, …)', () => {
    expect(parseLanPushParamsSnapshot({ ...VALID, password: 'leak' })).toBeNull();
    expect(parseLanPushParamsSnapshot({ ...VALID, token: 'leak' })).toBeNull();
    expect(parseLanPushParamsSnapshot({ ...VALID, apiKey: 'leak' })).toBeNull();
    expect(parseLanPushParamsSnapshot({ ...VALID, code: 'leak' })).toBeNull();
    expect(parseLanPushParamsSnapshot({ ...VALID, extra: 'x' })).toBeNull();
  });

  it('rejects missing required fields', () => {
    expect(parseLanPushParamsSnapshot({ limitUptime: '60m', comment: 'x' })).toBeNull();
    expect(parseLanPushParamsSnapshot({ userProfile: 'p', comment: 'x' })).toBeNull();
    expect(parseLanPushParamsSnapshot({ userProfile: 'p', limitUptime: '60m' })).toBeNull();
  });

  it('rejects wrong types on known fields', () => {
    expect(parseLanPushParamsSnapshot({ ...VALID, sharedUsers: '2' })).toBeNull();
    expect(parseLanPushParamsSnapshot({ ...VALID, limitBytesTotal: '1024' })).toBeNull();
    expect(parseLanPushParamsSnapshot({ ...VALID, rateLimit: 42 })).toBeNull();
  });
});

describe('isIdempotencyConstraintViolation — narrow P2002 to our index only', () => {
  it('matches the literal index name', () => {
    expect(isIdempotencyConstraintViolation({ target: IDEMPOTENCY_UNIQUE_INDEX_NAME })).toBe(true);
  });
  it('matches the target as an array of field names', () => {
    expect(isIdempotencyConstraintViolation({ target: ['tenantId', 'clientRequestId'] })).toBe(true);
    expect(isIdempotencyConstraintViolation({ target: ['clientRequestId', 'tenantId'] })).toBe(true);
  });
  it('matches the target as a comma-separated string', () => {
    expect(isIdempotencyConstraintViolation({ target: 'tenantId,clientRequestId' })).toBe(true);
  });
  it('does not match another unique constraint (e.g. Voucher.code)', () => {
    expect(isIdempotencyConstraintViolation({ target: ['tenantId', 'code'] })).toBe(false);
    expect(isIdempotencyConstraintViolation({ target: 'Voucher_tenantId_code_key' })).toBe(false);
  });
  it('is defensive against missing or malformed meta', () => {
    expect(isIdempotencyConstraintViolation(undefined)).toBe(false);
    expect(isIdempotencyConstraintViolation({})).toBe(false);
    expect(isIdempotencyConstraintViolation({ target: 42 })).toBe(false);
  });
});

describe('VoucherService.generate — idempotency (B-01)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('legacy flow unchanged when no Idempotency-Key is passed', async () => {
    const prisma = makePrisma();
    prisma.voucherBatch.create.mockResolvedValue({ id: 'b-legacy', seq: 1 });
    prisma.voucher.findMany.mockResolvedValue([voucherRow('b-legacy', 0, null)]);
    prisma.voucherBatch.findUnique.mockResolvedValue({ status: 'GENERATING', generated: 0 });
    const service = makeService(prisma);

    await service.generate('router-1', { planId: 'plan-1', quantity: 1 } as any /* no key */);

    // Legacy path : aucune lecture par clientRequestId (le lookup d'idempotence
    // ne doit pas être effectué si le header est absent).
    for (const call of prisma.voucherBatch.findFirst.mock.calls) {
      expect(call[0]?.where?.clientRequestId).toBeUndefined();
    }
    const createCall = prisma.voucherBatch.create.mock.calls[0][0];
    expect(createCall.data.clientRequestId).toBeNull();
    expect(createCall.data.requestFingerprint).toBeNull();
    expect(createCall.data.pushedByServer).toBe(false);
  });

  it('writes clientRequestId, requestFingerprint and pushedByServer=true snapshot on REMOTE+peer', async () => {
    const prisma = makePrisma({
      router: { findFirst: jest.fn().mockResolvedValue({ id: 'router-1', mode: ManagementMode.REMOTE }) },
      remotePeer: { findFirst: jest.fn().mockResolvedValue({ id: 'peer-1' }) },
    });
    prisma.voucherBatch.findFirst.mockResolvedValueOnce(null); // lookup idempotence
    prisma.voucherBatch.create.mockResolvedValue({ id: 'b-new', seq: 2 });
    prisma.voucherBatch.findUnique.mockResolvedValue({ status: 'GENERATING', generated: 0 }); // re-lecture par id
    const service = makeService(prisma);

    await service.generate('router-1', { planId: 'plan-1', quantity: 1 } as any, KEY);

    const createCall = prisma.voucherBatch.create.mock.calls[0][0];
    expect(createCall.data.clientRequestId).toBe(KEY);
    expect(typeof createCall.data.requestFingerprint).toBe('string');
    expect(createCall.data.requestFingerprint).toHaveLength(64);
    expect(createCall.data.pushedByServer).toBe(true);
  });

  it('does NOT generate codes before voucherBatch.create (loser path proof)', async () => {
    // Simule la course perdue : le batch existe déjà au moment du lookup.
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 2 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-winner', seq: 9, status: VoucherBatchStatus.COMPLETED, generated: 2, quantity: 2,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: false,
      pushParamsSnapshot: VALID_LAN_SNAPSHOT,
    });
    const voucherFindManySpy = prisma.voucher.findMany;
    const service = makeService(prisma);

    await service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any, KEY);

    // L'implémentation de `uniqueCodes` appelle `prisma.voucher.findMany` pour
    // écarter les collisions. Après le replay, le SEUL findMany acceptable est
    // celui qui lit les vouchers du batch gagnant (pas de génération de codes).
    const calls = voucherFindManySpy.mock.calls;
    for (const [args] of calls) {
      expect(args?.where?.batchId).toBe('b-winner');
    }
    expect(prisma.voucherBatch.create).not.toHaveBeenCalled();
    expect(prisma.voucher.createMany).not.toHaveBeenCalled();
  });

  it('replays a COMPLETED batch without createMany, without RouterOS and WITHOUT push params', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 2 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-done', seq: 9, status: VoucherBatchStatus.COMPLETED, generated: 2, quantity: 2,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: true, pushParamsSnapshot: null,
    });
    prisma.voucher.findMany.mockResolvedValue([voucherRow('b-done', 0, '*1'), voucherRow('b-done', 1, '*2')]);
    const service = makeService(prisma);

    const result = (await service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any, KEY)) as any;

    expect(prisma.voucher.createMany).not.toHaveBeenCalled();
    expect(prisma.voucherBatch.create).not.toHaveBeenCalled();
    expect(addHotspotUser as jest.Mock).not.toHaveBeenCalled();
    expect(result.__replay).toBe('terminal');
    expect(result.batchId).toBe('b-done');
    expect(result.batchStatus).toBe(VoucherBatchStatus.COMPLETED);
    expect(result.pushedByServer).toBe(true); // snapshot persisté
    expect(result.push).toBeUndefined(); // jamais recalculé depuis Plan
    expect(result.vouchers).toHaveLength(2);
  });

  it('replay with pushedByServer=false returns the persisted LAN snapshot, not the current plan', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 1 });
    // Le router EST actuellement REMOTE avec peer actif, mais le batch a été
    // créé en LAN : le snapshot doit l'emporter.
    const stalePushParams = {
      userProfile: 'old-profile',
      limitUptime: '30m',
      sharedUsers: 2,
      limitBytesTotal: 1024 * 1024,
      comment: 'mikrolan:b-lan',
    };
    const prisma = makePrisma({
      router: { findFirst: jest.fn().mockResolvedValue({ id: 'router-1', mode: ManagementMode.REMOTE }) },
      remotePeer: { findFirst: jest.fn().mockResolvedValue({ id: 'peer-current' }) },
      plan: { findFirst: jest.fn().mockResolvedValue({ ...PLAN, userProfile: 'NEW-profile', durationMinutes: 999 }) },
    });
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-lan', seq: 20, status: VoucherBatchStatus.COMPLETED, generated: 1, quantity: 1,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: false,
      pushParamsSnapshot: stalePushParams,
    });
    prisma.voucher.findMany.mockResolvedValue([voucherRow('b-lan', 0, null)]);
    const service = makeService(prisma);
    const result = (await service.generate('router-1', { planId: 'plan-1', quantity: 1 } as any, KEY)) as any;
    expect(result.pushedByServer).toBe(false);
    expect(result.push).toEqual(stalePushParams);
    // Garantie : le Plan courant a été lu (findFirst) mais ses valeurs mutantes
    // ne doivent PAS apparaître dans la réponse.
    expect(result.push.userProfile).not.toBe('NEW-profile');
    expect(result.push.limitUptime).not.toBe('999m');
  });

  it('replay LAN without persisted snapshot → 409 VOUCHER_REPLAY_SNAPSHOT_MISSING (fail-closed)', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 1 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-nosnap', seq: 21, status: VoucherBatchStatus.COMPLETED, generated: 1, quantity: 1,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: false,
      pushParamsSnapshot: null,
    });
    const service = makeService(prisma);
    await expect(
      service.generate('router-1', { planId: 'plan-1', quantity: 1 } as any, KEY),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.VOUCHER_REPLAY_SNAPSHOT_MISSING,
      status: HttpStatus.CONFLICT,
    } as any);
  });

  it('replay LAN with corrupted snapshot (extra forbidden key) → 409', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 1 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-corrupt', seq: 22, status: VoucherBatchStatus.COMPLETED, generated: 1, quantity: 1,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: false,
      pushParamsSnapshot: { userProfile: 'p1', limitUptime: '60m', comment: 'x', password: 'LEAK' },
    });
    const service = makeService(prisma);
    await expect(
      service.generate('router-1', { planId: 'plan-1', quantity: 1 } as any, KEY),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.VOUCHER_REPLAY_SNAPSHOT_MISSING,
    } as any);
  });

  it('replay of a legacy batch with pushedByServer=null → 409 (conservative)', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 1 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-legacy', seq: 23, status: VoucherBatchStatus.COMPLETED, generated: 1, quantity: 1,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: null,
      pushParamsSnapshot: null,
    });
    const service = makeService(prisma);
    await expect(
      service.generate('router-1', { planId: 'plan-1', quantity: 1 } as any, KEY),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.VOUCHER_REPLAY_SNAPSHOT_MISSING,
    } as any);
  });

  it('REMOTE replay with pushedByServer=true never reads the snapshot (push undefined)', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 2 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-remote', seq: 24, status: VoucherBatchStatus.COMPLETED, generated: 2, quantity: 2,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: true,
      pushParamsSnapshot: null, // REMOTE : snapshot est intentionnellement absent
    });
    prisma.voucher.findMany.mockResolvedValue([voucherRow('b-remote', 0, '*1'), voucherRow('b-remote', 1, '*2')]);
    const service = makeService(prisma);
    const result = (await service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any, KEY)) as any;
    expect(result.pushedByServer).toBe(true);
    expect(result.push).toBeUndefined();
  });

  it('create persists a LAN snapshot free of forbidden keys', async () => {
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce(null);
    prisma.voucherBatch.create.mockResolvedValue({ id: 'b-new', seq: 2 });
    prisma.voucherBatch.findUnique.mockResolvedValue({ status: 'GENERATING', generated: 0 });
    const service = makeService(prisma);
    await service.generate('router-1', { planId: 'plan-1', quantity: 1 } as any, KEY);
    const createCall = prisma.voucherBatch.create.mock.calls[0][0];
    const snap = createCall.data.pushParamsSnapshot;
    // LAN → snapshot persisté sous forme d'objet
    expect(typeof snap).toBe('object');
    expect(snap).not.toBeNull();
    const keys = Object.keys(snap);
    expect(keys.every((k) => ['userProfile', 'rateLimit', 'sharedUsers', 'limitUptime', 'limitBytesTotal', 'comment'].includes(k))).toBe(true);
    // Aucun secret, credential ou code dans le snapshot.
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toMatch(/password|token|credential|apiKey|code/i);
  });

  it('replays a PARTIAL_SUCCESS batch without re-pushing', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 5 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-partial', seq: 10, status: VoucherBatchStatus.PARTIAL_SUCCESS, generated: 3, quantity: 5,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: true, pushParamsSnapshot: null,
    });
    const service = makeService(prisma);
    const result = (await service.generate('router-1', { planId: 'plan-1', quantity: 5 } as any, KEY)) as any;
    expect(result.batchStatus).toBe(VoucherBatchStatus.PARTIAL_SUCCESS);
    expect(result.pushedCount).toBe(3);
    expect(prisma.voucher.createMany).not.toHaveBeenCalled();
    expect(addHotspotUser as jest.Mock).not.toHaveBeenCalled();
  });

  it('replays a FAILED batch with status FAILED (no new generation)', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 1 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      // FAILED initial n'arrive qu'en REMOTE (le chemin LAN reste GENERATING
      // jusqu'au confirmPush). On teste donc le replay REMOTE FAILED.
      id: 'b-fail', seq: 11, status: VoucherBatchStatus.FAILED, generated: 0, quantity: 1,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: true, pushParamsSnapshot: null,
    });
    const service = makeService(prisma);
    const result = (await service.generate('router-1', { planId: 'plan-1', quantity: 1 } as any, KEY)) as any;
    expect(result.batchStatus).toBe(VoucherBatchStatus.FAILED);
    expect(result.pushedCount).toBe(0);
    expect(prisma.voucher.createMany).not.toHaveBeenCalled();
  });

  it('returns the in-progress marker for a recent GENERATING batch', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 2 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-inflight', seq: 12, status: VoucherBatchStatus.GENERATING, generated: 0, quantity: 2,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: true, pushParamsSnapshot: null,
    });
    const service = makeService(prisma);
    const result = (await service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any, KEY)) as any;
    expect(result.__replay).toBe('in_progress');
    expect(result.batchStatus).toBe(VoucherBatchStatus.GENERATING);
    expect(result.retryAfterSec).toBeGreaterThan(0);
    expect(prisma.voucher.createMany).not.toHaveBeenCalled();
  });

  it('throws VOUCHER_GENERATION_STALE for an old GENERATING batch', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 2 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-stale', seq: 13, status: VoucherBatchStatus.GENERATING, generated: 0, quantity: 2,
      createdAt: new Date(Date.now() - STALE_GENERATING_THRESHOLD_MS - 10_000),
      requestFingerprint: fp, pushedByServer: true, pushParamsSnapshot: null,
    });
    const service = makeService(prisma);
    await expect(
      service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any, KEY),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.VOUCHER_GENERATION_STALE,
      status: HttpStatus.CONFLICT,
    } as any);
  });

  it('throws IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD on fingerprint mismatch', async () => {
    const otherFp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-2', quantity: 2 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-x', seq: 14, status: VoucherBatchStatus.COMPLETED, generated: 2, quantity: 2,
      createdAt: new Date(), requestFingerprint: otherFp, pushedByServer: true, pushParamsSnapshot: null,
    });
    const service = makeService(prisma);
    await expect(
      service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any, KEY),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD,
      status: HttpStatus.CONFLICT,
    } as any);
    expect(prisma.voucher.createMany).not.toHaveBeenCalled();
  });

  it('on P2002 for the idempotency index, re-reads the winner batch and returns a replay without side-effects', async () => {
    const fp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-1', quantity: 2 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce(null);
    prisma.voucherBatch.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint violation', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['tenantId', 'clientRequestId'] },
      } as any),
    );
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-winner', seq: 15, status: VoucherBatchStatus.GENERATING, generated: 0, quantity: 2,
      createdAt: new Date(), requestFingerprint: fp, pushedByServer: false, pushParamsSnapshot: VALID_LAN_SNAPSHOT,
    });
    const service = makeService(prisma);

    const result = (await service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any, KEY)) as any;

    expect(result.__replay).toBe('in_progress');
    expect(result.batchId).toBe('b-winner');
    expect(prisma.voucher.createMany).not.toHaveBeenCalled();
    expect(addHotspotUser as jest.Mock).not.toHaveBeenCalled();
  });

  it('P2002 unrelated to the idempotency index is rethrown (no false replay)', async () => {
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce(null);
    const otherP2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint violation', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['tenantId', 'code'] }, // violation sur Voucher, pas sur l'idempotence
    } as any);
    prisma.voucherBatch.create.mockRejectedValueOnce(otherP2002);
    const service = makeService(prisma);
    await expect(
      service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any, KEY),
    ).rejects.toBe(otherP2002);
    // On ne doit JAMAIS avoir consulté le batch gagnant pour une violation
    // sans rapport : au plus un findUnique optimiste initial (null).
    expect(prisma.voucherBatch.findFirst).toHaveBeenCalledTimes(1);
  });

  it('never logs the raw idempotency key', async () => {
    const otherFp = canonicalFingerprint({ tenantId: 'tenant-1', routerId: 'router-1', planId: 'plan-2', quantity: 2 });
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValueOnce({
      id: 'b-x', seq: 14, status: VoucherBatchStatus.COMPLETED, generated: 2, quantity: 2,
      createdAt: new Date(), requestFingerprint: otherFp, pushedByServer: true, pushParamsSnapshot: null,
    });
    const service = makeService(prisma);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      await service
        .generate('router-1', { planId: 'plan-1', quantity: 2 } as any, KEY)
        .catch(() => undefined);
      for (const call of warnSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(KEY);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('extractIdempotencyKey — HTTP header parsing', () => {
  it('accepts a well-formed UUID v4', () => {
    expect(extractIdempotencyKey({ 'idempotency-key': KEY })).toBe(KEY);
  });

  it('returns undefined when the header is missing', () => {
    expect(extractIdempotencyKey({})).toBeUndefined();
    expect(extractIdempotencyKey(undefined)).toBeUndefined();
  });

  it('is case-insensitive via Fastify normalisation (always lowercase key)', () => {
    // Fastify lowercases header names before reaching the handler. On ne
    // vérifie donc QUE la clé minuscule — document le contrat Fastify.
    expect(extractIdempotencyKey({ 'idempotency-key': KEY })).toBe(KEY);
  });

  it('treats a whitespace-only header as absent', () => {
    expect(extractIdempotencyKey({ 'idempotency-key': '   ' })).toBeUndefined();
  });

  it('rejects a UUID v1', () => {
    expect(() => extractIdempotencyKey({ 'idempotency-key': UUID_V1 })).toThrow(BusinessException);
  });

  it('rejects a malformed UUID', () => {
    expect(() => extractIdempotencyKey({ 'idempotency-key': 'not-a-uuid' })).toThrow(BusinessException);
  });

  it('rejects a value exceeding the max length', () => {
    expect(() => extractIdempotencyKey({ 'idempotency-key': 'a'.repeat(65) })).toThrow(BusinessException);
  });

  it('rejects a duplicated header expressed as an array', () => {
    expect(() =>
      extractIdempotencyKey({ 'idempotency-key': [KEY, OTHER_KEY] as any }),
    ).toThrow(BusinessException);
  });

  it('rejects a duplicated header concatenated with a comma (Fastify fallback)', () => {
    expect(() =>
      extractIdempotencyKey({ 'idempotency-key': `${KEY}, ${OTHER_KEY}` }),
    ).toThrow(BusinessException);
  });

  it('rejects unexpected non-string types defensively', () => {
    expect(() =>
      extractIdempotencyKey({ 'idempotency-key': 42 as any }),
    ).toThrow(BusinessException);
  });

  it('accepts a different UUID v4 as a distinct key', () => {
    expect(extractIdempotencyKey({ 'idempotency-key': OTHER_KEY })).toBe(OTHER_KEY);
  });
});
