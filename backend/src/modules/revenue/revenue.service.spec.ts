import { UserRole, VoucherStatus } from '@prisma/client';
import { RevenueService } from './revenue.service';
import * as tenantCtx from '../../common/context/tenant-context';

const mockPrisma: Record<string, any> = {
  tenant: { findUnique: jest.fn() },
  voucher: { findMany: jest.fn() },
};

function buildService() {
  return new RevenueService(mockPrisma as any);
}

const T1 = 'tenant-1';
const T2 = 'tenant-2';
const from = new Date('2026-08-01T00:00:00Z');
const to = new Date('2026-08-31T23:59:59Z');

function setContext(tenantId: string, role: UserRole = UserRole.OWNER) {
  jest.spyOn(tenantCtx, 'getTenantContext').mockReturnValue({ tenantId, userId: 'u1', role });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.tenant.findUnique.mockResolvedValue({ timezone: 'Africa/Abidjan' });
  setContext(T1);
});

describe('RevenueService — isolation tenant (audit/54 §6.1, corrigé audit/55 étape 2)', () => {
  it('injecte explicitement tenantId dans le WHERE Voucher, en plus du middleware', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });

    expect(mockPrisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: T1 }) }),
    );
  });

  it('tenant A ne voit que ses propres lignes (le WHERE porte T1, jamais T2)', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { priceXofAtActivation: 500, priceSnapshotSource: 'EXACT', plan: { priceXof: 500 } },
    ]);
    await buildService().computeRevenue({ tenantId: T1, from, to });
    const where = mockPrisma.voucher.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(T1);
    expect(where.tenantId).not.toBe(T2);
  });

  it('tenant B ne voit que les siennes — même service, tenantId différent, WHERE différent', async () => {
    setContext(T2);
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T2, from, to });
    const where = mockPrisma.voucher.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(T2);
  });

  it('absence de contexte tenant échoue de façon sûre (ForbiddenException), aucune requête Voucher émise', async () => {
    jest.spyOn(tenantCtx, 'getTenantContext').mockReturnValue(undefined);
    await expect(buildService().computeRevenue({ tenantId: T1, from, to })).rejects.toThrow(
      'aucun contexte tenant ouvert',
    );
    expect(mockPrisma.voucher.findMany).not.toHaveBeenCalled();
  });

  it('tenantId explicite différent du contexte actif (utilisateur normal) échoue de façon sûre', async () => {
    setContext(T1, UserRole.MEMBER);
    await expect(buildService().computeRevenue({ tenantId: T2, from, to })).rejects.toThrow(
      'tenantId incohérent',
    );
    expect(mockPrisma.voucher.findMany).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN avec tenantId explicite A reste scopé sur A (le WHERE porte bien tenantId:A, jamais un accès non scopé)', async () => {
    setContext('platform', UserRole.SUPER_ADMIN);
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });
    const where = mockPrisma.voucher.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(T1);
  });

  it(
    'SUPER_ADMIN dont le contexte porte SON PROPRE tenant (tenant-admin) cible explicitement un ' +
      "AUTRE tenant (tenant-cible) : le WHERE Voucher envoyé à Prisma porte bien tenant-cible, " +
      'jamais tenant-admin — comportement réel démontré, pas supposé (audit/56 §2, audit/57 étape 7). ' +
      "Note : aucune route HTTP Metrics/Accounting actuelle ne permet ce ciblage aujourd'hui — " +
      'les deux modules sourcent toujours tenantId depuis ctx.tenantId, jamais depuis une entrée ' +
      "cliente. Ce test documente le comportement du service lui-même, indépendamment de l'absence " +
      "de route qui l'exercerait en production.",
    async () => {
      const ADMIN_OWN_TENANT = 'tenant-admin';
      const TARGET_TENANT = 'tenant-cible';
      setContext(ADMIN_OWN_TENANT, UserRole.SUPER_ADMIN);
      mockPrisma.voucher.findMany.mockResolvedValue([]);

      await buildService().computeRevenue({ tenantId: TARGET_TENANT, from, to });

      const where = mockPrisma.voucher.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe(TARGET_TENANT);
      expect(where.tenantId).not.toBe(ADMIN_OWN_TENANT);
    },
  );

  it('tenantId vide échoue de façon sûre même si un contexte existe', async () => {
    await expect(buildService().computeRevenue({ tenantId: '', from, to })).rejects.toThrow(
      'tenantId requis',
    );
  });

  it('la timezone résolue correspond au même tenant que celui des vouchers interrogés', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' });
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: T1 } }),
    );
    const where = mockPrisma.voucher.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(T1);
  });
});

