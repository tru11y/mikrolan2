import { VoucherStatus, SessionStatus } from '@prisma/client';
import { MetricsService } from './metrics.service';

const mockPrisma = {
  voucher: { findMany: jest.fn() },
  session: { count: jest.fn() },
};

function buildService() {
  return new MetricsService(mockPrisma as any);
}

beforeEach(() => jest.clearAllMocks());

const makePlan = (id = 'p1', name = 'Forfait 1h', priceXof = 200) => ({
  id,
  name,
  priceXof,
});

describe('MetricsService', () => {
  describe('summary', () => {
    it('counts revenue from redeemed vouchers only', async () => {
      const service = buildService();
      const plan = makePlan();
      mockPrisma.voucher.findMany
        .mockResolvedValueOnce([
          { status: VoucherStatus.ACTIVE, plan },
          { status: VoucherStatus.USED, plan },
          { status: VoucherStatus.GENERATED, plan },
        ])
        .mockResolvedValueOnce([]);
      mockPrisma.session.count.mockResolvedValue(1);

      const result = await service.summary({ period: '30d' });

      expect(result.revenueXof).toBe(400);
      expect(result.ticketsUsed).toBe(2);
      expect(result.ticketsGenerated).toBe(3);
      expect(result.activeSessions).toBe(1);
    });

    it('calculates trend percentage vs previous period', async () => {
      const service = buildService();
      const plan = makePlan('p1', 'P', 1000);
      mockPrisma.voucher.findMany
        .mockResolvedValueOnce([{ status: VoucherStatus.USED, plan }])
        .mockResolvedValueOnce([
          { status: VoucherStatus.USED, plan: makePlan('p1', 'P', 500) },
        ]);
      mockPrisma.session.count.mockResolvedValue(0);

      const result = await service.summary({ period: '30d' });

      expect(result.trendPct).toBe(100);
    });

    it('trend is null when no previous revenue', async () => {
      const service = buildService();
      mockPrisma.voucher.findMany
        .mockResolvedValueOnce([
          { status: VoucherStatus.USED, plan: makePlan() },
        ])
        .mockResolvedValueOnce([]);
      mockPrisma.session.count.mockResolvedValue(0);

      const result = await service.summary({ period: 'today' });
      expect(result.trendPct).toBeNull();
    });

    it('groups by plan in byPlan breakdown', async () => {
      const service = buildService();
      const p1 = makePlan('p1', '1h', 200);
      const p2 = makePlan('p2', '24h', 500);
      mockPrisma.voucher.findMany
        .mockResolvedValueOnce([
          { status: VoucherStatus.USED, plan: p1 },
          { status: VoucherStatus.ACTIVE, plan: p1 },
          { status: VoucherStatus.USED, plan: p2 },
        ])
        .mockResolvedValueOnce([]);
      mockPrisma.session.count.mockResolvedValue(0);

      const result = await service.summary({ period: '7d' });
      expect(result.byPlan).toHaveLength(2);
      const planP2 = result.byPlan.find((b) => b.planId === 'p2');
      expect(planP2?.sold).toBe(1);
      expect(planP2?.revenueXof).toBe(500);
    });
  });

  describe('recentClients', () => {
    it('returns recent redeemed vouchers with online flag', async () => {
      const service = buildService();
      const now = new Date();
      mockPrisma.voucher.findMany.mockResolvedValue([
        {
          id: 'v1',
          code: 'ABC123',
          status: VoucherStatus.ACTIVE,
          usedAt: now,
          plan: { name: '1h', priceXof: 200 },
          router: { identity: 'R1', alias: null },
          session: {
            macAddress: 'AA:BB:CC',
            ipAddress: '10.0.0.1',
            status: SessionStatus.ACTIVE,
            lastSeenAt: now,
            startedAt: now,
          },
        },
      ]);

      const result = await service.recentClients({ limit: 10 });
      expect(result[0].online).toBe(true);
      expect(result[0].routerName).toBe('R1');
    });

    it('online is false when lastSeenAt > 3 min ago', async () => {
      const service = buildService();
      const old = new Date(Date.now() - 5 * 60 * 1000);
      mockPrisma.voucher.findMany.mockResolvedValue([
        {
          id: 'v1',
          code: 'XYZ',
          status: VoucherStatus.USED,
          usedAt: old,
          plan: { name: '1h', priceXof: 200 },
          router: { identity: 'R1', alias: 'MyRouter' },
          session: {
            macAddress: null,
            ipAddress: null,
            status: SessionStatus.ACTIVE,
            lastSeenAt: old,
            startedAt: old,
          },
        },
      ]);

      const result = await service.recentClients({ limit: 10 });
      expect(result[0].online).toBe(false);
      expect(result[0].routerName).toBe('MyRouter');
    });
  });
});
