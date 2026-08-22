import { ManagementMode, VoucherStatus, SessionStatus } from '@prisma/client';
import { SessionsService } from './sessions.service';

const mockPrisma: Record<string, any> = {
  router: { findFirst: jest.fn(), findMany: jest.fn() },
  voucher: { findMany: jest.fn(), updateMany: jest.fn() },
  session: { findMany: jest.fn(), updateMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  notification: { create: jest.fn() },
};

const mockRemote = { run: jest.fn() };
const mockEvents = { publish: jest.fn() };
const mockNotifications = { sendPushToTenant: jest.fn() };

function buildService() {
  return new SessionsService(
    mockPrisma as any,
    mockRemote as any,
    mockEvents as any,
    mockNotifications as any,
  );
}

const ROUTER = { id: 'router-1', mode: ManagementMode.LOCAL, tenantId: 'tenant-1' };

const GENERATED_VOUCHER = {
  id: 'voucher-1',
  code: 'ABC123',
  status: VoucherStatus.GENERATED,
  session: null,
  plan: { priceXof: 500 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.router.findFirst.mockResolvedValue(ROUTER);
  mockPrisma.session.findMany.mockResolvedValue([]); // no ended sessions
  mockPrisma.voucher.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.session.create.mockResolvedValue({});
  mockPrisma.session.update.mockResolvedValue({});
  mockPrisma.notification.create.mockResolvedValue({});
});

const activeSession = (user = 'ABC123') => [
  { id: 'rt1', user, ipAddress: '10.0.0.5', macAddress: 'AA:BB', bytesIn: '0', bytesOut: '0', uptime: '1m' },
];

describe('SessionsService — snapshot du prix à l\'activation (audit/51, audit/52)', () => {
  it('écrit le prix exact et la provenance EXACT lors du passage GENERATED → ACTIVE', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([GENERATED_VOUCHER]);

    await buildService().syncFromLan('router-1', activeSession());

    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledWith({
      where: { id: 'voucher-1', status: VoucherStatus.GENERATED },
      data: expect.objectContaining({
        status: VoucherStatus.ACTIVE,
        priceXofAtActivation: 500,
        priceSnapshotSource: 'EXACT',
      }),
    });
  });

  it('écrit usedAt dans la même opération que le snapshot de prix', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([GENERATED_VOUCHER]);

    await buildService().syncFromLan('router-1', activeSession());

    const call = mockPrisma.voucher.updateMany.mock.calls[0][0];
    expect(call.data.usedAt).toBeInstanceOf(Date);
    expect(call.data.priceXofAtActivation).toBe(500);
  });

  it("retry (l'updateMany conditionnel échoue) ne réécrit rien et n'ouvre pas de session", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([GENERATED_VOUCHER]);
    mockPrisma.voucher.updateMany.mockResolvedValue({ count: 0 }); // un autre tick est arrivé avant

    await buildService().syncFromLan('router-1', activeSession());

    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.session.create).not.toHaveBeenCalled();
  });

  it('double activation concurrente ne produit qu\'une seule promotion (verrou optimiste préexistant, snapshot inclus)', async () => {
    // Deux ticks quasi simultanés sur le même voucher : le premier gagne
    // (count:1), le second échoue la condition WHERE status=GENERATED (count:0).
    mockPrisma.voucher.findMany.mockResolvedValue([GENERATED_VOUCHER]);
    mockPrisma.voucher.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const service = buildService();
    await service.syncFromLan('router-1', activeSession());
    await service.syncFromLan('router-1', activeSession());

    expect(mockPrisma.session.create).toHaveBeenCalledTimes(1);
  });

  it('une activation ultérieure du forfait (changement de Plan.priceXof) n\'affecte pas le snapshot déjà écrit — le voucher est déjà ACTIVE, jamais repris par la branche firstSight', async () => {
    const alreadyActive = {
      ...GENERATED_VOUCHER,
      status: VoucherStatus.ACTIVE,
      plan: { priceXof: 999 }, // prix modifié depuis l'activation initiale
      session: { id: 'sess-1' },
    };
    mockPrisma.voucher.findMany.mockResolvedValue([alreadyActive]);

    await buildService().syncFromLan('router-1', activeSession());

    // Branche "session déjà ouverte" : aucun updateMany sur Voucher n'est
    // jamais déclenché, donc aucune réécriture du snapshot ni du statut —
    // seule la Session (compteurs live) est rafraîchie.
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.session.update).toHaveBeenCalled();
  });

  it("le prix ne peut jamais être fourni par le client — aucune entrée de syncFromLan ne porte de montant", async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([GENERATED_VOUCHER]);
    const maliciousActive = [
      { id: 'rt1', user: 'ABC123', ipAddress: '10.0.0.5', macAddress: 'AA:BB', bytesIn: '0', bytesOut: '0', uptime: '1m' },
    ] as any;
    // Même si un champ de prix était injecté dans la payload, LiveSession ne
    // le lit jamais (mapActive n'extrait que user/ip/mac/bytes/uptime).
    (maliciousActive[0] as any).priceXof = 1;

    await buildService().syncFromLan('router-1', maliciousActive);

    const call = mockPrisma.voucher.updateMany.mock.calls[0][0];
    expect(call.data.priceXofAtActivation).toBe(500); // vient de plan.priceXof, pas du payload client
  });

  it('plan/prix non exploitable (<=0) → priceSnapshotSource UNKNOWN, jamais un faux montant, activation non bloquée', async () => {
    mockPrisma.voucher.findMany.mockResolvedValue([
      { ...GENERATED_VOUCHER, plan: { priceXof: 0 } },
    ]);

    await buildService().syncFromLan('router-1', activeSession());

    const call = mockPrisma.voucher.updateMany.mock.calls[0][0];
    expect(call.data.priceXofAtActivation).toBeNull();
    expect(call.data.priceSnapshotSource).toBe('UNKNOWN');
    // L'accès hotspot (ouverture de session) n'est jamais bloqué par cette anomalie.
    expect(mockPrisma.session.create).toHaveBeenCalled();
  });

  it('LOCAL (syncFromLan) et REMOTE (syncActivations) convergent vers le même point d\'écriture privé', async () => {
    // Preuve statique déjà établie (audit/51 §2.1) : les deux méthodes
    // publiques appellent exclusivement `reconcileActive`, jamais un second
    // chemin d'écriture. Test comportemental : REMOTE produit exactement le
    // même appel updateMany que LOCAL pour un scénario identique.
    mockPrisma.voucher.findMany.mockResolvedValue([GENERATED_VOUCHER]);
    mockPrisma.router.findMany.mockResolvedValue([
      { id: 'router-1', tenantId: 'tenant-1' },
    ]);
    mockRemote.run.mockResolvedValue([
      { '.id': 'rt1', user: 'ABC123', address: '10.0.0.5', 'mac-address': 'AA:BB', 'bytes-in': '0', 'bytes-out': '0', uptime: '1m' },
    ]);

    await buildService().syncActivations();

    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priceXofAtActivation: 500,
          priceSnapshotSource: 'EXACT',
        }),
      }),
    );
  });
});
