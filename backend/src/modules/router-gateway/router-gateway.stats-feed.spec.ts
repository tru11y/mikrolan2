import { Logger } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service';
import { RouterGatewayService } from './router-gateway.service';
import { RouterLiveEventsService } from './router-live-events.service';
import {
  STATS_FEED_BACKOFF_CAP_MS,
  STATS_FEED_BASE_MS,
  STATS_FEED_HIGH_CPU_MS,
  STATS_FEED_SLOW_MS,
  statsFeedNextIntervalMs,
} from './router-gateway.types';

/**
 * Phase 1B — Stats Feed : UNE lecture `/system/resource/print`, juste après une synchro, jamais en
 * parallèle d'elle, ≥ 60 s entre deux lectures, jamais d'active/print en plus, CA indépendant.
 */
const mockPrisma = {
  router: { findMany: jest.fn() },
  session: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  voucher: { findMany: jest.fn(), updateMany: jest.fn() },
  notification: { create: jest.fn() },
};
const mockRemote = { run: jest.fn() };
const mockEvents = { publish: jest.fn() };
const mockNotifications = { sendPushToTenant: jest.fn() };

const ACTIVE = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ '.id': `*${i}`, user: `T${i}`, address: `10.0.0.${i}`, 'mac-address': 'AA', 'bytes-in': '1', 'bytes-out': '2', uptime: '1m' }));
const RESOURCE = (cpu = '12') => [
  { 'cpu-load': cpu, 'total-memory': '134217728', 'free-memory': '67108864', uptime: '3d2h', version: '7.24.4', 'board-name': 'RB951Ui-2HnD' },
];

type Cmd = { words: string[]; opts?: { timeoutMs?: number; retries?: number } };
const commands: Cmd[] = [];
let resourceCpu = '12';
let resourceFail: Error | null = null;
let resourceGate: Promise<void> | null = null;

function installRemote() {
  mockRemote.run.mockImplementation(async (_id: string, fn: (c: unknown) => unknown, opts?: Cmd['opts']) => {
    const client = {
      command: jest.fn(async (words: string[]) => {
        commands.push({ words, opts });
        if (words[0] === '/system/resource/print') {
          if (resourceGate) await resourceGate;
          if (resourceFail) throw resourceFail;
          return RESOURCE(resourceCpu);
        }
        return ACTIVE(3);
      }),
    };
    return fn(client);
  });
}

function build() {
  const liveEvents = new RouterLiveEventsService();
  const emitted: { type: string }[] = [];
  jest.spyOn(liveEvents, 'emit').mockImplementation((e) => emitted.push(e));
  const gateway = new RouterGatewayService(mockRemote as never, liveEvents);
  const svc = new SessionsService(mockPrisma as never, mockRemote as never, mockEvents as never, mockNotifications as never, gateway);
  const sync = (): Promise<'ok' | 'failed' | 'skipped'> =>
    (svc as unknown as { syncRouter(r: { id: string; tenantId: string }): Promise<'ok' | 'failed' | 'skipped'> }).syncRouter({ id: 'r1', tenantId: 't1' });
  return { gateway, emitted, sync };
}

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const resourceReads = () => commands.filter((c) => c.words[0] === '/system/resource/print');
const activeReads = () => commands.filter((c) => c.words[0] === '/ip/hotspot/active/print');

let now = 10_000_000;
beforeEach(() => {
  jest.clearAllMocks();
  commands.length = 0;
  now = 10_000_000;
  resourceCpu = '12';
  resourceFail = null;
  resourceGate = null;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'] = 'true';
  process.env['ROUTER_LIVE_STATS_FEED_ENABLED'] = 'true';
  process.env['ROUTER_LIVE_ROUTER_IDS'] = 'r1';
  mockPrisma.session.findMany.mockResolvedValue([]);
  mockPrisma.voucher.findMany.mockResolvedValue([]);
  mockPrisma.voucher.updateMany.mockResolvedValue({ count: 0 });
  installRemote();
});
afterEach(() => {
  delete process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'];
  delete process.env['ROUTER_LIVE_STATS_FEED_ENABLED'];
  delete process.env['ROUTER_LIVE_ROUTER_IDS'];
  jest.restoreAllMocks();
});

