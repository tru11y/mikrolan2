import { ManagementMode, VoucherStatus } from '@prisma/client';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { addHotspotUser } from '../../common/routeros/hotspot.ops';
import { VoucherService } from './voucher.service';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1', role: 'ADMIN' })),
}));

jest.mock('../../common/routeros/hotspot.ops', () => ({
  addHotspotUser: jest.fn(),
  ensureUserProfile: jest.fn().mockResolvedValue(undefined),
  removeHotspotUser: jest.fn().mockResolvedValue(undefined),
}));

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
  codeFormat: 'ALPHANUMERIC',
};

function makePrisma(finalBatch = { status: 'COMPLETED', generated: 0 }) {
  return {
    router: { findFirst: jest.fn().mockResolvedValue({ id: 'router-1', mode: ManagementMode.REMOTE }) },
    plan: { findFirst: jest.fn().mockResolvedValue(PLAN) },
    remotePeer: { findFirst: jest.fn().mockResolvedValue({ id: 'peer-1' }) },
    voucher: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    voucherBatch: {
      create: jest.fn().mockResolvedValue({ id: 'batch-1', seq: 7 }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(finalBatch),
      findFirst: jest.fn(),
    },
  };
}

function build(prisma: ReturnType<typeof makePrisma>, remote?: unknown, subs?: unknown) {
  const eventLog = makeEventLogStub();
  const service = new VoucherService(
    prisma as any,
    (remote ?? { run: jest.fn() }) as any,
    (subs ?? { assertVoucherLimit: jest.fn().mockResolvedValue(undefined) }) as any,
    eventLog as any,
  );
  return { service, eventLog };
}

const runCallback = { run: jest.fn((_id: string, cb: (c: unknown) => Promise<void>) => cb({})) };

beforeEach(() => jest.clearAllMocks());

describe('VoucherService event trace', () => {
  it('remote push failing after 2 of 3 tickets is traced PARTIAL_SUCCESS', async () => {
    (addHotspotUser as jest.Mock)
      .mockResolvedValueOnce('*1')
      .mockResolvedValueOnce('*2')
      .mockRejectedValueOnce(new Error('router timeout'));
    const { service, eventLog } = build(makePrisma({ status: 'PARTIAL_SUCCESS', generated: 2 }), runCallback);

    const res = await service.generate('router-1', { planId: 'plan-1', quantity: 3 } as any);

    expect(res).toMatchObject({ batchStatus: 'PARTIAL_SUCCESS', pushedCount: 2, totalCount: 3 });
    expect(eventLog.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'VoucherBatch',
        outcome: 'PARTIAL_SUCCESS',
        metadata: expect.objectContaining({ pushedCount: 2, totalCount: 3, error: 'router timeout' }),
      }),
    );
  });

  it('remote push failing before any ticket is traced FAILED with the error', async () => {
    (addHotspotUser as jest.Mock).mockRejectedValueOnce(new Error('auth failed'));
    const { service, eventLog } = build(makePrisma({ status: 'FAILED', generated: 0 }), runCallback);

    await service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any);

    expect(eventLog.failure).toHaveBeenCalledWith(
      expect.anything(),
      'VoucherBatch',
      'batch-1',
      expect.any(Error),
      expect.objectContaining({ pushedCount: 0, totalCount: 2 }),
    );
  });

  it('remote push of the whole batch is traced SUCCESS', async () => {
    (addHotspotUser as jest.Mock).mockResolvedValue('*1');
    const { service, eventLog } = build(makePrisma({ status: 'COMPLETED', generated: 2 }), runCallback);

    await service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any);

    expect(eventLog.success).toHaveBeenCalledWith(
      expect.anything(),
      'VoucherBatch',
      'batch-1',
      expect.objectContaining({ pushedCount: 2, totalCount: 2, via: 'tunnel' }),
    );
  });

  it('generation refused by a plan limit is traced FAILED then rethrown', async () => {
    const limit = new Error('limit');
    const subs = { assertVoucherLimit: jest.fn().mockRejectedValue(limit) };
    const { service, eventLog } = build(makePrisma(), undefined, subs);

    await expect(service.generate('router-1', { planId: 'plan-1', quantity: 2 } as any)).rejects.toBe(limit);
    expect(eventLog.failure).toHaveBeenCalledWith(
      expect.anything(),
      'VoucherBatch',
      'router-1',
      limit,
      expect.objectContaining({ stage: 'generate' }),
    );
  });

  it('LAN confirmation of fewer tickets than the batch is PARTIAL_SUCCESS', async () => {
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValue({ quantity: 5 });
    const { service, eventLog } = build(prisma);

    await service.confirmPush('router-1', {
      batchId: 'batch-1',
      items: [{ id: 'v1', mikrotikId: '*1' }, { id: 'v2', mikrotikId: '*2' }],
    } as any);

    expect(prisma.voucherBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL_SUCCESS', generated: 2 }) }),
    );
    expect(eventLog.partialSuccess).toHaveBeenCalledWith(
      expect.anything(),
      'VoucherBatch',
      'batch-1',
      expect.objectContaining({ confirmed: 2, totalCount: 5 }),
    );
  });

  it('LAN confirmation of the whole batch is SUCCESS', async () => {
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValue({ quantity: 1 });
    const { service, eventLog } = build(prisma);

    await service.confirmPush('router-1', { batchId: 'batch-1', items: [{ id: 'v1', mikrotikId: '*1' }] } as any);

    expect(eventLog.success).toHaveBeenCalledWith(
      expect.anything(),
      'VoucherBatch',
      'batch-1',
      expect.objectContaining({ confirmed: 1 }),
    );
  });

  it('client-reported LAN failure with nothing pushed marks the batch FAILED and traces it', async () => {
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1', quantity: 4 });
    const { service, eventLog } = build(prisma);

    await service.reportPushFailure('router-1', {
      batchId: 'batch-1',
      reason: 'Routeur injoignable (timeout)',
      errorCode: 'LAN_UNREACHABLE',
    } as any);

    expect(prisma.voucherBatch.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED' } }));
    expect(eventLog.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'FAILED',
        metadata: expect.objectContaining({ errorCode: 'LAN_UNREACHABLE', totalCount: 4 }),
      }),
    );
  });

  it('client-reported LAN failure after some tickets is PARTIAL_SUCCESS', async () => {
    const prisma = makePrisma();
    prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1', quantity: 4 });
    const { service, eventLog } = build(prisma);

    await service.reportPushFailure('router-1', { batchId: 'batch-1', reason: 'coupure', pushedCount: 3 } as any);

    expect(eventLog.partialSuccess).toHaveBeenCalledWith(
      expect.anything(),
      'VoucherBatch',
      'batch-1',
      expect.objectContaining({ pushedCount: 3, totalCount: 4 }),
    );
  });

  it('revoke with the router unreachable is traced WARNING, not SUCCESS', async () => {
    const prisma = makePrisma();
    prisma.voucher.findFirst.mockResolvedValue({
      id: 'v-1',
      routerId: 'router-1',
      mikrotikId: '*9',
      status: VoucherStatus.GENERATED,
      router: { mode: ManagementMode.REMOTE },
    });
    const remote = { run: jest.fn().mockRejectedValue(new Error('tunnel down')) };
    const { service, eventLog } = build(prisma, remote);

    await service.revoke('v-1');

    expect(eventLog.warning).toHaveBeenCalledWith(
      expect.anything(),
      'Voucher',
      'v-1',
      expect.objectContaining({ errorCode: 'VOUCHER_REVOKE_ROUTER_UNREACHABLE' }),
    );
    expect(eventLog.success).not.toHaveBeenCalled();
  });
});
