import { Logger } from '@nestjs/common';
import { ManagementMode } from '@prisma/client';
import { SessionsService } from './sessions.service';
import { RouterGatewayService } from '../router-gateway/router-gateway.service';
import { RouterLiveEventsService } from '../router-gateway/router-live-events.service';

const mockPrisma = {
  router: { findFirst: jest.fn(), findMany: jest.fn() },
  session: { findMany: jest.fn().mockResolvedValue([]) },
  voucher: { findMany: jest.fn().mockResolvedValue([]) },
};
const mockRemote = { run: jest.fn() };
const ROUTER = { id: 'r1', mode: ManagementMode.REMOTE, tenantId: 't1' };

function build(gateway?: RouterGatewayService) {
  return new SessionsService(
    mockPrisma as never,
    mockRemote as never,
    { publish: jest.fn() } as never,
    { sendPushToTenant: jest.fn() } as never,
    gateway,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env['ROUTER_GATEWAY_ENABLED'];
  mockPrisma.router.findFirst.mockResolvedValue(ROUTER);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env['ROUTER_GATEWAY_ENABLED'];
  jest.restoreAllMocks();
});

const SESSIONS = [{ '.id': '*1', user: 'ABC', address: '10.0.0.5', 'mac-address': 'AA', 'bytes-in': '1', 'bytes-out': '2', uptime: '1m' }];

describe('SessionsService.live() — flag ROUTER_GATEWAY_ENABLED', () => {
  it('OFF (défaut) : chemin legacy inchangé, le Gateway (même fourni) n\'est jamais appelé', async () => {
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn({ command: async () => SESSIONS }));
    const gateway = new RouterGatewayService(mockRemote as never, new RouterLiveEventsService());
    const spy = jest.spyOn(gateway, 'getLiveSnapshot');
    const svc = build(gateway);

    const result = await svc.live('r1');

    expect(spy).not.toHaveBeenCalled();
    expect(mockRemote.run).toHaveBeenCalledWith('r1', expect.any(Function), { retries: 1 });
    expect(result).toEqual([{ id: '*1', user: 'ABC', ipAddress: '10.0.0.5', macAddress: 'AA', bytesIn: '1', bytesOut: '2', uptime: '1m' }]);
  });

  it('ON : consomme RouterGateway.getLiveSnapshot("sessions") au lieu d\'un remote.run indépendant', async () => {
    process.env['ROUTER_GATEWAY_ENABLED'] = 'true';
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) =>
      fn({ command: async (w: string[]) => (w[0] === '/system/resource/print' ? [{ 'cpu-load': '10' }] : SESSIONS) }),
    );
    const gateway = new RouterGatewayService(mockRemote as never, new RouterLiveEventsService());
    const svc = build(gateway);

    const result = await svc.live('r1');

    expect(result).toEqual([{ id: '*1', user: 'ABC', ipAddress: '10.0.0.5', macAddress: 'AA', bytesIn: '1', bytesOut: '2', uptime: '1m' }]);
  });

  it('ON, N appels concurrents pour le même routeur (N écrans/N mobiles) → 1 seul accès RouterOS', async () => {
    process.env['ROUTER_GATEWAY_ENABLED'] = 'true';
    let calls = 0;
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => {
      calls += 1;
      return fn({ command: async (w: string[]) => (w[0] === '/system/resource/print' ? [{ 'cpu-load': '10' }] : SESSIONS) });
    });
    const gateway = new RouterGatewayService(mockRemote as never, new RouterLiveEventsService());
    const svc = build(gateway);

    const results = await Promise.all(Array.from({ length: 10 }, () => svc.live('r1')));

    expect(calls).toBe(1);
    for (const r of results) expect(r).toHaveLength(1);
  });

  it('ON : n\'a strictement aucun effet sur syncActivations / syncRouter (SYNC_SCHEDULER inchangé, remote.run appelé avec les mêmes paramètres qu\'avant #P0-RG)', async () => {
    process.env['ROUTER_GATEWAY_ENABLED'] = 'true';
    process.env['SYNC_SCHEDULER'] = 'legacy';
    mockPrisma.router.findMany.mockResolvedValue([{ id: 'r1', tenantId: 't1' }]);
    mockRemote.run.mockResolvedValue([]);
    const gateway = new RouterGatewayService(mockRemote as never, new RouterLiveEventsService());
    const gatewaySpy = jest.spyOn(gateway, 'getLiveSnapshot');
    const svc = build(gateway);

    await svc.syncActivations();

    expect(gatewaySpy).not.toHaveBeenCalled(); // le CA ne consulte jamais le Gateway (Phase 1, §7)
    expect(mockRemote.run).toHaveBeenCalledWith('r1', expect.any(Function), { retries: 1 }); // paramètres #43/#44 inchangés
    delete process.env['SYNC_SCHEDULER'];
  });
});