describe('Stats Feed — déclenchement', () => {
  it('flag OFF : aucune lecture stats, comportement Phase 1A inchangé', async () => {
    delete process.env['ROUTER_LIVE_STATS_FEED_ENABLED'];
    const { gateway, sync } = build();
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(0);
    expect(gateway.peek('r1')?.cpuPercent).toBeNull();
  });

  it('routeur hors ROUTER_LIVE_ROUTER_IDS : aucune lecture stats', async () => {
    process.env['ROUTER_LIVE_ROUTER_IDS'] = 'autre';
    const { sync } = build();
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(0);
  });

  it('après une synchro : UNE lecture /system/resource/print, jamais d\'active/print supplémentaire', async () => {
    const { gateway, emitted, sync } = build();
    expect(await sync()).toBe('ok');
    await flush();
    expect(activeReads()).toHaveLength(1); // celle de la synchro, déjà existante
    expect(resourceReads()).toHaveLength(1);
    expect(resourceReads()[0].words).toEqual(['/system/resource/print', '=.proplist=cpu-load,total-memory,free-memory,uptime,version,board-name']);
    expect(resourceReads()[0].opts).toEqual({ timeoutMs: 10_000, retries: 0 });
    const snap = gateway.peek('r1');
    expect(snap).toMatchObject({ cpuPercent: 12, memoryUsedMb: 64, memoryTotalMb: 128, uptime: '3d2h', rosVersion: '7.24.4', boardName: 'RB951Ui-2HnD' });
    expect(snap?.sessionCount).toBe(3);
    expect(snap?.sessionsSource).toBe('SYNC_ACTIVATIONS');
    expect(snap?.statsAgeMs).not.toBeNull();
    expect(emitted.filter((e) => e.type === 'ROUTER_STATS').length).toBeGreaterThanOrEqual(2); // publication sync + stats
    expect(gateway.kpis('r1')).toMatchObject({ statsFeedReads: 1, statsFeedFailures: 0 });
  });

  it('aucun snapshot (redémarrage) : jamais de lecture, état inconnu conservé', async () => {
    const { gateway } = build();
    gateway.syncStarted('r1');
    gateway.syncFinished('r1', 't1');
    await flush();
    expect(resourceReads()).toHaveLength(0);
    expect(gateway.peek('r1')).toBeNull();
  });

  it('les lecteurs HTTP (10 consommateurs) ne déclenchent aucune lecture RouterOS', async () => {
    const { gateway, sync } = build();
    await sync();
    await flush();
    const before = mockRemote.run.mock.calls.length;
    await Promise.all(Array.from({ length: 10 }, () => gateway.getLiveSnapshot('r1', 'both')));
    expect(mockRemote.run.mock.calls.length).toBe(before);
  });

  it('synchro en difficulté (syncError) : pas de lecture stats sur un routeur qui souffre', async () => {
    const { gateway, sync } = build();
    await sync();
    await flush();
    commands.length = 0;
    now += 120_000;
    gateway.noteSyncReadFailure('r1', new Error('timeout'));
    gateway.syncStarted('r1');
    gateway.syncFinished('r1', 't1');
    await flush();
    expect(resourceReads()).toHaveLength(0);
  });
});

describe('Stats Feed — cadence et backoff', () => {
  it('jamais plus d\'une lecture par 60 s, puis une à 60 s', async () => {
    const { sync } = build();
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(1);
    now += 25_000;
    await sync();
    await flush();
    now += 25_000; // 50 s depuis la lecture
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(1);
    now += 10_000; // 60 s
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(2);
    expect(activeReads()).toHaveLength(4); // une par synchro, aucune ajoutée
  });

  it('CPU ≥ 90 % : cadence ÷3 (180 s), jamais plus de lectures quand le routeur souffre', async () => {
    resourceCpu = '97';
    const { sync } = build();
    await sync();
    await flush();
    now += 120_000;
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(1);
    now += 60_000; // 180 s
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(2);
  });

  it('échec : backoff exponentiel, santé/sessions/état RouterOS inchangés, stats précédentes conservées', async () => {
    const { gateway, sync } = build();
    await sync();
    await flush();
    const ok = gateway.peek('r1');
    expect(ok?.cpuPercent).toBe(12);

    resourceFail = new Error('Routeur injoignable via le tunnel: timeout');
    now += 60_000;
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(2);
    const after = gateway.peek('r1');
    expect(after?.cpuPercent).toBe(12); // dernière valeur conservée
    expect(after?.health).toBe('ONLINE');
    expect(after?.routerOsState).toBe('RESPONSIVE');
    expect(after?.sessionCount).toBe(3);
    expect(gateway.kpis('r1')).toMatchObject({ statsFeedFailures: 1, timeoutCount: 1 });

    now += 60_000; // < 120 s de backoff
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(2);
    now += 60_000; // 120 s
    await sync();
    await flush();
    expect(resourceReads()).toHaveLength(3);
  });
});

