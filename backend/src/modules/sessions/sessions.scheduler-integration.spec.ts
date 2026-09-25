import { Logger } from '@nestjs/common';
import { ManagementMode, RemotePeerStatus, RouterHealth } from '@prisma/client';
import { SessionsService } from './sessions.service';

const mockPrisma = {
  router: { findMany: jest.fn() },
  session: { findMany: jest.fn().mockResolvedValue([]) },
  voucher: { findMany: jest.fn().mockResolvedValue([]) },
};
const mockRemote = { run: jest.fn() };

const build = () =>
  new SessionsService(
    mockPrisma as never,
    mockRemote as never,
    { publish: jest.fn() } as never,
    { sendPushToTenant: jest.fn() } as never,
  );

const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  tenantId: 't1',
  health: RouterHealth.ONLINE,
  lastHeartbeat: new Date(),
  credEncrypted: 'enc',
  remotePeer: { status: RemotePeerStatus.ACTIVE },
  ...over,
});

const ACTIVE_ROWS = [
  { '.id': '*1', user: 'ABC123', address: '10.0.0.5', 'mac-address': 'AA:BB', 'bytes-in': '10', 'bytes-out': '20', uptime: '1m' },
];

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env['SYNC_SCHEDULER'];
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env['SYNC_SCHEDULER'];
  jest.restoreAllMocks();
});

describe('SessionsService — choix de l\'ordonnanceur (SYNC_SCHEDULER)', () => {
  it('par défaut : l\'ancien tick de 25 s est inactif, le dispatcheur lit les routeurs éligibles seulement', async () => {
    mockPrisma.router.findMany.mockResolvedValue([
      row('ok'),
      row('nocreds', { credEncrypted: null }),
      row('nopeer', { remotePeer: { status: RemotePeerStatus.PENDING } }),
      row('nopeer2', { remotePeer: null }),
    ]);
    mockRemote.run.mockResolvedValue([]);
    const svc = build();

    await svc.syncActivations(); // legacy inactif
    expect(mockPrisma.router.findMany).not.toHaveBeenCalled();
    expect(mockRemote.run).not.toHaveBeenCalled();

    await svc.dispatchSync();
    await flush();
    expect(mockPrisma.router.findMany).toHaveBeenCalledWith({
      where: { mode: ManagementMode.REMOTE, deletedAt: null },
      select: expect.objectContaining({ credEncrypted: true, remotePeer: { select: { status: true } } }),
    });
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    expect(mockRemote.run).toHaveBeenCalledWith('ok', expect.any(Function), { retries: 1 });
  });

  it('SYNC_SCHEDULER=legacy : le dispatcheur est inactif, le tick historique fonctionne', async () => {
    process.env['SYNC_SCHEDULER'] = 'legacy';
    mockPrisma.router.findMany.mockResolvedValue([{ id: 'r1', tenantId: 't1' }]);
    mockRemote.run.mockResolvedValue([]);
    const svc = build();

    await svc.dispatchSync();
    await flush();
    expect(mockRemote.run).not.toHaveBeenCalled();

    await svc.syncActivations();
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
  });

  it('tunnel mort (OFFLINE + handshake périmé) : une seule lecture de sonde, puis plus rien avant 3 min', async () => {
    mockPrisma.router.findMany.mockResolvedValue([
      row('dead', { health: RouterHealth.OFFLINE, lastHeartbeat: new Date(Date.now() - 10 * 60_000) }),
    ]);
    mockRemote.run.mockRejectedValue(new Error('Routeur injoignable'));
    const svc = build();

    await svc.dispatchSync();
    await flush();
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    await svc.dispatchSync();
    await flush();
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
  });

  it('OFFLINE mais handshake récent : pas classé « tunnel mort »', async () => {
    mockPrisma.router.findMany.mockResolvedValue([
      row('r1', { health: RouterHealth.OFFLINE, lastHeartbeat: new Date(Date.now() - 20_000) }),
    ]);
    mockRemote.run.mockResolvedValue([]);
    const svc = build();
    await svc.dispatchSync();
    await flush();
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    // le tunnel n'est pas « mort » : pas de mise en sommeil de 3 min, le backoff standard s'applique seul
    const state = (svc as unknown as { scheduler: { states: Map<string, { tunnelDown: boolean }> } }).scheduler.states.get('r1');
    expect(state?.tunnelDown).toBe(false);
  });
});

describe('SessionsService — la logique métier est identique dans les deux modes', () => {
  it('reconcileActive reçoit exactement les mêmes arguments (routeur, tenant, sessions mappées)', async () => {
    const spy = jest
      .spyOn(SessionsService.prototype as unknown as { reconcileActive: () => Promise<void> }, 'reconcileActive')
      .mockResolvedValue(undefined);
    mockRemote.run.mockImplementation(async (_id: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({ command: async () => ACTIVE_ROWS }),
    );

    // Mode historique
    process.env['SYNC_SCHEDULER'] = 'legacy';
    mockPrisma.router.findMany.mockResolvedValue([{ id: 'r1', tenantId: 't1' }]);
    await build().syncActivations();
    const legacyCalls = [...spy.mock.calls];

    // Mode par routeur
    spy.mockClear();
    delete process.env['SYNC_SCHEDULER'];
    mockPrisma.router.findMany.mockResolvedValue([row('r1')]);
    const svc = build();
    await svc.dispatchSync();
    await flush();
    const perRouterCalls = [...spy.mock.calls];

    expect(legacyCalls).toHaveLength(1);
    expect(perRouterCalls).toEqual(legacyCalls);
    expect(perRouterCalls[0]).toEqual([
      'r1',
      't1',
      [{ id: '*1', user: 'ABC123', ipAddress: '10.0.0.5', macAddress: 'AA:BB', bytesIn: '10', bytesOut: '20', uptime: '1m' }],
    ]);
  });

  it('même verrou par routeur dans les deux modes : un second dispatch pendant une lecture n\'ouvre pas de 2e accès', async () => {
    let release!: () => void;
    mockRemote.run.mockReturnValue(new Promise<never[]>((r) => (release = () => r([]))));
    mockPrisma.router.findMany.mockResolvedValue([row('r1')]);
    const svc = build();
    await svc.dispatchSync();
    await flush();
    await svc.dispatchSync();
    await flush();
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    release();
    await flush();
  });
});
