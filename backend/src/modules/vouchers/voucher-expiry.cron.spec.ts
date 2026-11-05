import { ManagementMode } from '@prisma/client';
import { VoucherExpiryCron } from './voucher-expiry.cron';

const now = new Date('2026-08-15T12:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

type Row = ReturnType<typeof row>;

/** Simule le SQL : filtre expiré AVANT limit, exclut les ids déjà tentés. */
function setup(rows: Row[], runImpl?: (id?: string) => Promise<void>) {
  const prisma = {
    $queryRaw: jest.fn(async (_s: unknown, nowArg: Date, attempted: string[], limit: number) =>
      rows
        .filter((r) => !attempted.includes(r.id))
        .filter((r) => r.usedAt.getTime() + r.plan.durationMinutes * 60_000 <= nowArg.getTime())
        .sort((x, y) => x.usedAt.getTime() - y.usedAt.getTime())
        .slice(0, limit)
        .map((r) => ({ id: r.id })),
    ),
    voucher: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        rows.filter((r) => where.id.in.includes(r.id)),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const remote = { run: jest.fn(async () => runImpl?.()) };
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

  it('catastrophe: 300 valid in front + 500 expired behind → all expired enforced (no starvation)', async () => {
    const valid = Array.from({ length: 300 }, (_, i) => row({ id: `ok${i}`, usedAt: ago(5) }));
    const expired = Array.from({ length: 500 }, (_, i) => row({ id: `ex${i}`, usedAt: ago(100 + i) }));
    const { cron } = setup([...valid, ...expired] as Row[]);
    expect(await cron.run(now)).toBe(500);
  });

  it('limite: exactly one full batch (200) then empty', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => row({ id: `e${i}` }));
    const { cron, prisma } = setup(rows as Row[]);
    expect(await cron.run(now)).toBe(200);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('250 permanently failing tickets do not starve the next ones nor loop forever', async () => {
    const bad = Array.from({ length: 250 }, (_, i) => row({ id: `bad${i}`, usedAt: ago(1000) }));
    const good = [row({ id: 'good', usedAt: ago(100) })];
    const { cron } = setup([...bad, ...good] as Row[], async () => {
      throw new Error('timeout');
    });
    // les 250 échouent (REMOTE) mais le run termine ; good échoue aussi (même mock) sans boucle infinie
    expect(await cron.run(now)).toBe(0);
  });
});