describe('Stats Feed — verrou mutuel avec syncActivations', () => {
  it('pendant une lecture stats, le tick sync de ce routeur est différé (aucune lecture active/print concurrente)', async () => {
    let release!: () => void;
    resourceGate = new Promise<void>((r) => (release = r));
    const { gateway, sync } = build();
    await sync(); // déclenche la lecture stats, bloquée
    await flush();
    expect(gateway.isStatsReadInFlight('r1')).toBe(true);
    const activeBefore = activeReads().length;

    now += 25_000;
    expect(await sync()).toBe('skipped');
    expect(activeReads().length).toBe(activeBefore); // aucune lecture sync pendant la lecture stats
    expect(gateway.kpis('r1').syncDeferredForStats).toBe(1);

    release();
    await flush();
    expect(gateway.isStatsReadInFlight('r1')).toBe(false);
    now += 5_000;
    expect(await sync()).toBe('ok');
    expect(activeReads().length).toBe(activeBefore + 1);
  });

  it('une seule lecture stats en vol, même si plusieurs fins de synchro se succèdent', async () => {
    let release!: () => void;
    resourceGate = new Promise<void>((r) => (release = r));
    const { gateway, sync } = build();
    await sync();
    await flush();
    gateway.syncStarted('r1');
    gateway.syncFinished('r1', 't1');
    gateway.syncFinished('r1', 't1');
    await flush();
    expect(resourceReads()).toHaveLength(1);
    release();
    await flush();
  });

  it('aucune lecture stats ne démarre tant que la synchro du routeur est en cours', async () => {
    const { gateway, sync } = build();
    await sync();
    await flush();
    commands.length = 0;
    now += 120_000;
    gateway.syncStarted('r1'); // synchro en cours
    // même un déclenchement direct (hors syncFinished) est refusé tant que la synchro est en cours
    const priv = gateway as unknown as { maybeStartStatsRead(id: string, tenant: string, e: unknown): void; entry(id: string): unknown };
    priv.maybeStartStatsRead('r1', 't1', priv.entry('r1'));
    await flush();
    expect(resourceReads()).toHaveLength(0);
    gateway.syncFinished('r1', 't1');
    await flush();
    expect(resourceReads()).toHaveLength(1);
  });

  it('le CA est inchangé et le verrou toujours libéré si la lecture stats lève', async () => {
    resourceFail = new Error('boom');
    const { sync } = build();
    expect(await sync()).toBe('ok');
    await flush();
    now += 25_000;
    expect(await sync()).toBe('ok');
  });

  it('gateway sans les méthodes Phase 1B (module absent / ancien mock) : syncActivations inchangé', async () => {
    const svc = new SessionsService(mockPrisma as never, mockRemote as never, mockEvents as never, mockNotifications as never, {
      publishSessions: jest.fn(),
    } as never);
    const sync = (svc as unknown as { syncRouter(r: { id: string; tenantId: string }): Promise<'ok' | 'failed' | 'skipped'> }).syncRouter({ id: 'r1', tenantId: 't1' });
    expect(await sync).toBe('ok');
  });
});

describe('statsFeedNextIntervalMs', () => {
  it('toujours ≥ 60 s ; ÷3 si CPU ≥ 90 % ; ≥ 120 s si lecture lente ; backoff plafonné', () => {
    expect(statsFeedNextIntervalMs({ cpuPercent: 10, lastDurationMs: 900, failures: 0 })).toBe(STATS_FEED_BASE_MS);
    expect(statsFeedNextIntervalMs({ cpuPercent: null, lastDurationMs: null, failures: 0 })).toBe(STATS_FEED_BASE_MS);
    expect(statsFeedNextIntervalMs({ cpuPercent: 90, lastDurationMs: 900, failures: 0 })).toBe(STATS_FEED_HIGH_CPU_MS);
    expect(statsFeedNextIntervalMs({ cpuPercent: 100, lastDurationMs: 900, failures: 0 })).toBe(180_000);
    expect(statsFeedNextIntervalMs({ cpuPercent: 10, lastDurationMs: 6_000, failures: 0 })).toBe(STATS_FEED_SLOW_MS);
    expect(statsFeedNextIntervalMs({ cpuPercent: 99, lastDurationMs: 6_000, failures: 0 })).toBe(STATS_FEED_HIGH_CPU_MS);
    expect(statsFeedNextIntervalMs({ cpuPercent: null, lastDurationMs: 1, failures: 1 })).toBe(120_000);
    expect(statsFeedNextIntervalMs({ cpuPercent: null, lastDurationMs: 1, failures: 2 })).toBe(240_000);
    expect(statsFeedNextIntervalMs({ cpuPercent: null, lastDurationMs: 1, failures: 9 })).toBe(STATS_FEED_BACKOFF_CAP_MS);
    for (const cpu of [null, 0, 50, 89, 90, 100]) {
      for (const f of [0, 1, 5]) expect(statsFeedNextIntervalMs({ cpuPercent: cpu, lastDurationMs: 100, failures: f })).toBeGreaterThanOrEqual(60_000);
    }
  });
});
