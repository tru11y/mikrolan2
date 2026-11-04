import { ManagementMode } from '@prisma/client';
import { VoucherExpiryCron } from './voucher-expiry.cron';

const now = new Date('2026-08-15T12:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

function setup(rows: unknown[], runImpl?: () => Promise<void>) {
  const prisma = {
    voucher: { findMany: jest.fn().mockResolvedValue(rows), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const remote = { run: jest.fn(runImpl ?? (async () => undefined)) };
  const eventLog = { success: jest.fn().mockResolvedValue(undefined) };
  const cron = new VoucherExpiryCron(prisma as never, remote as never, eventLog as never);
  return { cron, prisma, remote, eventLog };
}

const row = (over: Record<string, unknown>) => ({
  id: 'v1', tenantId: 't1', routerId: 'r1', mikrotikId: '*1', usedAt: ago(100),
  plan: { durationMinutes: 60 }, router: { mode: ManagementMode.REMOTE }, session: { mikrotikId: '*A' },
  ...over,
});

describe('VoucherExpiryCron', () => {
  it('removes expired REMOTE voucher from router then persists expiresAt', async () => {
    const { cron, prisma, remote } = setup([row({})]);
    expect(await cron.run(now)).toBe(1);
    expect(remote.run).toHaveBeenCalledTimes(1);
    expect(prisma.voucher.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expiresAt: ago(40) } }),
    );
  });

  it('skips vouchers still within duration', async () => {
    const { cron, remote, prisma } = setup([row({ usedAt: ago(10) })]);
    expect(await cron.run(now)).toBe(0);
    expect(remote.run).not.toHaveBeenCalled();
    expect(prisma.voucher.updateMany).not.toHaveBeenCalled();
  });

  it('LOCAL router: DB only, no router call', async () => {
    const { cron, remote, prisma } = setup([row({ router: { mode: ManagementMode.LOCAL } })]);
    expect(await cron.run(now)).toBe(1);
    expect(remote.run).not.toHaveBeenCalled();
    expect(prisma.voucher.updateMany).toHaveBeenCalled();
  });

  it('router failure: nothing persisted, retried next tick', async () => {
    const { cron, prisma } = setup([row({})], async () => { throw new Error('timeout'); });
    expect(await cron.run(now)).toBe(0);
    expect(prisma.voucher.updateMany).not.toHaveBeenCalled();
  });

  it('router failure: other vouchers of the same router are skipped this tick (no timeout pile-up)', async () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c', routerId: 'r2' })];
    const { cron, remote, prisma } = setup(rows, async () => { throw new Error('timeout'); });
    expect(await cron.run(now)).toBe(0);
    // r1 tried once (a), b skipped, r2 tried once (c) -> 2 router calls, not 3
    expect(remote.run).toHaveBeenCalledTimes(2);
    expect(prisma.voucher.updateMany).not.toHaveBeenCalled();
  });

  it('failed router goes on cooldown, retried only after the delay', async () => {
    const { cron, prisma, remote } = setup([row({})], async () => { throw new Error('timeout'); });
    await cron.run(now);
    await cron.run(new Date(now.getTime() + 60_000));
    expect(prisma.voucher.findMany.mock.calls[1][0].where.routerId).toEqual({ notIn: ['r1'] });
    remote.run.mockImplementation(async () => undefined);
    await cron.run(new Date(now.getTime() + 16 * 60_000));
    expect(prisma.voucher.findMany.mock.calls[2][0].where.routerId).toEqual({ notIn: [] });
  });

  it('success on a router clears its cooldown', async () => {
    let fail = true;
    const { cron, prisma } = setup([row({})], async () => { if (fail) throw new Error('x'); });
    await cron.run(now);
    fail = false;
    expect(await cron.run(new Date(now.getTime() + 16 * 60_000))).toBe(1);
    await cron.run(new Date(now.getTime() + 17 * 60_000));
    expect(prisma.voucher.findMany.mock.calls[2][0].where.routerId).toEqual({ notIn: [] });
  });

  it('query excludes offline / credential-less REMOTE routers but keeps LOCAL', async () => {
    const { cron, prisma } = setup([]);
    await cron.run(now);
    const where = prisma.voucher.findMany.mock.calls[0][0].where;
    expect(where.router.deletedAt).toBeNull();
    expect(where.router.OR).toEqual([
      { mode: ManagementMode.LOCAL },
      { mode: ManagementMode.REMOTE, credEncrypted: { not: null }, health: { not: 'OFFLINE' } },
    ]);
  });
});
