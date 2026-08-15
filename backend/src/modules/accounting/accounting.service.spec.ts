import { AccountingService } from './accounting.service';
import * as tenantCtx from '../../common/context/tenant-context';

const mockPrisma = {
  voucher: { findMany: jest.fn() },
  invoice: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
};

describe('AccountingService', () => {
  let service: AccountingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountingService(mockPrisma as never);
  });

  describe('revenueByPeriod', () => {
    it('returns monthly buckets sorted chronologically', async () => {
      mockPrisma.voucher.findMany.mockResolvedValue([
        { usedAt: new Date('2026-03-10'), plan: { priceXof: 500 } },
        { usedAt: new Date('2026-03-20'), plan: { priceXof: 300 } },
        { usedAt: new Date('2026-01-05'), plan: { priceXof: 1000 } },
      ]);

      const result = await service.revenueByPeriod(6);

      expect(result).toHaveLength(2);
      expect(result[0].month).toBe('Janvier');
      expect(result[0].totalXof).toBe(1000);
      expect(result[0].transactionCount).toBe(1);
      expect(result[1].month).toBe('Mars');
      expect(result[1].totalXof).toBe(800);
      expect(result[1].transactionCount).toBe(2);
    });

    it('returns empty array when no data', async () => {
      mockPrisma.voucher.findMany.mockResolvedValue([]);
      const result = await service.revenueByPeriod(12);
      expect(result).toEqual([]);
    });
  });

  describe('revenueByRouter', () => {
    it('groups by router sorted by revenue desc', async () => {
      mockPrisma.voucher.findMany.mockResolvedValue([
        { routerId: 'r1', router: { identity: 'R1', alias: 'Café' }, plan: { priceXof: 500 } },
        { routerId: 'r2', router: { identity: 'R2', alias: null }, plan: { priceXof: 2000 } },
        { routerId: 'r1', router: { identity: 'R1', alias: 'Café' }, plan: { priceXof: 500 } },
      ]);

      const result = await service.revenueByRouter();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        routerId: 'r2',
        routerName: 'R2',
        totalXof: 2000,
        transactionCount: 1,
      });
      expect(result[1]).toEqual({
        routerId: 'r1',
        routerName: 'Café',
        totalXof: 1000,
        transactionCount: 2,
      });
    });
  });

  describe('invoices', () => {
    it('returns paginated results with correct InvoiceItem shape', async () => {
      const created = new Date('2026-06-15');
      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          amount: 5000,
          status: 'PAID',
          paidAt: created,
          createdAt: created,
          billingPeriod: 'MONTHLY',
          periodDays: 30,
          idempotencyKey: 'k1',
        },
      ]);
      mockPrisma.invoice.count.mockResolvedValue(1);

      const result = await service.invoices(1, 20);

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.items).toHaveLength(1);

      const item = result.items[0];
      expect(item.id).toBe('inv-1');
      expect(item.status).toBe('PAID');
      expect(item.subtotalXof).toBe(5000);
      expect(item.taxXof).toBe(0);
      expect(item.totalXof).toBe(5000);
      expect(item.number).toMatch(/^INV-2026-/);
      expect(item.createdAt).toBe(created.toISOString());
    });
  });

  describe('generateInvoice', () => {
    it('creates invoice with correct amount from voucher sum', async () => {
      jest.spyOn(tenantCtx, 'getTenantContext').mockReturnValue({
        tenantId: 't1',
        userId: 'u1',
        role: 'ADMIN' as never,
      });

      mockPrisma.voucher.findMany.mockResolvedValue([
        { plan: { priceXof: 500 } },
        { plan: { priceXof: 1500 } },
      ]);

      const created = new Date('2026-07-01');
      mockPrisma.invoice.create.mockResolvedValue({
        id: 'inv-new',
        amount: 2000,
        status: 'PENDING',
        paidAt: null,
        createdAt: created,
        billingPeriod: 'MONTHLY',
        periodDays: 30,
        idempotencyKey: 'k',
      });

      const result = await service.generateInvoice('2026-06-01', '2026-07-01');

      expect(result.subtotalXof).toBe(2000);
      expect(result.totalXof).toBe(2000);
      expect(result.status).toBe('DRAFT');
      expect(result.id).toBe('inv-new');
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            amount: 2000,
          }),
        }),
      );
    });
  });
});
