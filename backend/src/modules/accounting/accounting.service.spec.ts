import { AccountingService } from './accounting.service';
import { RevenueService } from '../revenue/revenue.service';
import * as tenantCtx from '../../common/context/tenant-context';

const mockPrisma = {
  voucher: { findMany: jest.fn() },
  invoice: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
  router: { findMany: jest.fn() },
};

// `summarizeQuality` reste la vraie implémentation (logique métier partagée,
// pas remockée ici) — seul `listActivations` (la requête DB) est simulé.
const revenue = new RevenueService({} as never);

describe('AccountingService', () => {
  let service: AccountingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountingService(mockPrisma as never, revenue);
    jest
      .spyOn(tenantCtx, 'getTenantContext')
      .mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'ADMIN' as never });
  });

  describe('revenueByPeriod', () => {
    it('returns monthly buckets sorted chronologically, sourced from RevenueService', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date('2026-03-10'), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
        { usedAt: new Date('2026-03-20'), routerId: 'r1', planId: 'p1', xof: 300, source: 'EXACT' },
        { usedAt: new Date('2026-01-05'), routerId: 'r1', planId: 'p1', xof: 1000, source: 'EXACT' },
      ]);

      const result = await service.revenueByPeriod(6);

      expect(result).toHaveLength(2);
      expect(result[0].month).toBe('Janvier');
      expect(result[0].totalXof).toBe(1000);
      expect(result[0].transactionCount).toBe(1);
      expect(result[0].dataQuality).toBe('EXACT');
      expect(result[1].month).toBe('Mars');
      expect(result[1].totalXof).toBe(800);
      expect(result[1].transactionCount).toBe(2);
      expect(mockPrisma.voucher.findMany).not.toHaveBeenCalled();
    });

    it('returns empty array when no data', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([]);
      const result = await service.revenueByPeriod(12);
      expect(result).toEqual([]);
    });

    it('throws when no tenant context is open', async () => {
      jest.spyOn(tenantCtx, 'getTenantContext').mockReturnValue(undefined);
      await expect(service.revenueByPeriod(6)).rejects.toThrow('Contexte tenant manquant');
    });

    it('expose la qualité par bucket mensuel (audit/55 étape 6 — plus jamais perdue)', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date('2026-03-10'), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
        { usedAt: new Date('2026-03-12'), routerId: 'r1', planId: 'p1', xof: 300, source: 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' },
        { usedAt: new Date('2026-03-14'), routerId: 'r1', planId: 'p1', xof: null, source: 'UNKNOWN' },
      ]);
      const result = await service.revenueByPeriod(6);
      expect(result).toHaveLength(1);
      expect(result[0].exactXof).toBe(500);
      expect(result[0].estimatedXof).toBe(300);
      expect(result[0].unknownSalesCount).toBe(1);
      expect(result[0].dataQuality).toBe('INCOMPLETE');
    });
  });

  describe('revenueByRouter', () => {
    it('groups by router sorted by revenue desc, sourced from RevenueService', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
        { usedAt: new Date(), routerId: 'r2', planId: 'p1', xof: 2000, source: 'EXACT' },
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
      ]);
      mockPrisma.router.findMany.mockResolvedValue([
        { id: 'r1', identity: 'R1', alias: 'Café' },
        { id: 'r2', identity: 'R2', alias: null },
      ]);

      const result = await service.revenueByRouter();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          routerId: 'r2',
          routerName: 'R2',
          totalXof: 2000,
          transactionCount: 1,
          dataQuality: 'EXACT',
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          routerId: 'r1',
          routerName: 'Café',
          totalXof: 1000,
          transactionCount: 2,
        }),
      );
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
    it('creates invoice with correct amount from voucher sum (unchanged, SaaS Invoice path — never uses RevenueService)', async () => {
      const spy = jest.spyOn(revenue, 'listActivations');

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
      expect(spy).not.toHaveBeenCalled();
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
