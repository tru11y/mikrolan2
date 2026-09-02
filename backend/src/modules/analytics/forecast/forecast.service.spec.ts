import { ForecastService } from './forecast.service';
import { AnalyticsService } from '../analytics.service';
import { RevenueService, type ActivationLine } from '../../revenue/revenue.service';
import * as tenantCtx from '../../../common/context/tenant-context';

const mockPrisma = {
  tenant: { findUnique: jest.fn() },
  router: { findMany: jest.fn(), findFirst: jest.fn() },
  plan: { findMany: jest.fn(), findFirst: jest.fn() },
  session: { findMany: jest.fn() },
  voucher: { count: jest.fn() },
};

const revenue = new RevenueService({} as never);

function daily(days: number, valuePerDay: (i: number) => number, planId = 'p1', routerId = 'r1'): ActivationLine[] {
  const lines: ActivationLine[] = [];
  const now = new Date('2026-08-25T00:00:00.000Z');
  for (let i = 0; i < days; i++) {
    const value = valuePerDay(i);
    if (value <= 0) continue;
    const at = new Date(now.getTime() - (days - i) * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
    lines.push({ usedAt: at, routerId, planId, xof: value, source: 'EXACT' });
  }
  return lines;
}

describe('ForecastService', () => {
  let analytics: AnalyticsService;
  let service: ForecastService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    mockPrisma.tenant.findUnique.mockResolvedValue({ timezone: 'Africa/Abidjan' });
    jest.spyOn(tenantCtx, 'getTenantContext').mockReturnValue({ tenantId: 't1', userId: 'u1', role: 'OWNER' as never });
    analytics = new AnalyticsService(mockPrisma as never, revenue);
    service = new ForecastService(mockPrisma as never, revenue, analytics);
  });

  afterEach(() => jest.useRealTimers());

  describe('forecast — seuils de données', () => {
    it('1. historique insuffisant (moins de 28 jours) -> INSUFFICIENT_DATA, aucun point', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue(daily(10, () => 100));
      const result = await service.forecast({ horizonDays: 7 });
      expect(result.revenueForecast.confidence).toBe('INSUFFICIENT_DATA');
      expect(result.revenueForecast.points).toEqual([]);
      expect(result.revenueForecast.warnings.length).toBeGreaterThan(0);
    });

    it("2. historique exactement au seuil (28 jours, jours actifs et volume suffisants) -> prévision produite", async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue(daily(30, () => 100));
      const result = await service.forecast({ horizonDays: 7 });
      expect(result.revenueForecast.confidence).not.toBe('INSUFFICIENT_DATA');
      expect(result.revenueForecast.points).toHaveLength(7);
    });

    it('3. historique largement supérieur au seuil -> prévision avec comparaison de modèles complète', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue(daily(90, () => 200));
      const result = await service.forecast({ horizonDays: 7 });
      expect(result.revenueForecast.modelComparison.length).toBe(6);
    });

    it("31. routeur avec historique insuffisant reste visible dans /forecast/routers avec INSUFFICIENT_DATA", async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([{ id: 'r1', identity: 'R1', alias: null }]);
      const result = await service.forecastRouters();
      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe('INSUFFICIENT_DATA');
      expect(result[0].forecastRevenueXof).toBeNull();
    });

    it('32. forfait avec historique insuffisant reste visible dans /forecast/plans avec INSUFFICIENT_DATA', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([]);
      mockPrisma.plan.findMany.mockResolvedValue([{ id: 'p1', name: 'Plan 1' }]);
      const result = await service.forecastPlans();
      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe('INSUFFICIENT_DATA');
      expect(result[0].expectedDemand).toBeNull();
    });
  });

  describe('forecast — intégrité des valeurs', () => {
    it('25. montants XOF entiers, 26. ventes entières, 27. aucun NaN/Infinity', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue(daily(60, (i) => 100 + (i % 5) * 33.33));
      const result = await service.forecast({ horizonDays: 5 });
      for (const p of result.revenueForecast.points) {
        expect(Number.isInteger(p.predicted)).toBe(true);
        expect(Number.isFinite(p.predicted)).toBe(true);
        expect(Number.isFinite(p.lowerBound)).toBe(true);
        expect(Number.isFinite(p.upperBound)).toBe(true);
      }
      for (const p of result.salesForecast.points) {
        expect(Number.isInteger(p.predicted)).toBe(true);
      }
    });

    it('24. lowerBound >= 0 et upperBound >= predicted', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue(daily(60, (i) => (i % 7 === 0 ? 5000 : 50)));
      const result = await service.forecast({ horizonDays: 7 });
      for (const p of result.revenueForecast.points) {
        expect(p.lowerBound).toBeGreaterThanOrEqual(0);
        expect(p.upperBound).toBeGreaterThanOrEqual(p.predicted);
      }
    });
  });

  describe('forecast — isolation et filtres', () => {
    it("28. isolation tenant : toutes les requêtes portent le tenantId du contexte, jamais un paramètre client", async () => {
      const spy = jest.spyOn(revenue, 'listActivations').mockResolvedValue(daily(30, () => 100));
      await service.forecast({ horizonDays: 7 });
      for (const [q] of spy.mock.calls) expect(q.tenantId).toBe('t1');
    });

    it("29. filtre routerId d'un autre tenant rejeté (400)", async () => {
      mockPrisma.router.findFirst.mockResolvedValue(null);
      await expect(service.forecast({ horizonDays: 7, routerId: 'foreign' })).rejects.toThrow();
    });

    it('30. filtre planId d\'un autre tenant rejeté (400)', async () => {
      mockPrisma.plan.findFirst.mockResolvedValue(null);
      await expect(service.forecast({ horizonDays: 7, planId: 'foreign' })).rejects.toThrow();
    });
  });

  describe('forecastTraffic — affluence prévue', () => {
    it('33. ventes et sessions toujours séparées, jamais mélangées', async () => {
      const now = Date.now();
      const manyLines: ActivationLine[] = Array.from({ length: 150 }, (_, i) => ({
        usedAt: new Date(now - (i % 40) * 24 * 60 * 60 * 1000 - (i % 24) * 3600_000),
        routerId: 'r1',
        planId: 'p1',
        xof: 100,
        source: 'EXACT' as const,
      }));
      jest.spyOn(revenue, 'listActivations').mockResolvedValue(manyLines);
      mockPrisma.session.findMany.mockResolvedValue(
        Array.from({ length: 120 }, (_, i) => ({ startedAt: new Date(now - i * 3600_000) })),
      );
      const result = await service.forecastTraffic();
      expect(result.salesPeakDays).not.toEqual(result.sessionsPeakDays);
      expect(result.confidence).not.toBe('INSUFFICIENT_DATA');
    });

    it('historique insuffisant pour l\'affluence horaire -> INSUFFICIENT_DATA avec raison explicite', async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue(daily(5, () => 10));
      mockPrisma.session.findMany.mockResolvedValue([]);
      const result = await service.forecastTraffic();
      expect(result.confidence).toBe('INSUFFICIENT_DATA');
      expect(result.insufficientDataReason).toBeTruthy();
    });
  });

  describe('insights — pas de causalité inventée', () => {
    it("39. aucun langage causal détecté dans les insights générés (recherche de connecteurs de cause)", async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue(daily(30, () => 300));
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([{ id: 'r1', identity: 'R1', alias: null }]);
      mockPrisma.plan.findMany.mockResolvedValue([]);
      mockPrisma.session.findMany.mockResolvedValue([]);
      mockPrisma.voucher.count.mockResolvedValue(50);
      const insights = await service.insights();
      const causalWords = /parce que|à cause de|grâce à|entraîne|provoque|cause/i;
      for (const insight of insights) {
        expect(causalWords.test(insight.observation)).toBe(false);
      }
    });

    it("données insuffisantes globales -> un seul insight INSUFFICIENT_DATA, jamais un faux insight", async () => {
      jest.spyOn(revenue, 'listActivations').mockResolvedValue([]);
      jest.spyOn(revenue, 'revenueByPlan').mockResolvedValue([]);
      mockPrisma.router.findMany.mockResolvedValue([]);
      mockPrisma.plan.findMany.mockResolvedValue([]);
      mockPrisma.session.findMany.mockResolvedValue([]);
      mockPrisma.voucher.count.mockResolvedValue(0);
      const insights = await service.insights();
      expect(insights).toHaveLength(1);
      expect(insights[0].type).toBe('INSUFFICIENT_DATA');
    });
  });
});
