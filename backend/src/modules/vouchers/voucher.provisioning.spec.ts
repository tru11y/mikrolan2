import { ManagementMode, SessionStatus, VoucherStatus } from '@prisma/client';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { addHotspotUser } from '../../common/routeros/hotspot.ops';
import { applyTenantScope } from '../../prisma/prisma.service';
import { VoucherService, computeExpiresAt, isProvisioned, ticketState } from './voucher.service';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'ADMIN' })),
}));

jest.mock('../../common/routeros/hotspot.ops', () => ({
  addHotspotUser: jest.fn(),
  ensureUserProfile: jest.fn().mockResolvedValue(undefined),
  removeHotspotUser: jest.fn().mockResolvedValue(undefined),
}));

const NOW = new Date('2026-10-01T11:00:00Z');

interface Row {
  id: string;
  code: string;
  password: string;
  status: VoucherStatus;
  planId: string;
  routerId: string;
  batchId: string;
  mikrotikId: string | null;
  expiresAt: null;
  usedAt: null;
  createdAt: Date;
}

/** `n` vouchers de `batchId`, les `provisioned` premiers ayant un mikrotikId. */
function rows(batchId: string, n: number, provisioned: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${batchId}-v${i}`,
    code: `CODE${batchId}${i}`,
    password: `CODE${batchId}${i}`,
    status: VoucherStatus.GENERATED,
    planId: 'plan-1',
    routerId: 'router-1',
    batchId,
    mikrotikId: i < provisioned ? `*${i + 1}` : null,
    expiresAt: null,
    usedAt: null,
    createdAt: NOW,
  }));
}

/**
 * Mini base en mémoire : applique réellement `where.NOT` (filtre « provisionné »),
 * `batchId` et `routerId`, pour tester le COMPORTEMENT de la liste et pas seulement
 * la forme de la requête.
 */
function fakeDb(all: Row[]) {
  const matches = (r: Row, where: Record<string, any> = {}): boolean => {
    if (where.routerId && r.routerId !== where.routerId) return false;
    if (where.batchId && typeof where.batchId === 'string' && r.batchId !== where.batchId) return false;
    if (where.batchId?.in && !where.batchId.in.includes(r.batchId)) return false;
    if (where.status && r.status !== where.status) return false;
    if (Array.isArray(where.NOT)) {
      for (const cond of where.NOT) {
        if ('mikrotikId' in cond && r.mikrotikId === cond.mikrotikId) return false;
      }
    }
    return true;
  };
  return {
    findMany: jest.fn(async (args: { where?: Record<string, any> }) => all.filter((r) => matches(r, args.where))),
    groupBy: jest.fn(async (args: { where?: Record<string, any> }) => {
      const counts = new Map<string, number>();
      for (const r of all.filter((x) => matches(x, args.where))) counts.set(r.batchId, (counts.get(r.batchId) ?? 0) + 1);
      return [...counts].map(([batchId, n]) => ({ batchId, _count: { _all: n } }));
    }),
  };
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma: any = {
    voucher: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    voucherBatch: { findMany: jest.fn().mockResolvedValue([]) },
    ...prismaOverrides,
  };
  const service = new VoucherService(
    prisma,
    { run: jest.fn() } as any,
    { assertVoucherLimit: jest.fn().mockResolvedValue(undefined) } as any,
    makeEventLogStub() as any,
  );
  return { service, prisma };
}

beforeEach(() => jest.clearAllMocks());

describe('isProvisioned', () => {
  it('only a non-empty mikrotikId proves RouterOS provisioning', () => {
    expect(isProvisioned({ mikrotikId: '*1A' })).toBe(true);
    expect(isProvisioned({ mikrotikId: null })).toBe(false);
    expect(isProvisioned({ mikrotikId: '' })).toBe(false);
    expect(isProvisioned({})).toBe(false);
  });
});

describe('GET vouchers — default list only exposes provisioned tickets', () => {
  it('(A) FAILED batch, 10 vouchers in DB, 0 provisioned -> nothing distributable', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findMany = fakeDb(rows('failed', 10, 0)).findMany;
    expect(await service.list('router-1')).toHaveLength(0);
  });

  it('(B) PARTIAL_SUCCESS, 10 in DB, 8 provisioned -> exactly 8 distributable', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findMany = fakeDb(rows('partial', 10, 8)).findMany;
    const out = await service.list('router-1');
    expect(out).toHaveLength(8);
    expect(out.every((v) => v.provisioned)).toBe(true);
  });

  it('(C) COMPLETED 10/10 -> 10 distributable', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findMany = fakeDb(rows('done', 10, 10)).findMany;
    expect(await service.list('router-1')).toHaveLength(10);
  });

  it('(D) includeUnprovisioned=true also returns the non-provisioned ones with provisioned=false', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findMany = fakeDb(rows('partial', 10, 8)).findMany;
    const out = await service.list('router-1', undefined, undefined, true);
    expect(out).toHaveLength(10);
    expect(out.filter((v) => v.provisioned)).toHaveLength(8);
    expect(out.filter((v) => !v.provisioned)).toHaveLength(2);
  });

  it('never exposes the raw mikrotikId', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findMany = fakeDb(rows('done', 3, 3)).findMany;
    for (const v of await service.list('router-1', undefined, undefined, true)) {
      expect(v).not.toHaveProperty('mikrotikId');
    }
  });

  it('(E) tenant ownership is preserved: the provisioned filter is applied on top of the tenant scope', async () => {
    const { service, prisma } = makeService();
    await service.list('router-1');
    const args = prisma.voucher.findMany.mock.calls[0][0];
    const scoped = applyTenantScope({ action: 'findMany', model: 'Voucher', args, runInTransaction: false } as any, {
      tenantId: 'tenant-1',
    } as any);
    expect(scoped.args.where.tenantId).toBe('tenant-1');
    expect(scoped.args.where.routerId).toBe('router-1');
    expect(scoped.args.where.NOT).toEqual([{ mikrotikId: null }, { mikrotikId: '' }]);
  });
});

describe('GET batches — real counts, not `generated`', () => {
  it('returns voucherCount and provisionedCount from the real vouchers', async () => {
    const all = [...rows('b-failed', 10, 0), ...rows('b-partial', 10, 8), ...rows('b-done', 10, 10)];
    const db = fakeDb(all);
    const { service, prisma } = makeService();
    prisma.voucher.groupBy = db.groupBy;
    prisma.voucherBatch.findMany.mockResolvedValue([
      { id: 'b-failed', seq: 34, quantity: 10, generated: 0, status: 'FAILED' },
      { id: 'b-partial', seq: 35, quantity: 10, generated: 8, status: 'PARTIAL_SUCCESS' },
      { id: 'b-done', seq: 36, quantity: 10, generated: 10, status: 'COMPLETED' },
    ]);
    const out = await service.listBatches('router-1');
    const by = Object.fromEntries(out.map((b) => [b.id, [b.voucherCount, b.provisionedCount]]));
    expect(by).toEqual({ 'b-failed': [10, 0], 'b-partial': [10, 8], 'b-done': [10, 10] });
  });

  it('a batch without any voucher gets 0/0 (never undefined)', async () => {
    const { service, prisma } = makeService();
    prisma.voucherBatch.findMany.mockResolvedValue([{ id: 'empty', seq: 1, quantity: 5, generated: 0, status: 'FAILED' }]);
    const [b] = await service.listBatches('router-1');
    expect([b.voucherCount, b.provisionedCount]).toEqual([0, 0]);
  });
});

describe('verifyVoucherForOperator — counter', () => {
  const base = (mikrotikId: string | null) => ({
    ...rows('x', 1, 0)[0],
    mikrotikId,
    plan: { id: 'plan-1', name: '1h', priceXof: 500, durationMinutes: 60 },
    router: { id: 'router-1', identity: 'MT', alias: 'R' },
    session: null,
  });

  it('(F) non-provisioned voucher -> canLogin=false and an explicit message', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findFirst.mockResolvedValue(base(null));
    const res = await service.verifyVoucherForOperator({ ticket: 'CODEx0' });
    expect(res.canLogin).toBe(false);
    expect(res.provisioned).toBe(false);
    expect(res.message).toBe("Ce ticket n'a pas encore été enregistré sur le routeur.");
  });

  it('provisioned GENERATED voucher stays valid', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findFirst.mockResolvedValue(base('*1A'));
    const res = await service.verifyVoucherForOperator({ ticket: 'CODEx0' });
    expect(res.canLogin).toBe(true);
    expect(res.provisioned).toBe(true);
    expect(res.message).toContain('valide');
  });
});

describe('generate — what the operator receives as distributable tickets', () => {
  const PLAN = {
    id: 'plan-1', userProfile: 'p1', durationMinutes: 60, dataLimitMb: null, downloadKbps: null,
    uploadKbps: null, sharedUsers: 1, codePrefix: null, codeLength: 8, codeFormat: 'ALPHANUMERIC',
  };

  function genPrisma(opts: { peer: boolean; created: Row[]; batch: { status: string; generated: number } }) {
    return {
      router: { findFirst: jest.fn().mockResolvedValue({ id: 'router-1', mode: opts.peer ? ManagementMode.REMOTE : ManagementMode.LOCAL }) },
      plan: { findFirst: jest.fn().mockResolvedValue(PLAN) },
      remotePeer: { findFirst: jest.fn().mockResolvedValue(opts.peer ? { id: 'peer-1' } : null) },
      voucher: {
        // uniqueCodes() only selects `code`; the final read selects the public projection.
        findMany: jest.fn(async (args: { select?: Record<string, unknown> }) => (args.select?.password ? opts.created : [])),
        createMany: jest.fn().mockResolvedValue({ count: opts.created.length }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      voucherBatch: {
        create: jest.fn().mockResolvedValue({ id: 'batch-1', seq: 7 }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(opts.batch),
      },
    };
  }

  function build(prisma: unknown, remote: unknown = { run: jest.fn() }) {
    return new VoucherService(
      prisma as any,
      remote as any,
      { assertVoucherLimit: jest.fn().mockResolvedValue(undefined) } as any,
      makeEventLogStub() as any,
    );
  }

  it('(G) REMOTE partial: 10 requested, 8 pushed -> only the 8 provisioned are returned as tickets', async () => {
    (addHotspotUser as jest.Mock).mockResolvedValue('*1');
    const service = build(
      genPrisma({ peer: true, created: rows('batch-1', 10, 8), batch: { status: 'PARTIAL_SUCCESS', generated: 8 } }),
      { run: jest.fn((_id: string, cb: (c: unknown) => Promise<void>) => cb({})) },
    );
    const res = await service.generate('router-1', { planId: 'plan-1', quantity: 10 } as any);
    expect(res.pushedByServer).toBe(true);
    expect(res.vouchers).toHaveLength(8);
    expect(res.vouchers.every((v) => v.provisioned)).toBe(true);
    expect(res.vouchers.some((v) => 'mikrotikId' in v)).toBe(false);
  });

  it('REMOTE FAILED: nothing provisioned -> the response carries 0 distributable tickets', async () => {
    (addHotspotUser as jest.Mock).mockRejectedValue(new Error('timeout'));
    const service = build(
      genPrisma({ peer: true, created: rows('batch-1', 3, 0), batch: { status: 'FAILED', generated: 0 } }),
      { run: jest.fn((_id: string, cb: (c: unknown) => Promise<void>) => cb({})) },
    );
    const res = await service.generate('router-1', { planId: 'plan-1', quantity: 3 } as any);
    expect(res.batchStatus).toBe('FAILED');
    expect(res.vouchers).toHaveLength(0);
  });

  it('(H) LOCAL: all codes are returned (the phone pushes them over the LAN), flagged provisioned=false, with the push params', async () => {
    const service = build(genPrisma({ peer: false, created: rows('batch-1', 3, 0), batch: { status: 'GENERATING', generated: 0 } }));
    const res = await service.generate('router-1', { planId: 'plan-1', quantity: 3 } as any);
    expect(res.pushedByServer).toBe(false);
    expect(res.push).toBeDefined();
    expect(res.vouchers).toHaveLength(3);
    expect(res.vouchers.every((v) => v.provisioned === false)).toBe(true);
  });
});

describe('computeExpiresAt / ticketState — expiration = première connexion + durée du forfait', () => {
  const S = VoucherStatus;
  const T0 = new Date('2026-10-05T09:12:00Z');
  const minutes = (n: number) => n * 60_000;

  it('jamais utilisé : aucune expiration (la validité n\'a pas commencé), état AVAILABLE', () => {
    expect(computeExpiresAt(null, 4320)).toBeNull();
    expect(ticketState({ status: S.GENERATED, provisioned: true, expiresAt: null, now: T0 })).toBe('AVAILABLE');
  });

  it('activé : expiresAt = usedAt + durée (Plan.durationMinutes), jamais deviné depuis le nom du forfait', () => {
    expect(computeExpiresAt(T0, 4320)!.toISOString()).toBe('2026-10-08T09:12:00.000Z'); // 3 jours
    expect(computeExpiresAt(T0, 1440)!.toISOString()).toBe('2026-10-06T09:12:00.000Z'); // 24 h
  });

  it('B. première connexion il y a 2 h, durée 24 h => IN_USE, expiration correcte, ~22 h restantes', () => {
    const now = new Date(T0.getTime() + minutes(120));
    const exp = computeExpiresAt(T0, 1440)!;
    expect(ticketState({ status: S.ACTIVE, provisioned: true, expiresAt: exp, now })).toBe('IN_USE');
    expect((exp.getTime() - now.getTime()) / 3_600_000).toBe(22);
  });

  it('C. première connexion il y a 2 j, durée 1 j => EXPIRED', () => {
    const now = new Date(T0.getTime() + minutes(2 * 1440));
    expect(ticketState({ status: S.ACTIVE, provisioned: true, expiresAt: computeExpiresAt(T0, 1440), now })).toBe('EXPIRED');
  });

  it('D. révoqué garde la priorité même avec 2 jours théoriques restants', () => {
    const now = new Date(T0.getTime() + minutes(60));
    expect(ticketState({ status: S.REVOKED, provisioned: true, expiresAt: computeExpiresAt(T0, 4320), now })).toBe('REVOKED');
  });

  it('E. non provisionné => UNAVAILABLE, jamais ressuscité par le calcul de durée', () => {
    const now = new Date(T0.getTime() + minutes(60));
    expect(ticketState({ status: S.ACTIVE, provisioned: false, expiresAt: computeExpiresAt(T0, 4320), now })).toBe('UNAVAILABLE');
  });

  it('statuts stockés EXPIRED / USED respectés', () => {
    expect(ticketState({ status: S.EXPIRED, provisioned: true, expiresAt: null, now: T0 })).toBe('EXPIRED');
    expect(ticketState({ status: S.USED, provisioned: true, expiresAt: null, now: T0 })).toBe('ENDED');
  });

  it('une expiration persistée par la logique métier prime sur le calcul', () => {
    const persisted = new Date('2026-12-31T00:00:00Z');
    expect(computeExpiresAt(T0, 60, persisted)).toBe(persisted);
  });
});

describe('verifyVoucherForOperator — réponse enrichie', () => {
  const row = (over: Record<string, unknown>) => ({
    ...rows('x', 1, 1)[0],
    plan: { id: 'plan-1', name: '3 jours', priceXof: 2000, durationMinutes: 4320 },
    router: { id: 'router-1', identity: 'MT-01', alias: 'FREEDOM HOME' },
    session: null,
    ...over,
  });

  it('A. jamais utilisé : AVAILABLE, pas d\'expiration, durée technique 3 j en secondes, routeur et dates lisibles, aucun secret', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findFirst.mockResolvedValue(row({}));
    const res = await service.verifyVoucherForOperator({ ticket: 'CODEx0' });
    expect(res).toMatchObject({ state: 'AVAILABLE', canLogin: true, provisioned: true, routerName: 'FREEDOM HOME', planName: '3 jours', durationMinutes: 4320, durationSeconds: 259200, usedAt: null, expiresAt: null });
    expect(res.createdAt).toBe(NOW.toISOString());
    expect(typeof res.serverNow).toBe('string');
    expect(JSON.stringify(res)).not.toMatch(/mikrotikId|credEncrypted|password/i);
  });

  it('en cours : IN_USE, expiresAt = première connexion + durée du forfait', async () => {
    const used = new Date(Date.now() - 2 * 3_600_000); // il y a 2 h
    const { service, prisma } = makeService();
    prisma.voucher.findFirst.mockResolvedValue(
      row({ status: VoucherStatus.ACTIVE, usedAt: used, plan: { id: 'plan-1', name: '24 h', priceXof: 500, durationMinutes: 1440 }, session: { status: SessionStatus.ACTIVE, startedAt: used, lastSeenAt: used, terminatedAt: null, bytesIn: BigInt(1), bytesOut: BigInt(2), macAddress: null, ipAddress: null } }),
    );
    const res = await service.verifyVoucherForOperator({ ticket: 'CODEx0' });
    expect(res).toMatchObject({ state: 'IN_USE', canLogin: true, usedAt: used.toISOString(), expiresAt: new Date(used.getTime() + 24 * 3_600_000).toISOString() });
  });

  it('C. expiré : EXPIRED, canLogin=false, message cohérent', async () => {
    const used = new Date(Date.now() - 2 * 86_400_000); // il y a 2 j, forfait 1 j
    const { service, prisma } = makeService();
    prisma.voucher.findFirst.mockResolvedValue(row({ status: VoucherStatus.ACTIVE, usedAt: used, plan: { id: 'plan-1', name: '1 jour', priceXof: 300, durationMinutes: 1440 } }));
    const res = await service.verifyVoucherForOperator({ ticket: 'CODEx0' });
    expect(res).toMatchObject({ state: 'EXPIRED', canLogin: false });
    expect(res.message).toBe('Ticket expiré — connexion refusée.');
  });

  it('E. non provisionné : UNAVAILABLE, canLogin=false, message explicite (pas « valide »)', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findFirst.mockResolvedValue(row({ mikrotikId: null }));
    const res = await service.verifyVoucherForOperator({ ticket: 'CODEx0' });
    expect(res).toMatchObject({ state: 'UNAVAILABLE', canLogin: false, provisioned: false });
    expect(res.message).toBe("Ce ticket n'a pas encore été enregistré sur le routeur.");
  });

  it('D. révoqué : REVOKED, canLogin=false', async () => {
    const { service, prisma } = makeService();
    prisma.voucher.findFirst.mockResolvedValue(row({ status: VoucherStatus.REVOKED }));
    expect(await service.verifyVoucherForOperator({ ticket: 'CODEx0' })).toMatchObject({ state: 'REVOKED', canLogin: false });
  });
});
