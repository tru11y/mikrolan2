import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CryptoService } from '../../common/crypto/crypto.service';

jest.mock('../../common/routeros/routeros-api.client', () => ({
  withRouterOsApi: jest.fn(),
  RouterOsAuthError: class extends Error {},
  RouterOsApiError: class RouterOsApiError extends Error {},
}));

type Command = string[];
type Row = Record<string, string>;

const PEER = {
  routerId: 'r1',
  wgIp: '10.0.0.2',
  router: { id: 'r1', credEncrypted: 'enc', deletedAt: null },
};
const RESOURCE_ROW: Row = {
  'cpu-load': '15',
  'total-memory': '134217728',
  'free-memory': '67108864',
  uptime: '1d2h',
  version: '7.15.3',
  'board-name': 'hAP ac3',
};

/** Charge le service dans un registre de modules isolé, avec ou sans lecture du journal. */
function load(collectErrors: boolean) {
  let service: { collectAll: () => Promise<void> };
  let api: { withRouterOsApi: jest.Mock; RouterOsApiError: new (m: string) => Error };
  const prisma = {
    remotePeer: { findMany: jest.fn().mockResolvedValue([PEER]) },
    routerTelemetry: { create: jest.fn().mockResolvedValue({}) },
  };
  const crypto = { decrypt: jest.fn().mockReturnValue(JSON.stringify({ username: 'a', password: 'b' })) };
  const previous = process.env['TELEMETRY_COLLECT_ERRORS'];
  process.env['TELEMETRY_COLLECT_ERRORS'] = collectErrors ? '1' : '0';
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TelemetryService } = require('./telemetry.service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    api = require('../../common/routeros/routeros-api.client');
    service = new TelemetryService(prisma as unknown as PrismaService, crypto as unknown as CryptoService);
  });
  if (previous === undefined) delete process.env['TELEMETRY_COLLECT_ERRORS'];
  else process.env['TELEMETRY_COLLECT_ERRORS'] = previous;
  return { service: service!, api: api!, prisma };
}

/** Faux client : mesure la concurrence et rejoue des réponses selon la commande. */
function fakeClient(replies: Record<string, () => Promise<Row[]> | Row[]>) {
  const state = { inFlight: 0, maxInFlight: 0, calls: [] as Command[] };
  const command = jest.fn(async (words: Command) => {
    state.calls.push(words);
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      await new Promise((r) => setImmediate(r));
      const reply = replies[words[0]];
      return await (reply ? reply() : []);
    } finally {
      state.inFlight -= 1;
    }
  });
  return { client: { command }, state };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('TelemetryService — une connexion, une commande à la fois', () => {
  it('lecture minimale par défaut : resource (proplist) puis count-only, sans journal', async () => {
    const { service, api, prisma } = load(false);
    const { client, state } = fakeClient({
      '/system/resource/print': () => [RESOURCE_ROW],
      '/ip/hotspot/active/print': () => [{ ret: '20' }],
    });
    api.withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) => fn(client));

    await service.collectAll();

    expect(state.maxInFlight).toBe(1);
    expect(state.calls.map((c) => c[0])).toEqual(['/system/resource/print', '/ip/hotspot/active/print']);
    expect(state.calls[0]).toContain('=.proplist=cpu-load,total-memory,free-memory,uptime,version,board-name');
    expect(state.calls[1]).toContain('=count-only=');
    expect(prisma.routerTelemetry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cpuPercent: 15, hotspotActive: 20, lastErrors: null, rosVersion: '7.15.3' }),
      }),
    );
  });

  it('avec le journal activé : resource → active → log, strictement séquentiels', async () => {
    const { service, api, prisma } = load(true);
    const { client, state } = fakeClient({
      '/system/resource/print': () => [RESOURCE_ROW],
      '/ip/hotspot/active/print': () => [{ ret: '3' }],
      '/log/print': () => [{ time: '12:00', message: 'boom' }],
    });
    api.withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) => fn(client));

    await service.collectAll();

    expect(state.maxInFlight).toBe(1);
    expect(state.calls.map((c) => c[0])).toEqual([
      '/system/resource/print',
      '/ip/hotspot/active/print',
      '/log/print',
    ]);
    expect(prisma.routerTelemetry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hotspotActive: 3, lastErrors: [{ time: '12:00', message: 'boom' }] }),
      }),
    );
  });

  it('timeout sur une lecture facultative : la collecte se termine, les lectures suivantes sont abandonnées', async () => {
    const { service, api, prisma } = load(true);
    const { client, state } = fakeClient({
      '/system/resource/print': () => [RESOURCE_ROW],
      '/ip/hotspot/active/print': () => Promise.reject(new Error('Routeur injoignable (timeout)')),
      '/log/print': () => [{ time: 'x', message: 'ne doit pas être lu' }],
    });
    api.withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) => fn(client));

    await service.collectAll();

    expect(state.calls.map((c) => c[0])).toEqual(['/system/resource/print', '/ip/hotspot/active/print']);
    expect(prisma.routerTelemetry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cpuPercent: 15, hotspotActive: null, lastErrors: null }) }),
    );
  });

  it('refus RouterOS (trap) sur une lecture facultative : on continue avec la suivante', async () => {
    const { service, api, prisma } = load(true);
    const { client, state } = fakeClient({
      '/system/resource/print': () => [RESOURCE_ROW],
      '/ip/hotspot/active/print': () => Promise.reject(new api.RouterOsApiError('no such command')),
      '/log/print': () => [{ time: '12:00', message: 'boom' }],
    });
    api.withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) => fn(client));

    await service.collectAll();

    expect(state.calls.map((c) => c[0])).toEqual([
      '/system/resource/print',
      '/ip/hotspot/active/print',
      '/log/print',
    ]);
    expect(prisma.routerTelemetry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hotspotActive: null, lastErrors: [{ time: '12:00', message: 'boom' }] }) }),
    );
  });

  it('échec de la lecture resource : aucune ligne écrite, la collecte se termine (pas de blocage)', async () => {
    const { service, api, prisma } = load(false);
    const { client } = fakeClient({
      '/system/resource/print': () => Promise.reject(new Error('Routeur injoignable (timeout)')),
    });
    api.withRouterOsApi.mockImplementation((_p: unknown, fn: (c: unknown) => unknown) => fn(client));

    await expect(service.collectAll()).resolves.toBeUndefined();
    expect(prisma.routerTelemetry.create).not.toHaveBeenCalled();
  });
});
