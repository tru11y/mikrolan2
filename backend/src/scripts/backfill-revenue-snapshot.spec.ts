import { VoucherStatus } from '@prisma/client';
import { backfillRevenueSnapshot } from './backfill-revenue-snapshot';

const mockPrisma: Record<string, any> = {
  voucher: { findMany: jest.fn(), updateMany: jest.fn() },
};

beforeEach(() => {
  jest.resetAllMocks();
  mockPrisma.voucher.updateMany.mockResolvedValue({ count: 1 });
});

const row = (id: string, priceXof: number | null) => ({
  id,
  plan: priceXof === null ? null : { priceXof, deletedAt: null },
});

describe('backfillRevenueSnapshot — dry-run (comportement par défaut)', () => {
  it("dry-run n'écrit jamais (aucun appel à updateMany)", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([row('v1', 500)]);
    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: false, batchSize: 500 });
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
    expect(counters.updated).toBe(1);
  });

  it('dry-run avec zéro ligne termine immédiatement', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: false, batchSize: 500 });
    expect(counters.eligibleFound).toBe(0);
    expect(counters.batches).toBe(1);
  });
});

describe('backfillRevenueSnapshot — dry-run multi-lots (corrige audit/56 §4 : ne plus s\'arrêter au premier lot)', () => {
  it('dry-run parcourt plusieurs lots quand il y a plus de lignes que batchSize', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500), row('v2', 500)])
      .mockResolvedValueOnce([row('v3', 500)]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: false, batchSize: 2 });

    expect(counters.batches).toBe(2);
    expect(counters.eligibleFound).toBe(3);
    expect(counters.updated).toBe(3);
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
  });

  it('dry-run avec exactement batchSize lignes déclenche un lot supplémentaire vide qui termine', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500), row('v2', 500)])
      .mockResolvedValueOnce([]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: false, batchSize: 2 });

    expect(counters.batches).toBe(2);
    expect(counters.eligibleFound).toBe(2);
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
  });

  it('dry-run avec plusieurs lots entièrement invalides à la suite parcourt tout et termine', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 0)])
      .mockResolvedValueOnce([row('v2', 0)])
      .mockResolvedValueOnce([row('v3', 0)])
      .mockResolvedValueOnce([]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: false, batchSize: 1 });

    expect(counters.batches).toBe(4);
    expect(counters.skippedInvalidPrice).toBe(3);
    expect(counters.updated).toBe(0);
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
    const wheres = mockPrisma.voucher.findMany.mock.calls.map((c: any[]) => c[0].where.id);
    expect(wheres[0]).toBeUndefined();
    expect(wheres[1]).toEqual({ gt: 'v1' });
    expect(wheres[2]).toEqual({ gt: 'v2' });
    expect(wheres[3]).toEqual({ gt: 'v3' });
  });

  it("dry-run n'écrit jamais, quel que soit le nombre de lots traversés", async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500)])
      .mockResolvedValueOnce([row('v2', 500)])
      .mockResolvedValueOnce([row('v3', 500)])
      .mockResolvedValueOnce([]);

    await backfillRevenueSnapshot(mockPrisma as any, { apply: false, batchSize: 1 });

    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
  });

  it('dry-run : les compteurs finaux couvrent la totalité du jeu, pas seulement le premier lot', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500), row('v2', 0)])
      .mockResolvedValueOnce([row('v3', 500), row('v4', 0)])
      .mockResolvedValueOnce([row('v5', 500)]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: false, batchSize: 2 });

    expect(counters.eligibleFound).toBe(5);
    expect(counters.updated).toBe(3);
    expect(counters.skippedInvalidPrice).toBe(2);
    expect(counters.batches).toBe(3);
  });

  it('dry-run : terminaison garantie sur un scénario dégénéré (250 lots), aucune boucle infinie', async () => {
    let call = 0;
    mockPrisma.voucher.findMany.mockImplementation(() => {
      call += 1;
      if (call > 250) return Promise.resolve([]);
      return Promise.resolve([row(`v${call}`, 0)]);
    });

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: false, batchSize: 1 });

    expect(counters.batches).toBe(251);
    expect(counters.skippedInvalidPrice).toBe(250);
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
  }, 10_000);

  it('--apply reste inchangé (écrit réellement) après la correction du dry-run', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500)])
      .mockResolvedValueOnce([row('v2', 500)])
      .mockResolvedValueOnce([]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 1 });

    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledTimes(2);
    expect(counters.updated).toBe(2);
  });

  it('logs — les compteurs agrégés dry-run multi-lots ne contiennent aucun identifiant métier', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500)])
      .mockResolvedValueOnce([row('v2', 0)])
      .mockResolvedValueOnce([]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: false, batchSize: 1 });

    expect(JSON.stringify(counters)).not.toMatch(/v1|v2|voucher|tenant|router|plan/i);
  });
});

