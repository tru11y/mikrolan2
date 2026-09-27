import { Logger } from '@nestjs/common';
import { RouterHealth } from '@prisma/client';
import { RouterGatewayService } from '../router-gateway/router-gateway.service';
import { RouterLiveEventsService } from '../router-gateway/router-live-events.service';

jest.mock('../../common/routeros/routeros-api.client', () => ({
  withRouterOsApi: jest.fn(),
  RouterOsApiError: class RouterOsApiError extends Error {},
}));

const PEER = { routerId: 'r1', wgIp: '10.0.0.2', router: { id: 'r1', credEncrypted: 'enc', deletedAt: null } };
const mockRemote = { run: jest.fn() };

function load() {
  let service: { collectAll: () => Promise<void> };
  let api: { withRouterOsApi: jest.Mock };
  const prisma = {
    remotePeer: { findMany: jest.fn().mockResolvedValue([PEER]) },
    routerTelemetry: { create: jest.fn().mockResolvedValue({}) },
  };
  const crypto = { decrypt: jest.fn().mockReturnValue(JSON.stringify({ username: 'a', password: 'b' })) };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TelemetryService } = require('./telemetry.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    api = require('../../common/routeros/routeros-api.client');
    const gateway = new RouterGatewayService(mockRemote as never, new RouterLiveEventsService());
    service = new TelemetryService(prisma as never, crypto as never, gateway);
  });
  return { service: service!, api: api!, prisma };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env['ROUTER_GATEWAY_ENABLED'];
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env['ROUTER_GATEWAY_ENABLED'];
});

describe('TelemetryService — flag ROUTER_GATEWAY_ENABLED', () => {
  it('OFF (défaut) : lit RouterOS elle-même, comme aujourd\'hui', async () => {
    const { service, api, prisma } = load();
    api.withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) =>
      fn({ command: async () => [{ 'cpu-load': '5' }] }),
    );
    await service.collectAll();
    expect(api.withRouterOsApi).toHaveBeenCalledTimes(1);
    expect(mockRemote.run).not.toHaveBeenCalled();
    expect(prisma.routerTelemetry.create).toHaveBeenCalled();
  });

  it('ON : réutilise le snapshot mutualisé du Gateway, aucune connexion RouterOS ouverte par Telemetry elle-même', async () => {
    process.env['ROUTER_GATEWAY_ENABLED'] = 'true';
    const { service, api, prisma } = load();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) =>
      fn({
        command: async (w: string[]) =>
          w[0] === '/system/resource/print'
            ? [{ 'cpu-load': '15', 'total-memory': '134217728', 'free-memory': '67108864', uptime: '2d', version: '7.15.3', 'board-name': 'hAP ac3' }]
            : [{ ret: '5' }],
      }),
    );

    await service.collectAll();

    expect(api.withRouterOsApi).not.toHaveBeenCalled();
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    expect(prisma.routerTelemetry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routerId: 'r1',
          cpuPercent: 15,
          ramTotalMb: 128,
          ramUsedMb: 64,
          rosVersion: '7.15.3',
          boardName: 'hAP ac3',
          hotspotActive: 5,
          lastErrors: null,
          health: RouterHealth.ONLINE,
        }),
      }),
    );
  });

  it("ON : un snapshot déjà frais pour l'UI (< minFreshnessMs télémétrie) est réutilisé sans nouvelle lecture RouterOS", async () => {
    process.env['ROUTER_GATEWAY_ENABLED'] = 'true';
    const gateway = new RouterGatewayService(mockRemote as never, new RouterLiveEventsService());
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) =>
      fn({ command: async (w: string[]) => (w[0] === '/system/resource/print' ? [{ 'cpu-load': '20' }] : [{ ret: '2' }]) }),
    );
    await gateway.getLiveSnapshot('r1', 'stats'); // simule une lecture déjà déclenchée par un écran UI
    expect(mockRemote.run).toHaveBeenCalledTimes(1);

    let service: { collectAll: () => Promise<void> };
    let prisma: { routerTelemetry: { create: jest.Mock }; remotePeer: { findMany: jest.Mock } };
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { TelemetryService } = require('./telemetry.service');
      prisma = {
        remotePeer: { findMany: jest.fn().mockResolvedValue([PEER]) },
        routerTelemetry: { create: jest.fn().mockResolvedValue({}) },
      };
      service = new TelemetryService(prisma as never, { decrypt: jest.fn() } as never, gateway);
    });
    await service!.collectAll();

    expect(mockRemote.run).toHaveBeenCalledTimes(1); // pas de 2e lecture : le cache suffisait
    expect(prisma!.routerTelemetry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cpuPercent: 20, hotspotActive: 2 }) }),
    );
  });

  it('ON : un échec de refresh n\'écrit aucune ligne (comportement identique au chemin OFF)', async () => {
    process.env['ROUTER_GATEWAY_ENABLED'] = 'true';
    const { service, prisma } = load();
    mockRemote.run.mockRejectedValueOnce(new Error('Routeur injoignable (timeout)'));

    await service.collectAll();

    expect(prisma.routerTelemetry.create).not.toHaveBeenCalled();
  });
});