describe('RevenueService.computeRevenue — règle canonique (audit/51, audit/52)', () => {
  it('exclut GENERATED, EXPIRED, REVOKED — seuls ACTIVE/USED avec usedAt comptent', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });

    expect(mockPrisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [VoucherStatus.ACTIVE, VoucherStatus.USED] },
        }),
      }),
    );
  });

  it('ACTIVE avec snapshot EXACT est inclus au montant exact', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { priceXofAtActivation: 500, priceSnapshotSource: 'EXACT', plan: { priceXof: 999 } },
    ]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.exactRevenueXof).toBe(500);
    expect(result.estimatedRevenueXof).toBe(0);
    expect(result.revenueXof).toBe(500);
    expect(result.dataQuality).toBe('EXACT');
  });

  it('voucher sans snapshot (pré-migration) est reconstruit en ESTIMATED au prix courant, jamais EXACT', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { priceXofAtActivation: null, priceSnapshotSource: null, plan: { priceXof: 750 } },
    ]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.exactRevenueXof).toBe(0);
    expect(result.estimatedRevenueXof).toBe(750);
    expect(result.dataQuality).toBe('ESTIMATED');
  });

  it('priceSnapshotSource=UNKNOWN est exclu du revenu et compté séparément', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { priceXofAtActivation: null, priceSnapshotSource: 'UNKNOWN', plan: { priceXof: 100 } },
    ]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.revenueXof).toBe(0);
    expect(result.unknownSalesCount).toBe(1);
    expect(result.dataQuality).toBe('INCOMPLETE');
  });

  it('plan introuvable ou prix courant invalide (<=0) est exclu du revenu, jamais un montant à 0 comptabilisé', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { priceXofAtActivation: null, priceSnapshotSource: null, plan: { priceXof: 0 } },
      { priceXofAtActivation: null, priceSnapshotSource: null, plan: null },
    ]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.revenueXof).toBe(0);
    expect(result.unknownSalesCount).toBe(2);
  });

  it('averageSaleXof évite toute division par zéro', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.averageSaleXof).toBe(0);
    expect(result.dataQuality).toBe('NO_DATA');
  });

  it('filtre par routeur transmis au WHERE Prisma', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to, routerId: 'r1' });
    expect(mockPrisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ routerId: 'r1' }) }),
    );
  });

  it('filtre par forfait transmis au WHERE Prisma', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to, planId: 'p1' });
    expect(mockPrisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ planId: 'p1' }) }),
    );
  });

  it("n'utilise jamais createdAt pour filtrer", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });
    const where = mockPrisma.voucher.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('createdAt');
  });

  it("n'accède jamais au modèle Invoice", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(mockPrisma.invoice).toBeUndefined();
  });

  it("n'utilise jamais \\$queryRaw", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(mockPrisma.$queryRaw).toBeUndefined();
  });

  it('retombe sur Africa/Abidjan si Tenant.timezone est absent/invalide', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ timezone: 'Not/AValidZone' });
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.timezone).toBe('Africa/Abidjan');
  });

  it('respecte une timezone tenant valide différente', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' });
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.timezone).toBe('Europe/Paris');
  });
});

describe('RevenueService — bornes de période semi-ouvertes [from, to[ (audit/54 §6.2, corrigé audit/55 étape 3)', () => {
  it('le WHERE utilise gte:from et lt:to — jamais lte', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });
    const usedAtFilter = mockPrisma.voucher.findMany.mock.calls[0][0].where.usedAt;
    expect(usedAtFilter).toEqual({ gte: from, lt: to, not: null });
    expect(usedAtFilter).not.toHaveProperty('lte');
  });

  it("une activation exactement à 'from' est incluse (gte)", async () => {
    // Prouvé par le filtre Prisma lui-même (gte inclusif) — vérifié
    // structurellement ci-dessus ; ce test documente l'intention attendue.
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(mockPrisma.voucher.findMany.mock.calls[0][0].where.usedAt.gte).toEqual(from);
  });

  it("une activation exactement à 'to' est exclue (lt, pas lte)", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(mockPrisma.voucher.findMany.mock.calls[0][0].where.usedAt.lt).toEqual(to);
  });

  it('deux périodes adjacentes (précédente [from,to[ / actuelle [to,to2[) ne comptent jamais deux fois la même frontière', async () => {
    const boundary = new Date('2026-08-15T00:00:00Z');
    const previous = { tenantId: T1, from, to: boundary };
    const current = { tenantId: T1, from: boundary, to };

    mockPrisma.voucher.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await buildService().computeRevenue(previous);
    await buildService().computeRevenue(current);

    const prevFilter = mockPrisma.voucher.findMany.mock.calls[0][0].where.usedAt;
    const currFilter = mockPrisma.voucher.findMany.mock.calls[1][0].where.usedAt;
    // previous exclut la frontière (lt:boundary), current l'inclut (gte:boundary) — jamais les deux.
    expect(prevFilter.lt).toEqual(boundary);
    expect(currFilter.gte).toEqual(boundary);
  });
});