describe('backfillRevenueSnapshot — terminaison garantie (audit/54 §8.1, corrigé audit/55 étape 4)', () => {
  it('un lot entièrement valide (batchSize non atteint) termine en un seul lot', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([row('v1', 500), row('v2', 300)]);
    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });
    expect(counters.batches).toBe(1);
    expect(counters.updated).toBe(2);
  });

  it('un lot entièrement invalide termine (curseur avance, ne boucle pas sur les mêmes lignes)', async () => {
    // batchSize=2, exactement 2 lignes invalides -> un seul lot plein
    // rencontré, puis un second lot vide (curseur dépassé) qui termine.
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 0), row('v2', null)])
      .mockResolvedValueOnce([]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 2 });

    expect(counters.batches).toBe(2);
    expect(counters.skippedInvalidPrice).toBe(2);
    expect(counters.updated).toBe(0);
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
  });

  it("une ligne invalide unique avec batchSize=1 termine (ne boucle jamais indéfiniment)", async () => {
    mockPrisma.voucher.findMany.mockResolvedValueOnce([row('v1', 0)]).mockResolvedValueOnce([]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 1 });

    expect(counters.batches).toBe(2);
    expect(counters.skippedInvalidPrice).toBe(1);
  });

  it('plusieurs lots entièrement invalides à la suite terminent tous (curseur avance à chaque lot, jamais de relecture)', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 0)])
      .mockResolvedValueOnce([row('v2', 0)])
      .mockResolvedValueOnce([row('v3', 0)])
      .mockResolvedValueOnce([]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 1 });

    expect(counters.batches).toBe(4);
    expect(counters.skippedInvalidPrice).toBe(3);
    // Vérifie que chaque appel successif utilise bien un curseur différent
    // (id > dernier id vu), pas la même page relue indéfiniment.
    const wheres = mockPrisma.voucher.findMany.mock.calls.map((c: any[]) => c[0].where.id);
    expect(wheres[0]).toBeUndefined(); // premier appel : pas de curseur
    expect(wheres[1]).toEqual({ gt: 'v1' });
    expect(wheres[2]).toEqual({ gt: 'v2' });
    expect(wheres[3]).toEqual({ gt: 'v3' });
  });

  it('mélange valide/invalide dans un même lot : le curseur avance quand même jusqu\'à la dernière ligne du lot', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500), row('v2', 0), row('v3', 300)])
      .mockResolvedValueOnce([]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 3 });

    expect(counters.updated).toBe(2);
    expect(counters.skippedInvalidPrice).toBe(1);
    expect(mockPrisma.voucher.findMany.mock.calls[1][0].where.id).toEqual({ gt: 'v3' });
  });

  it('nombre de lignes exactement égal à batchSize déclenche un lot supplémentaire vide qui termine proprement', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500), row('v2', 500)])
      .mockResolvedValueOnce([]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 2 });

    expect(counters.batches).toBe(2);
    expect(counters.updated).toBe(2);
  });

  it('nombre de lignes supérieur à batchSize traite plusieurs lots pleins puis un lot partiel final', async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500), row('v2', 500)])
      .mockResolvedValueOnce([row('v3', 500)]);

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 2 });

    expect(counters.batches).toBe(2);
    expect(counters.updated).toBe(3);
    expect(counters.eligibleFound).toBe(3);
  });

  it('garde-fou : le nombre de lots reste borné même sur un scénario dégénéré (pas de boucle infinie réelle observable en test)', async () => {
    // 250 lignes invalides d'affilée, batchSize=1 -> doit terminer en un
    // temps de test raisonnable (pas de timeout Jest déclenché).
    let call = 0;
    mockPrisma.voucher.findMany.mockImplementation(() => {
      call += 1;
      if (call > 250) return Promise.resolve([]);
      return Promise.resolve([row(`v${call}`, 0)]);
    });

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 1 });

    expect(counters.batches).toBe(251);
    expect(counters.skippedInvalidPrice).toBe(250);
  }, 10_000);
});

