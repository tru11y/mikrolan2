import { Logger } from '@nestjs/common';
import { RouterHealth, UserRole } from '@prisma/client';
import { getTenantContext } from '../../common/context/tenant-context';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { RouterGatewayService } from '../router-gateway/router-gateway.service';
import { RouterLiveEventsService } from '../router-gateway/router-live-events.service';

/**
 * Reproduit la chaîne réelle de production :
 * TelemetryCron → TelemetryService.collectAll() → RouterGateway →
 * RemoteRouterService.run() → getTenantContext().
 *
 * `withRouterOsApi` est simulé ; tout le reste (RemoteRouterService,
 * RouterGatewayService, TelemetryService) est le code réel.
 */
jest.mock('../../common/routeros/routeros-api.client', () => ({
  ...jest.requireActual('../../common/routeros/routeros-api.client'),
  withRouterOsApi: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withRouterOsApi } = require('../../common/routeros/routeros-api.client');

const ROUTER_A = { id: 'router-a', tenantId: 'tenant-a', credEncrypted: 'enc-a' };
const ROUTER_B = { id: 'router-b', tenantId: 'tenant-b', credEncrypted: 'enc-b' };
const ROUTER_C = { id: 'router-c', tenantId: 'tenant-c', credEncrypted: 'enc-c' };

function buildStack(routers: { id: string; tenantId: string; credEncrypted: string }[]) {
  const remotePeers = routers.map((r) => ({ routerId: r.id, wgIp: `10.0.0.${r.id}` }));
  const isRemoteAllowedCalls: string[] = [];

  const prisma = {
    router: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        routers.find((r) => r.id === where.id) ?? null,
      ),
    },
    remotePeer: {
      findFirst: jest.fn(async ({ where }: { where: { routerId: string } }) => {
        const p = remotePeers.find((p) => p.routerId === where.routerId);
        return p ? { wgIp: p.wgIp } : null;
      }),
      findMany: jest.fn(async () =>
        routers.map((r) => ({ routerId: r.id, wgIp: `10.0.0.${r.id}`, router: { id: r.id, tenantId: r.tenantId, credEncrypted: r.credEncrypted, deletedAt: null } })),
      ),
    },
    routerTelemetry: { create: jest.fn().mockResolvedValue({}) },
  };
  const crypto = { decrypt: jest.fn().mockReturnValue(JSON.stringify({ username: 'u', password: 'p' })) };
  const subscriptions = {
    isRemoteAllowed: jest.fn(async (tenantId: string) => {
      isRemoteAllowedCalls.push(tenantId);
      return true;
    }),
  };
  const remote = new RemoteRouterService(prisma as never, crypto as never, subscriptions as never);
  const gateway = new RouterGatewayService(remote, new RouterLiveEventsService());
  return { prisma, remote, gateway, isRemoteAllowedCalls };
}

/** Faux RouterOS : capture le tenant vu par `getTenantContext()` au moment de la lecture. */
function fakeClientRecordingTenant(seenTenants: string[]) {
  return {
    command: jest.fn(async (words: string[]) => {
      seenTenants.push(getTenantContext()?.tenantId ?? 'NONE');
      if (words[0] === '/system/resource/print') return [{ 'cpu-load': '7' }];
      return [{ ret: '1' }];
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env['ROUTER_GATEWAY_ENABLED'] = 'true';
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env['ROUTER_GATEWAY_ENABLED'];
  jest.restoreAllMocks();
});

describe('A. Cron sans contexte tenant initial (reproduit le bug de production)', () => {
  it('tenantStore vide au départ : collectAll() réussit quand même, RouterTelemetry créée', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TelemetryService } = require('./telemetry.service');
    const { prisma, gateway, isRemoteAllowedCalls } = buildStack([ROUTER_A]);
    const seen: string[] = [];
    withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) => fn(fakeClientRecordingTenant(seen)));

    // Aucun `tenantStore.run()` englobant n'est ouvert ici : exactement l'état du
    // process au moment où `@Cron` déclenche `TelemetryCron.collect()`.
    expect(getTenantContext()).toBeUndefined();

    const telemetry = new TelemetryService(prisma, { decrypt: jest.fn() } as never, gateway);
    await telemetry.collectAll();

    expect(isRemoteAllowedCalls).toEqual(['tenant-a']); // pas de SUBSCRIPTION_INACTIVE
    expect(seen).toEqual(['tenant-a', 'tenant-a']); // resource + count-only, même tenant sur les 2 commandes
    expect(prisma.routerTelemetry.create).toHaveBeenCalledTimes(1);
    expect(prisma.routerTelemetry.create.mock.calls[0][0].data).toMatchObject({ routerId: 'router-a', cpuPercent: 7 });
  });
});

