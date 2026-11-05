import { ManagementMode } from '@prisma/client';
import { VoucherExpiryCron } from './voucher-expiry.cron';

const now = new Date('2026-08-15T12:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

// Durées distinctes de forfait des lignes simulées (ce que renvoie plan.findMany distinct).
const durationsOf = (rows: unknown[]) => {
  const set = new Set((rows as Array<{ plan: { durationMinutes: number } }>).map((r) => r.plan.durationMinutes));
  return [...set].map((durationMinutes) => ({ durationMinutes }));
};

function setup(rows: unknown[], runImpl?: () => Promise<void>) {
  const prisma = {
    voucher: { findMany: jest.fn().mockResolvedValue(rows), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    plan: { findMany: jest.fn().mockResolvedValue(durationsOf(rows)) },
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
    const { cron, prisma } = setup([row({ usedAt: ago(10) })]);
    await cron.run(now);
    const where = prisma.voucher.findMany.mock.calls[0][0].where;
    expect(where.router.deletedAt).toBeNull();
    expect(where.router.OR).toEqual([
      { mode: ManagementMode.LOCAL },
      { mode: ManagementMode.REMOTE, credEncrypted: { not: null }, health: { not: 'OFFLINE' } },
    ]);
  });

  describe('starvation : les expirés ne restent pas derrière des tickets non expirés', () => {
    interface Row { id: string; tenantId: string; routerId: string; mikrotikId: string; usedAt: Date; expiresAt: Date | null; plan: { durationMinutes: number }; router: { mode: ManagementMode }; session: null }
    type Clause = { plan: { durationMinutes: number }; usedAt: { lte: Date } };

    // Base simulée qui applique réellement where / orderBy / take, comme PostgreSQL.
    function fakeDb(rows: Row[]) {
      const prisma = {
        plan: { findMany: jest.fn().mockResolvedValue(durationsOf(rows)) },
        voucher: {
          findMany: jest.fn(async (args: { where: { OR: Clause[]; routerId: { notIn: string[] } }; take: number }) => {
            const { OR, routerId } = args.where;
            return rows
              .filter((r) => r.expiresAt === null && !routerId.notIn.includes(r.routerId))
              .filter((r) => OR.some((c) => r.plan.durationMinutes === c.plan.durationMinutes && r.usedAt.getTime() <= c.usedAt.lte.getTime()))
              .sort((a, b) => a.usedAt.getTime() - b.usedAt.getTime())
              .slice(0, args.take);
          }),
          updateMany: jest.fn(async (args: { where: { id: string }; data: { expiresAt: Date } }) => {
            const r = rows.find((x) => x.id === args.where.id);
            if (r) r.expiresAt = args.data.expiresAt;
            return { count: r ? 1 : 0 };
          }),
        },
        session: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      const remote = { run: jest.fn(async () => undefined) };
      const eventLog = { success: jest.fn().mockResolvedValue(undefined) };
      const cron = new VoucherExpiryCron(prisma as never, remote as never, eventLog as never);
      return { cron, prisma };
    }

    const mk = (id: string, usedAgoMin: number, durationMinutes: number, routerId = 'r1'): Row => ({
      id, tenantId: 't1', routerId, mikrotikId: `*${id}`, usedAt: ago(usedAgoMin), expiresAt: null,
      plan: { durationMinutes }, router: { mode: ManagementMode.REMOTE }, session: null,
    });

    // 500 tickets de 3 jours utilisés il y a 2 à 3 jours (non expirés, plus anciens), puis
    // 100 tickets de 60 min utilisés il y a 2 h (expirés) : rang SQL > 500.
    const nonExpired = (n: number) => Array.from({ length: n }, (_, i) => mk(`n${i}`, 2 * 24 * 60 + i, 4320));
    const expired = (n: number) => Array.from({ length: n }, (_, i) => mk(`e${i}`, 120 + (i % 10), 60));

    it('500 non expirés + 100 expirés au-delà du rang 200 : les 100 expirés sont traités', async () => {
      const rows = [...nonExpired(500), ...expired(100)];
      const { cron } = fakeDb(rows);
      expect(await cron.run(now)).toBe(100);
      expect(rows.filter((r) => r.id.startsWith('e')).every((r) => r.expiresAt !== null)).toBe(true);
      expect(rows.filter((r) => r.id.startsWith('n')).every((r) => r.expiresAt === null)).toBe(true);
    });

    it('la taille de lot reste 200 : 300 expirés = 200 puis 100 au passage suivant', async () => {
      const rows = [...nonExpired(500), ...expired(300)];
      const { cron } = fakeDb(rows);
      expect(await cron.run(now)).toBe(200);
      expect(await cron.run(now)).toBe(100);
      expect(await cron.run(now)).toBe(0);
    });

    it('aucun forfait enregistré : rien à faire, aucune requête de tickets', async () => {
      const { cron, prisma } = fakeDb([]);
      expect(await cron.run(now)).toBe(0);
      expect(prisma.voucher.findMany).not.toHaveBeenCalled();
    });

    it('la requête borne chaque durée de forfait par now - durée', async () => {
      const rows = [mk('a', 10, 60), mk('b', 10, 4320)];
      const { cron, prisma } = fakeDb(rows);
      await cron.run(now);
      const where = prisma.voucher.findMany.mock.calls[0]![0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { plan: { durationMinutes: 60 }, usedAt: { lte: ago(60) } },
          { plan: { durationMinutes: 4320 }, usedAt: { lte: ago(4320) } },
        ]),
      );
    });
  });
});
