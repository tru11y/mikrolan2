import { VoucherStatus, SessionStatus } from '@prisma/client';
import { MetricsService } from './metrics.service';
import * as tenantCtx from '../../common/context/tenant-context';

const mockPrisma = {
  voucher: { findMany: jest.fn(), count: jest.fn() },
  session: { count: jest.fn() },
};

const mockRevenue = {
  computeRevenue: jest.fn(),
  revenueByPlan: jest.fn(),
};

function buildService() {
  return new MetricsService(mockPrisma as any, mockRevenue as any);
}

const emptyRevenue = (overrides: Partial<Record<string, unknown>> = {}) => ({
  revenueXof: 0,
  salesCount: 0,
  valuedSalesCount: 0,
  averageSaleXof: 0,
  exactRevenueXof: 0,
  estimatedRevenueXof: 0,
  unknownSalesCount: 0,
  dataQuality: 'NO_DATA',
  period: { from: '', to: '' },
  timezone: 'Africa/Abidjan',
  lastCalculatedAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(tenantCtx, 'getTenantContext')
    .mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'ADMIN' as never });
  mockRevenue.computeRevenue.mockResolvedValue(emptyRevenue());
  mockRevenue.revenueByPlan.mockResolvedValue([]);
});

describe('MetricsService.summary', () => {
  it('delegates revenue to RevenueService — never recomputes it from Plan.priceXof itself', async () => {
    mockPrisma.voucher.count.mockResolvedValue(5);
    mockPrisma.session.count.mockResolvedValue(1);
    mockRevenue.computeRevenue
      .mockResolvedValueOnce(emptyRevenue({ revenueXof: 400, valuedSalesCount: 2 }))
      .mockResolvedValueOnce(emptyRevenue({ revenueXof: 0 }));

    const result = await buildService().summary({ period: '30d' });

    expect(result.revenueXof).toBe(400);
    expect(result.ticketsUsed).toBe(2);
    expect(result.ticketsGenerated).toBe(5);
    expect(result.activeSessions).toBe(1);
    expect(mockPrisma.voucher.findMany).not.toHaveBeenCalled();
  });

  it('ticketsGenerated counts on createdAt regardless of revenue status (distinct KPI)', async () => {
    mockPrisma.voucher.count.mockResolvedValue(3);
    mockPrisma.session.count.mockResolvedValue(0);

    const result = await buildService().summary({ period: '7d' });

    expect(result.ticketsGenerated).toBe(3);
    expect(mockPrisma.voucher.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.any(Object),
          status: { not: VoucherStatus.REVOKED },
        }),
      }),
    );
  });

  it('calculates trend percentage vs previous period from RevenueService results', async () => {
    mockPrisma.voucher.count.mockResolvedValue(0);
    mockPrisma.session.count.mockResolvedValue(0);
    mockRevenue.computeRevenue
      .mockResolvedValueOnce(emptyRevenue({ revenueXof: 1000 }))
      .mockResolvedValueOnce(emptyRevenue({ revenueXof: 500 }));

    const result = await buildService().summary({ period: '30d' });
    expect(result.trendPct).toBe(100);
  });

  it('trend is null when no previous revenue', async () => {
    mockPrisma.voucher.count.mockResolvedValue(0);
    mockPrisma.session.count.mockResolvedValue(0);
    mockRevenue.computeRevenue
      .mockResolvedValueOnce(emptyRevenue({ revenueXof: 200 }))
      .mockResolvedValueOnce(emptyRevenue({ revenueXof: 0 }));

    const result = await buildService().summary({ period: 'today' });
    expect(result.trendPct).toBeNull();
  });

  it('exposes byPlan straight from RevenueService.revenueByPlan', async () => {
    mockPrisma.voucher.count.mockResolvedValue(0);
    mockPrisma.session.count.mockResolvedValue(0);
    mockRevenue.revenueByPlan.mockResolvedValue([
      { planId: 'p1', planName: '1h', sold: 2, revenueXof: 400 },
      { planId: 'p2', planName: '24h', sold: 1, revenueXof: 500 },
    ]);

    const result = await buildService().summary({ period: '7d' });
    expect(result.byPlan).toHaveLength(2);
    const p2 = result.byPlan.find((b) => b.planId === 'p2');
    expect(p2?.sold).toBe(1);
    expect(p2?.revenueXof).toBe(500);
    expect(p2?.priceXof).toBe(500); // revenueXof / sold, average display price
  });

  it('throws when no tenant context is open', async () => {
    jest.spyOn(tenantCtx, 'getTenantContext').mockReturnValue(undefined);
    await expect(buildService().summary({ period: '30d' })).rejects.toThrow(
      'Contexte tenant manquant',
    );
  });
});

describe('MetricsService.recentClients', () => {
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