describe('B/C. Isolation par routeur : tenant A puis tenant B puis tenant C (un échoue)', () => {
  it('chaque routeur voit exactement son propre tenantId, jamais celui du précédent', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TelemetryService } = require('./telemetry.service');
    const { prisma, gateway, isRemoteAllowedCalls } = buildStack([ROUTER_A, ROUTER_B]);
    const seen: string[] = [];
    withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) => fn(fakeClientRecordingTenant(seen)));

    const telemetry = new TelemetryService(prisma, { decrypt: jest.fn() } as never, gateway);
    await telemetry.collectAll();

    expect(seen.sort()).toEqual(['tenant-a', 'tenant-a', 'tenant-b', 'tenant-b']);
    expect(isRemoteAllowedCalls.sort()).toEqual(['tenant-a', 'tenant-b']);
    expect(getTenantContext()).toBeUndefined(); // aucune fuite après le cycle
  });

  it('routeur B en échec (identifiants/entitlement) : le contexte de C reste propre, running libéré, cycle suivant fonctionne', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TelemetryService } = require('./telemetry.service');
    const { prisma, gateway, isRemoteAllowedCalls } = buildStack([ROUTER_A, ROUTER_B, ROUTER_C]);
    const seen: string[] = [];
    withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) => {
      const tenantId = getTenantContext()?.tenantId;
      seen.push(tenantId ?? 'NONE');
      if (tenantId === 'tenant-b') return Promise.reject(new Error('Routeur injoignable (timeout)'));
      return fn(fakeClientRecordingTenant([]));
    });

    const telemetry = new TelemetryService(prisma, { decrypt: jest.fn() } as never, gateway);
    await telemetry.collectAll();

    expect(seen.sort()).toEqual(['tenant-a', 'tenant-b', 'tenant-c']);
    expect(isRemoteAllowedCalls.sort()).toEqual(['tenant-a', 'tenant-b', 'tenant-c']);
    expect(prisma.routerTelemetry.create).toHaveBeenCalledTimes(2); // A et C, pas B
    expect(getTenantContext()).toBeUndefined();

    // Cycle suivant : toujours fonctionnel (aucun contexte résiduel n'a empoisonné l'état).
    prisma.routerTelemetry.create.mockClear();
    await telemetry.collectAll();
    expect(prisma.routerTelemetry.create).toHaveBeenCalledTimes(2);
  });

  it('exception synchrone pendant tenantStore.run() : aucun contexte résiduel', async () => {
    const gateway = { getLiveSnapshot: jest.fn().mockRejectedValue(new Error('boom')) };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TelemetryService } = require('./telemetry.service');
    const { prisma } = buildStack([ROUTER_A]);
    const telemetry = new TelemetryService(prisma, { decrypt: jest.fn() } as never, gateway as never);

    await telemetry.collectAll();

    expect(getTenantContext()).toBeUndefined();
    expect(prisma.routerTelemetry.create).not.toHaveBeenCalled();
  });
});

describe('D. Cache Gateway déjà chaud pour un routeur : le cycle suivant reste isolé par tenant', () => {
  it("un cache chaud pour router-a (tenant A) n'affecte pas la collecte de router-b (tenant B) dans le même cycle", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TelemetryService } = require('./telemetry.service');
    const { prisma, gateway, isRemoteAllowedCalls } = buildStack([ROUTER_A, ROUTER_B]);
    const seen: string[] = [];
    withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) => fn(fakeClientRecordingTenant(seen)));

    // Un écran UI a déjà réchauffé le cache de router-a sous le contexte tenant A
    // (chemin réel : RouterLiveController → getLiveSnapshot, cf. PR #45).
    const { tenantStore, setTenantContext } = require('../../common/context/tenant-context');
    await tenantStore.run({}, () => {
      setTenantContext({ tenantId: 'tenant-a', userId: 'u', role: UserRole.OWNER });
      return gateway.getLiveSnapshot(ROUTER_A.id, 'stats');
    });
    expect(isRemoteAllowedCalls).toEqual(['tenant-a']);
    isRemoteAllowedCalls.length = 0;
    seen.length = 0;

    const telemetry = new TelemetryService(prisma, { decrypt: jest.fn() } as never, gateway);
    await telemetry.collectAll();

    // router-a : cache déjà frais → HIT, aucun nouvel appel RouterOS ni entitlement.
    // router-b : jamais lu → MISS, sous SON PROPRE tenant, jamais celui de A.
    expect(seen).toEqual(['tenant-b', 'tenant-b']);
    expect(isRemoteAllowedCalls).toEqual(['tenant-b']);
    expect(prisma.routerTelemetry.create).toHaveBeenCalledTimes(2); // A (cache) + B (frais)
    expect(getTenantContext()).toBeUndefined();
  });
});