describe('RevenueService — provenance invalide (audit/54 §3 point 2, corrigé audit/55 étape 5)', () => {
  it('une valeur priceSnapshotSource hors liste fermée est classée INVALID_SOURCE, jamais ESTIMATED', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { priceXofAtActivation: null, priceSnapshotSource: 'GARBAGE', plan: { priceXof: 500 } },
    ]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.invalidSourceCount).toBe(1);
    expect(result.estimatedRevenueXof).toBe(0);
    expect(result.revenueXof).toBe(0);
  });

  it('EXACT avec un prix nul ou non positif est classé INVALID_SOURCE, jamais silencieusement requalifié en ESTIMATED', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { priceXofAtActivation: 0, priceSnapshotSource: 'EXACT', plan: { priceXof: 500 } },
      { priceXofAtActivation: -10, priceSnapshotSource: 'EXACT', plan: { priceXof: 500 } },
      { priceXofAtActivation: null, priceSnapshotSource: 'EXACT', plan: { priceXof: 500 } },
    ]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.invalidSourceCount).toBe(3);
    expect(result.exactRevenueXof).toBe(0);
    // Le prix courant du plan (500) n'est PAS utilisé comme repli — un EXACT
    // corrompu reste un signal d'anomalie, pas un ESTIMATED silencieux.
    expect(result.estimatedRevenueXof).toBe(0);
  });

  it('dataQuality = INCOMPLETE dès qu\'invalidSourceCount > 0, même avec des ventes EXACT par ailleurs', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { priceXofAtActivation: 500, priceSnapshotSource: 'EXACT', plan: { priceXof: 500 } },
      { priceXofAtActivation: null, priceSnapshotSource: 'GARBAGE', plan: { priceXof: 500 } },
    ]);
    const result = await buildService().computeRevenue({ tenantId: T1, from, to });
    expect(result.dataQuality).toBe('INCOMPLETE');
  });
});

describe('RevenueService.revenueByPlan', () => {
  it('somme globale = somme par forfait', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { priceXofAtActivation: 500, priceSnapshotSource: 'EXACT', plan: { id: 'p1', name: '1h', priceXof: 500 } },
      { priceXofAtActivation: 500, priceSnapshotSource: 'EXACT', plan: { id: 'p1', name: '1h', priceXof: 500 } },
      { priceXofAtActivation: 800, priceSnapshotSource: 'EXACT', plan: { id: 'p2', name: '24h', priceXof: 800 } },
    ]);
    const byPlan = await buildService().revenueByPlan({ tenantId: T1, from, to });
    const globalSum = byPlan.reduce((s, p) => s + p.revenueXof, 0);
    expect(globalSum).toBe(1800);
  });

  it('injecte aussi tenantId explicitement dans son WHERE', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().revenueByPlan({ tenantId: T1, from, to });
    expect(mockPrisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: T1 }) }),
    );
  });
});

describe('RevenueService.listActivations / summarizeQuality', () => {
  it('injecte tenantId explicitement dans son WHERE', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await buildService().listActivations({ tenantId: T1, from, to });
    expect(mockPrisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: T1 }) }),
    );
  });

  it('summarizeQuality agrège correctement un mélange EXACT/ESTIMATED/UNKNOWN/INVALID_SOURCE', () => {
    const service = buildService();
    const lines = [
      { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 500, source: 'EXACT' as const },
      { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: 300, source: 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' as const },
      { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: null, source: 'UNKNOWN' as const },
      { usedAt: new Date(), routerId: 'r1', planId: 'p1', xof: null, source: 'INVALID_SOURCE' as const },
    ];
    const q = service.summarizeQuality(lines);
    expect(q.exactRevenueXof).toBe(500);
    expect(q.estimatedRevenueXof).toBe(300);
    expect(q.unknownSalesCount).toBe(1);
    expect(q.invalidSourceCount).toBe(1);
    expect(q.dataQuality).toBe('INCOMPLETE');
  });
});
