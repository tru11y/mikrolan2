import { RouterGatewayService } from './router-gateway.service';
import { RouterLiveEventsService } from './router-live-events.service';
import { RouterLiveCollector, backoffMs, nextIntervalMs } from './router-live-collector';
import { COLLECTOR_BACKOFF_CAP_MS, COLLECTOR_HOT_IDLE_MS, COLLECTOR_HOT_WATCHED_MS } from './router-gateway.types';

const mockRemote = { run: jest.fn() };
const ROUTER = { id: 'r1', tenantId: 't1', health: 'ONLINE', lastHeartbeat: new Date(), credEncrypted: 'x', remotePeer: { status: 'ACTIVE' } };

const resourceRow = [{ 'cpu-load': '29', 'total-memory': '134217728', 'free-memory': '50331648', uptime: '12d', version: '7.15', 'board-name': 'RB951' }];
const active = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ '.id': `*${i}`, user: `u${i}`, address: '10.0.0.1', 'mac-address': 'AA', 'bytes-in': '1', 'bytes-out': '2', uptime: '1m' }));

function client(opts: { sessions?: number; resourceFails?: Error; sessionsFail?: Error; log?: string[] } = {}) {
  return {
    command: jest.fn(async (words: string[]) => {
      opts.log?.push(words[0]);
      if (words[0] === '/system/resource/print') {
        if (opts.resourceFails) throw opts.resourceFails;
        return resourceRow;
      }
      if (opts.sessionsFail) throw opts.sessionsFail;
      return active(opts.sessions ?? 19);
    }),
  };
}

function build() {
  const liveEvents = new RouterLiveEventsService();
  const gateway = new RouterGatewayService(mockRemote as never, liveEvents);
  const prisma = { router: { findMany: jest.fn(async () => [ROUTER]) } };
  const collector = new RouterLiveCollector(prisma as never, gateway);
  return { gateway, collector, prisma };
}

let clock = 1_000_000;

/** Deux ticks : le 1er enregistre le routeur (départ étalé), le 2e le trouve dû. */
async function cycle(collector: RouterLiveCollector, advanceMs = 20_000): Promise<void> {
  await collector.tick();
  clock += advanceMs;
  await collector.tick();
  await new Promise((r) => setImmediate(r));
}

afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.clearAllMocks();
  clock = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(client()));
});

describe('politique de cadence', () => {
  it('routeur rapide : cible 15 s (8 s si un écran regarde) ; lent : durée × 3, plafonné', () => {
    expect(nextIntervalMs(500, false)).toBe(COLLECTOR_HOT_IDLE_MS);
    expect(nextIntervalMs(500, true)).toBe(COLLECTOR_HOT_WATCHED_MS);
    expect(nextIntervalMs(20_000, true)).toBe(60_000);
    expect(nextIntervalMs(600_000, false)).toBe(120_000);
  });

  it('backoff exponentiel plafonné', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(20)).toBe(COLLECTOR_BACKOFF_CAP_MS);
  });
});

describe('RouterLiveCollector', () => {
  it('collecte proactive sans aucun téléphone : snapshot multi-âge prêt, sessions lues AVANT resource', async () => {
    const { gateway, collector } = build();
    const log: string[] = [];
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(client({ log })));

    await cycle(collector);

    const snap = gateway.peek('r1');
    expect(snap?.sessionCount).toBe(19);
    expect(snap?.cpuPercent).toBe(29);
    expect(snap?.sessionsUpdatedAt).not.toBeNull();
    expect(snap?.statsUpdatedAt).not.toBeNull();
    expect(log).toEqual(['/ip/hotspot/active/print', '/system/resource/print']);
    expect(gateway.isManaged('r1')).toBe(true);
  });

  it('10 mobiles (HTTP) sur un routeur géré : 0 lecture RouterOS supplémentaire, même snapshot', async () => {
    const { gateway, collector } = build();
    await cycle(collector);
    expect(mockRemote.run).toHaveBeenCalledTimes(1);

    const results = await Promise.all(Array.from({ length: 10 }, () => gateway.getLiveSnapshot('r1', 'both')));
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.sessionsUpdatedAt)).size).toBe(1);
    expect(results.every((r) => r.sessionCount === 19)).toBe(true);
  });

  it('timeout : 19 connectés conservés, routeur LENT (pas OFFLINE), stale, backoff', async () => {
    const { gateway, collector } = build();
    await cycle(collector);
    mockRemote.run.mockImplementation(() => Promise.reject(new Error('Routeur injoignable (timeout)')));

    clock += 200_000;
    await collector.tick();
    await new Promise((r) => setImmediate(r));

    const snap = gateway.peek('r1');
    expect(snap?.sessionCount).toBe(19);
    expect(snap?.health).toBe('ONLINE');
    expect(snap?.routerOsState).toBe('SLOW');
    expect(snap?.stale).toBe(true);
    expect(snap?.sessionsAgeMs).toBeGreaterThanOrEqual(0);
    expect(gateway.kpis('r1').timeoutCount).toBe(1);
    expect(gateway.kpis('r1').backoffCount).toBe(1);

    // Pas de relance avant le backoff (≥ 24 s même avec jitter), même si le dispatcheur passe.
    clock += 10_000;
    await collector.tick();
    expect(mockRemote.run).toHaveBeenCalledTimes(2);
  });

  it('CPU/RAM en échec après des sessions lues : les sessions fraîches sont conservées', async () => {
    const { gateway, collector } = build();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) =>
      fn(client({ sessions: 7, resourceFails: new Error('Routeur injoignable (timeout)') })),
    );
    await cycle(collector);
    const snap = gateway.peek('r1');
    expect(snap?.sessionCount).toBe(7);
    expect(snap?.statsUpdatedAt).toBeNull();
    expect(snap?.health).toBe('ONLINE');
  });

  it('une seule lecture en vol par routeur : un 2e cycle simultané ne lance aucune commande', async () => {
    const { gateway } = build();
    let release!: () => void;
    mockRemote.run.mockImplementation(
      (_id: string, fn: (c: unknown) => unknown) =>
        new Promise((resolve) => {
          release = () => resolve(fn(client()));
        }),
    );
    const first = gateway.collect('r1', { stats: true });
    const second = await gateway.collect('r1', { stats: true });
    expect(second).toBeNull();
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    expect(gateway.kpis('r1').queueDepth).toBe(1);
    release();
    await first;
  });

  it('échecs API consécutifs : routerOsState UNREACHABLE mais PAS de tunnel OFFLINE ; récupération au succès suivant', async () => {
    const { gateway } = build();
    await gateway.collect('r1', { stats: true });
    gateway.setManaged('r1', true);
    mockRemote.run.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));
    for (let i = 0; i < 3; i++) await gateway.collect('r1', { stats: true }).catch(() => undefined);
    expect(gateway.peek('r1')?.health).toBe('ONLINE');
    expect(gateway.peek('r1')?.routerOsState).toBe('UNREACHABLE');
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(client()));
    await gateway.collect('r1', { stats: true });
    expect(gateway.peek('r1')?.health).toBe('ONLINE');
    expect(gateway.peek('r1')?.stale).toBe(false);
  });

  it('watchers : watch()/release comptés pour la cadence HOT', () => {
    const { gateway } = build();
    const release = gateway.watch('r1');
    expect(gateway.kpis('r1').watcherCount).toBe(1);
    release();
    expect(gateway.kpis('r1').watcherCount).toBe(0);
  });
});
