import { AnalyticsService } from './analytics.service';
import { RevenueService } from '../revenue/revenue.service';
import * as tenantCtx from '../../common/context/tenant-context';

const mockPrisma = {
  tenant: { findUnique: jest.fn() },
  router: { findMany: jest.fn(), findFirst: jest.fn() },
  plan: { findFirst: jest.fn() },
  session: { findMany: jest.fn() },
};

// summarizeQuality/revenueByPlan restent la vraie implémentation — seules
// les requêtes DB (listActivations) sont simulées, comme accounting.service.spec.ts.
const revenue = new RevenueService({} as never);

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsService(mockPrisma as never, revenue);
    mockPrisma.tenant.findUnique.mockResolvedValue({ timezone: 'Africa/Abidjan' });
    mockPrisma.session.findMany.mockResolvedValue([]);
    jest
      .spyOn(tenantCtx, 'getTenantContext')
      .mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'OWNER' as never });
  });

  describe('overview', () => {
    it('1. tenant A ne voit jamais de donnée de tenant B — le service ne dépend que du tenantId du contexte, jamais fourni par le client', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date('2026-08-10T10:00:00Z'), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
      ]);
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([{ id: 'r1', identity: 'R1', alias: null }]);

      await service.overview({ period: 'last30days' });

      const calls = (revenue.listActivations as jest.Mock).mock.calls;
      for (const [q] of calls) expect(q.tenantId).toBe('t1');
    });

    it('2. overview EXACT : dataQuality=EXACT, revenu = somme des montants exacts', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 300, source: 'EXACT' },
      ]);
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([]);

      const result = await service.overview({ period: 'last30days' });
      expect(result.dataQuality).toBe('EXACT');
      expect(result.revenueXof).toBe(800);
      expect(result.exactRevenueXof).toBe(800);
      expect(result.estimatedRevenueXof).toBe(0);
    });

    it('3. overview ESTIMATED : dataQuality=ESTIMATED', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 500, source: 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' },
      ]);
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([]);

      const result = await service.overview({ period: 'last30days' });
      expect(result.dataQuality).toBe('ESTIMATED');
    });

    it('4. overview MIXED : dataQuality=MIXED quand EXACT et ESTIMATED coexistent', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 300, source: 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' },
      ]);
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([]);

      const result = await service.overview({ period: 'last30days' });
      expect(result.dataQuality).toBe('MIXED');
    });

    it('5. overview INCOMPLETE : UNKNOWN/invalide exclus du revenu, comptés séparément', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: null, source: 'UNKNOWN' },
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: null, source: 'INVALID_SOURCE' },
      ]);
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([]);

      const result = await service.overview({ period: 'last30days' });
      expect(result.dataQuality).toBe('INCOMPLETE');
      expect(result.revenueXof).toBe(500);
      expect(result.unknownSalesCount).toBe(1);
      expect(result.invalidSourceCount).toBe(1);
    });

    it('6. période vide : NO_DATA, aucune division par zéro, aucun undefined/NaN', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([]);
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([]);

      const result = await service.overview({ period: 'last30days' });
      expect(result.dataQuality).toBe('NO_DATA');
      expect(result.revenueXof).toBe(0);
      expect(result.averageSaleXof).toBe(0);
      expect(JSON.stringify(result)).not.toMatch(/undefined|NaN/);
    });

    it('7-8. comparaison période précédente : croissance nulle si période précédente à zéro (jamais de division par zéro)', async () => {
      jest
        .spyOn(revenue, 'listActivations')
        .mockResolvedValueOnce([{ usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' }])
        .mockResolvedValueOnce([]); // période précédente vide
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([]);

      const result = await service.overview({ period: 'last30days' });
      expect(result.revenueGrowthPercent).toBeNull();
      expect(result.salesGrowthPercent).toBeNull();
    });

    it('14. filtre routerId : router vérifié appartenir au tenant avant tout calcul', async () => {
      mockPrisma.router.findFirst.mockResolvedValue(null); // routeur d'un autre tenant
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([]);

      await expect(service.overview({ period: 'last30days', routerId: 'other-tenant-router' })).rejects.toThrow(
        'Routeur introuvable',
      );
    });

    it('15. filtre planId : plan vérifié appartenir au tenant avant tout calcul', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(null);
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([]);

      await expect(service.overview({ period: 'last30days', planId: 'other-tenant-plan' })).rejects.toThrow(
        'Forfait introuvable',
      );
    });

    it('22. Invoice jamais utilisée — aucune référence au modèle Invoice dans le service', () => {
      const src = AnalyticsService.toString();
      expect(src).not.toMatch(/invoice/i);
    });

    it('27. montants entiers — jamais de flottant', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 333, source: 'EXACT' },
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 334, source: 'EXACT' },
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 333, source: 'EXACT' },
      ]);
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([]);

      const result = await service.overview({ period: 'last30days' });
      expect(Number.isInteger(result.averageSaleXof)).toBe(true);
      expect(Number.isInteger(result.revenueXof)).toBe(true);
    });
  });

  describe('routers — somme et contribution', () => {
    it('9. somme des routeurs = revenu global de la période', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
        { usedAt: new Date(), routerId: 'r2', planId: 'p1', xof: 300, source: 'EXACT' },
      ]);
      mockPrisma.router.findMany.mockResolvedValue([
        { id: 'r1', identity: 'R1', alias: null },
        { id: 'r2', identity: 'R2', alias: null },
      ]);

      const result = await service.routers({ period: 'last30days' });
      const sum = result.reduce((s, r) => s + r.revenueXof, 0);
      expect(sum).toBe(800);
    });

    it('10. contribution des routeurs = 100% (tolérance d\'arrondi)', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 700, source: 'EXACT' },
        { usedAt: new Date(), routerId: 'r2', planId: 'p1', xof: 300, source: 'EXACT' },
      ]);
      mockPrisma.router.findMany.mockResolvedValue([
        { id: 'r1', identity: 'R1', alias: null },
        { id: 'r2', identity: 'R2', alias: null },
      ]);

      const result = await service.routers({ period: 'last30days' });
      const totalContribution = result.reduce((s, r) => s + r.contributionPercent, 0);
      expect(Math.abs(totalContribution - 100)).toBeLessThanOrEqual(1);
    });

    it('routeur sans vente sur la période : contribution 0%, jamais de division par zéro', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([{ id: 'r1', identity: 'R1', alias: null }]);

      const result = await service.routers({ period: 'last30days' });
      expect(result[0].contributionPercent).toBe(0);
      expect(result[0].dataQuality).toBe('NO_DATA');
    });
  });

  describe('plans — classements distincts', () => {
    it('11-12-13. classement par volume distinct du classement par revenu, contribution correcte', async () => {
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([
        {
          planId: 'p-cheap-popular',
          planName: 'Cheap',
          sold: 100,
          revenueXof: 5000,
          exactRevenueXof: 5000,
          estimatedRevenueXof: 0,
          unknownSalesCount: 0,
          invalidSourceCount: 0,
          dataQuality: 'EXACT',
        },
        {
          planId: 'p-premium',
          planName: 'Premium',
          sold: 10,
          revenueXof: 8000,
          exactRevenueXof: 8000,
          estimatedRevenueXof: 0,
          unknownSalesCount: 0,
          invalidSourceCount: 0,
          dataQuality: 'EXACT',
        },
      ]);

      const result = await service.plans({ period: 'last30days' });
      // Tri par défaut = revenu décroissant : Premium (8000) avant Cheap (5000)
      expect(result[0].planId).toBe('p-premium');
      // Mais Cheap a plus de ventes que Premium — les deux classements divergent bien.
      const byVolume = [...result].sort((a, b) => b.salesCount - a.salesCount);
      expect(byVolume[0].planId).toBe('p-cheap-popular');

      const totalRevenueContribution = result.reduce((s, p) => s + p.revenueContributionPercent, 0);
      expect(Math.abs(totalRevenueContribution - 100)).toBeLessThanOrEqual(1);
    });

    it('14bis. filtre routerId sur /plans vérifié appartenir au tenant', async () => {
      mockPrisma.router.findFirst.mockResolvedValue(null);
      await expect(service.plans({ period: 'last30days', routerId: 'foreign' })).rejects.toThrow(
        'Routeur introuvable',
      );
    });
  });

  describe('traffic — heatmaps séparées', () => {
    it('19-20. heatmap ventes et heatmap sessions jamais mélangées', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([
        { usedAt: new Date('2026-08-10T10:00:00Z'), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' },
      ]);
      mockPrisma.session.findMany.mockResolvedValue([
        { startedAt: new Date('2026-08-11T14:00:00Z') },
        { startedAt: new Date('2026-08-11T14:30:00Z') },
      ]);

      const result = await service.traffic({ period: 'last30days' });
      expect(result.salesHeatmap).toHaveLength(7 * 24);
      expect(result.sessionsHeatmap).toHaveLength(7 * 24);

      const salesTotal = result.salesHeatmap.reduce((s, c) => s + c.count, 0);
      const sessionsTotal = result.sessionsHeatmap.reduce((s, c) => s + c.count, 0);
      expect(salesTotal).toBe(1);
      expect(sessionsTotal).toBe(2);
      // salesHeatmap porte un revenu, sessionsHeatmap n'en porte jamais.
      expect(result.salesHeatmap.some((c) => 'revenueXof' in c)).toBe(true);
      expect(result.sessionsHeatmap.every((c) => !('revenueXof' in c))).toBe(true);
    });
  });

  describe('sessionStats', () => {
    it('agrège sessions, durée et bytes par routeur et par plan', async () => {
      mockPrisma.session.findMany.mockResolvedValue([
        {
          routerId: 'r1',
          status: 'TERMINATED',
          bytesIn: BigInt(1024),
          bytesOut: BigInt(512),
          startedAt: new Date('2026-08-10T10:00:00Z'),
          terminatedAt: new Date('2026-08-10T10:30:00Z'),
          voucher: { planId: 'p1', plan: { name: 'Plan A' } },
          router: { identity: 'R1', alias: null },
        },
        {
          routerId: 'r1',
          status: 'ACTIVE',
          bytesIn: BigInt(2048),
          bytesOut: BigInt(256),
          startedAt: new Date('2026-08-10T11:00:00Z'),
          terminatedAt: null,
          voucher: { planId: 'p1', plan: { name: 'Plan A' } },
          router: { identity: 'R1', alias: null },
        },
      ]);

      const result = await service.sessionStats({ period: 'last30days' });
      expect(result.totalSessions).toBe(2);
      expect(result.activeSessions).toBe(1);
      expect(result.terminatedSessions).toBe(1);
      expect(result.averageDurationMinutes).toBe(30);
      expect(result.totalBytesIn).toBe('3072');
      expect(result.totalBytesOut).toBe('768');
      expect(result.byRouter).toHaveLength(1);
      expect(result.byRouter[0].routerName).toBe('R1');
      expect(result.byRouter[0].sessionCount).toBe(2);
      expect(result.byPlan).toHaveLength(1);
      expect(result.byPlan[0].planName).toBe('Plan A');
    });

    it('retourne des valeurs nulles pour durée quand aucune session terminée', async () => {
      mockPrisma.session.findMany.mockResolvedValue([]);
      const result = await service.sessionStats({ period: 'last30days' });
      expect(result.totalSessions).toBe(0);
      expect(result.averageDurationMinutes).toBeNull();
    });
  });

  describe('sécurité — pas de $queryRaw', () => {
    it("aucune requête SQL brute non scopée dans le service", () => {
      const src = AnalyticsService.toString();
      expect(src).not.toMatch(/\$queryRaw/);
    });
  });
});
