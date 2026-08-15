import { MetricsService } from './metrics.service';
import { VoucherStatus, SessionStatus } from '@prisma/client';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'ADMIN',
  })),
}));

const now = new Date('2026-08-15T12:00:00Z');

function makePrisma() {
  return {
    voucher: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    session: {
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown;
}

function makeService(prisma?: unknown) {
  const p = prisma ?? makePrisma();
  return { service: new MetricsService(p as any), prisma: p as any };
}

describe('MetricsService', () => {
  describe('summary', () => {
    it('returns zero metrics when no data', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findMany.mockResolvedValue([]);
      prisma.voucher.count.mockResolvedValue(0);
      prisma.session.count.mockResolvedValue(0);

      const result = await service.summary({ period: 'today' });

      expect(result.revenueXof).toBe(0);
      expect(result.ticketsGenerated).toBe(0);
      expect(result.activeSessions).toBe(0);
      expect(result.byPlan).toEqual([]);
    });

    it('computes revenue from used vouchers', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findMany.mockResolvedValue([
        {
          id: 'v1',
          status: VoucherStatus.USED,
          usedAt: now,
          plan: { id: 'p1', name: '1h', priceXof: 500 },
        },
        {
          id: 'v2',
          status: VoucherStatus.ACTIVE,
          usedAt: now,
          plan: { id: 'p1', name: '1h', priceXof: 500 },
        },
      ]);
      prisma.voucher.count.mockResolvedValue(5);
      prisma.session.count.mockResolvedValue(1);

      const result = await service.summary({ period: '30d' });

      expect(result.revenueXof).toBe(1000);
      expect(result.ticketsUsed).toBe(2);
      expect(result.activeSessions).toBe(1);
      expect(result.byPlan).toHaveLength(1);
      expect(result.byPlan[0].sold).toBe(2);
      expect(result.byPlan[0].revenueXof).toBe(1000);
    });
  });

  describe('recentClients', () => {
    it('returns recent clients with online status', async () => {
      const recentDate = new Date(Date.now() - 60_000);
      const { service, prisma } = makeService();
      prisma.voucher.findMany.mockResolvedValue([
        {
          id: 'v1',
          code: 'ABC123',
          status: VoucherStatus.ACTIVE,
          usedAt: recentDate,
          plan: { name: '1h WiFi', priceXof: 500 },
          router: { alias: 'Café', identity: 'MK-01' },
          session: {
            status: SessionStatus.ACTIVE,
            lastSeenAt: recentDate,
            macAddress: 'AA:BB:CC:DD:EE:FF',
            ipAddress: '192.168.1.10',
          },
        },
      ]);

      const result = await service.recentClients({ limit: 10 });

      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('ABC123');
      expect(result[0].online).toBe(true);
      expect(result[0].macAddress).toBe('AA:BB:CC:DD:EE:FF');
    });
  });
});