describe('backfillRevenueSnapshot — mode --apply explicite', () => {
  it('écrit priceXofAtActivation et priceSnapshotSource=ESTIMATED_FROM_CURRENT_PLAN_PRICE', async () => {
    mockPrisma.voucher.findMany.mockResolvedValueOnce([row('v1', 500)]).mockResolvedValueOnce([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });

    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledWith({
      where: { id: 'v1', priceXofAtActivation: null, priceSnapshotSource: null },
      data: { priceXofAtActivation: 500, priceSnapshotSource: 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' },
    });
  });

  it("le SELECT ne cible que ACTIVE/USED, usedAt non nul, snapshot ET provenance encore nuls (jamais qualifié), trié par id", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });

    expect(mockPrisma.voucher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: [VoucherStatus.ACTIVE, VoucherStatus.USED] },
          usedAt: { not: null },
          priceXofAtActivation: null,
          priceSnapshotSource: null,
        },
        orderBy: { id: 'asc' },
      }),
    );
  });

  it("aucune ligne invalide n'est jamais modifiée", async () => {
    mockPrisma.voucher.findMany.mockResolvedValueOnce([row('v1', 0), row('v2', null)]).mockResolvedValueOnce([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
  });

  it("provenance toujours ESTIMATED_FROM_CURRENT_PLAN_PRICE, jamais EXACT", async () => {
    mockPrisma.voucher.findMany.mockResolvedValueOnce([row('v1', 500)]).mockResolvedValueOnce([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });
    const call = mockPrisma.voucher.updateMany.mock.calls[0][0];
    expect(call.data.priceSnapshotSource).toBe('ESTIMATED_FROM_CURRENT_PLAN_PRICE');
  });

  it('deuxième exécution sans nouvelle ligne éligible ne modifie rien de plus (idempotent)', async () => {
    mockPrisma.voucher.findMany.mockResolvedValueOnce([row('v1', 500)]).mockResolvedValueOnce([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });
    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledTimes(1);

    mockPrisma.voucher.updateMany.mockClear();
    mockPrisma.voucher.findMany.mockResolvedValueOnce([]);
    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });

    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
    expect(counters.updated).toBe(0);
  });

  it('ordre stable garanti par orderBy id asc sur chaque appel', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });
    expect(mockPrisma.voucher.findMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' });
  });

  it("interruption puis reprise : le curseur d'une nouvelle exécution repart de zéro (pas d'état partagé), la protection anti-écrasement (priceXofAtActivation: null) empêche toute double écriture", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([row('v1', 500)]);
    mockPrisma.voucher.updateMany.mockResolvedValue({ count: 0 }); // déjà traité par un run antérieur interrompu

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });

    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ priceXofAtActivation: null, priceSnapshotSource: null }),
      }),
    );
    expect(counters.updated).toBe(0);
  });

  it('journaux — aucun identifiant métier (voucher, tenant, routeur, forfait) dans les compteurs', async () => {
    mockPrisma.voucher.findMany.mockResolvedValueOnce([row('v1', 500)]).mockResolvedValueOnce([]);
    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });
    expect(JSON.stringify(counters)).not.toMatch(/v1|voucher|tenant|router|plan/i);
  });
});

