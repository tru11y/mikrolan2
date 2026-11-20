import { ManagementMode, RouterLinkAuthMode, VoucherStatus } from '@prisma/client';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import * as hotspotOps from '../../common/routeros/hotspot.ops';
import { VoucherService } from './voucher.service';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'ADMIN' })),
}));

jest.mock('../../common/routeros/hotspot.ops', () => ({
  addHotspotUser: jest.fn(),
  ensureUserProfile: jest.fn(),
  removeHotspotUser: jest.fn(),
  removeActive: jest.fn(),
}));

const PLAN = {
  id: 'plan-1', userProfile: 'p1', durationMinutes: 60, dataLimitMb: null,
  downloadKbps: null, uploadKbps: null, sharedUsers: 1, codePrefix: null,
  codeLength: 8, codeFormat: 'ALPHANUMERIC',
};

function createdRows(n: number, distributable: boolean) {
  return Array.from({ length: n }, (_, i) => ({
    id: `v-${i}`, code: `CODE${i}`, password: `CODE${i}`,
    mikrotikId: null, radiusDistributable: distributable,
    link: { authMode: RouterLinkAuthMode.RADIUS },
    status: VoucherStatus.GENERATED, planId: 'plan-1', routerId: 'router-1',
    batchId: 'batch-1', expiresAt: null, usedAt: null, createdAt: new Date(),
  }));
}

function makePrisma(opts: { ready: boolean }) {
  return {
    router: { findFirst: jest.fn().mockResolvedValue({ id: 'router-1', mode: ManagementMode.REMOTE }) },
    plan: { findFirst: jest.fn().mockResolvedValue(PLAN) },
    remotePeer: { findFirst: jest.fn() },
    routerLinkMember: {
      findFirst: jest.fn().mockResolvedValue({ linkId: 'link-1', link: { authMode: RouterLinkAuthMode.RADIUS } }),
      count: jest.fn()
        .mockResolvedValueOnce(2) // total
        .mockResolvedValueOnce(opts.ready ? 2 : 1), // ready
    },
    voucher: {
      findMany: jest.fn(async (args: { select?: Record<string, unknown> }) =>
        args.select?.password ? createdRows(2, opts.ready) : [],
      ),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      updateMany: jest.fn(),
    },
    voucherBatch: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'batch-1', seq: 9 }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ status: 'COMPLETED', generated: 2 }),
    },
  };
}

function build(prisma: unknown, remote: unknown) {
  return new VoucherService(
    prisma as any,
    remote as any,
    makeEventLogStub() as any,
    { get: (k: string) => (k === 'RADIUS_ENABLED' ? true : 30) } as any,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('doGenerate — mode RADIUS', () => {
  it('ne pousse rien sur le routeur (0 remote.run / addHotspotUser / ensureUserProfile)', async () => {
    const prisma = makePrisma({ ready: true });
    const remote = { run: jest.fn() };
    const res = (await build(prisma, remote).generate('router-1', { planId: 'plan-1', quantity: 2 } as any)) as any;

    expect(remote.run).not.toHaveBeenCalled();
    expect(hotspotOps.addHotspotUser).not.toHaveBeenCalled();
    expect(hotspotOps.ensureUserProfile).not.toHaveBeenCalled();
    expect(res.push).toBeUndefined();
  });

  it('crée le batch + les vouchers avec linkId, mikrotikId null, radiusDistributable selon l’état du lien', async () => {
    const prisma = makePrisma({ ready: true });
    await build(prisma, { run: jest.fn() }).generate('router-1', { planId: 'plan-1', quantity: 2 } as any);

    expect(prisma.voucher.createMany).toHaveBeenCalledTimes(1);
    const data = prisma.voucher.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    for (const row of data) {
      expect(row.linkId).toBe('link-1');
      expect(row.radiusDistributable).toBe(true);
      expect(row.mikrotikId).toBeUndefined(); // jamais poussé → reste null (défaut colonne)
    }
    expect(prisma.voucherBatch.create.mock.calls[0][0].data.pushedByServer).toBe(true);
  });

  it('lien non prêt → vouchers créés avec radiusDistributable=false, aucun renvoyé comme distribuable', async () => {
    const prisma = makePrisma({ ready: false });
    const res = (await build(prisma, { run: jest.fn() }).generate('router-1', { planId: 'plan-1', quantity: 2 } as any)) as any;

    const data = prisma.voucher.createMany.mock.calls[0][0].data;
    expect(data.every((r: { radiusDistributable: boolean }) => r.radiusDistributable === false)).toBe(true);
    expect(res.vouchers).toHaveLength(0); // filtrés par provisioned=false
  });
});