describe('backfillRevenueSnapshot — préservation des classifications existantes (corrige audit/61 §7)', () => {
  it("1. ligne vierge (priceXofAtActivation:null, priceSnapshotSource:null) : le SELECT exige explicitement les deux conditions", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });
    const where = mockPrisma.voucher.findMany.mock.calls[0][0].where;
    expect(where.priceXofAtActivation).toBeNull();
    expect(where.priceSnapshotSource).toBeNull();
  });

  it('2-6. le WHERE du SELECT et celui de UPDATE excluent systématiquement toute ligne déjà qualifiée (UNKNOWN, provenance invalide, EXACT, ESTIMATED, ou montant orphelin) — un vrai PostgreSQL ne renverrait jamais ces lignes sous ce filtre', async () => {
    // Une DB réelle sous ce WHERE ne renvoie jamais de ligne portant déjà
    // UNKNOWN/EXACT/ESTIMATED/une provenance invalide, même avec un montant
    // orphelin nul — seul l'appel effectivement observé au niveau du mock
    // (findMany) prouve que le code interroge bien avec ce double filtre.
    mockPrisma.voucher.findMany.mockResolvedValueOnce([row('v1', 500)]).mockResolvedValueOnce([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });

    const selectWhere = mockPrisma.voucher.findMany.mock.calls[0][0].where;
    expect(selectWhere).toMatchObject({ priceXofAtActivation: null, priceSnapshotSource: null });

    const updateWhere = mockPrisma.voucher.updateMany.mock.calls[0][0].where;
    expect(updateWhere).toMatchObject({ priceXofAtActivation: null, priceSnapshotSource: null });
  });

  it("9-10. apply ne traite et n'écrit que des lignes null/null : chaque UPDATE répète les deux conditions, jamais une seule", async () => {
    mockPrisma.voucher.findMany
      .mockResolvedValueOnce([row('v1', 500), row('v2', 300)])
      .mockResolvedValueOnce([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });

    for (const call of mockPrisma.voucher.updateMany.mock.calls) {
      expect(call[0].where.priceXofAtActivation).toBeNull();
      expect(call[0].where.priceSnapshotSource).toBeNull();
    }
    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledTimes(2);
  });

  it('11. concurrence : une ligne lue null/null mais qualifiée entre-temps par un autre processus (updateMany renvoie count:0) — jamais comptée comme mise à jour, jamais réécrite une seconde fois', async () => {
    mockPrisma.voucher.findMany.mockResolvedValueOnce([row('v1', 500)]).mockResolvedValueOnce([]);
    mockPrisma.voucher.updateMany.mockResolvedValueOnce({ count: 0 }); // qualifiée entre lecture et écriture

    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });

    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.voucher.updateMany.mock.calls[0][0].where).toMatchObject({
      priceXofAtActivation: null,
      priceSnapshotSource: null,
    });
    expect(counters.updated).toBe(0); // la condition anti-écrasement a empêché le comptage
  });

  it('12. second apply après un premier passage complet : zéro réécriture (idempotence explicitement vérifiée après le correctif)', async () => {
    mockPrisma.voucher.findMany.mockResolvedValueOnce([row('v1', 500)]).mockResolvedValueOnce([]);
    await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });
    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledTimes(1);

    mockPrisma.voucher.updateMany.mockClear();
    mockPrisma.voucher.findMany.mockReset();
    // La ligne v1 est désormais qualifiée (ESTIMATED) -> un vrai PostgreSQL
    // sous le nouveau WHERE ne la renverrait plus jamais.
    mockPrisma.voucher.findMany.mockResolvedValueOnce([]);
    const counters = await backfillRevenueSnapshot(mockPrisma as any, { apply: true, batchSize: 500 });

    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
    expect(counters.updated).toBe(0);
  });
});
