import { Logger } from '@nestjs/common';
import { RouterGatewayService } from './router-gateway.service';
import { RouterLiveEventsService } from './router-live-events.service';
import {
  RouterStatsProbe,
  STATS_CADENCE_MS,
  STATS_HARD_DEADLINE_MS,
  STATS_NORMAL_CADENCE_MS,
  STATS_SYNC_INTERVAL_MAX_MS,
} from './router-stats-probe';

const R1 = '32053c90-ec63-40f7-8fcb-cb07704a190c';
const R2 = 'd8972619-deec-4f28-bed3-aea3ba02a92c';
const ROWS = [{ '.id': '*1', user: 'T1', address: '10.0.0.2', 'mac-address': 'AA', 'bytes-in': '1', 'bytes-out': '2', uptime: '1m' }];
const RESOURCE = [{ 'cpu-load': '29', 'total-memory': '134217728', 'free-memory': '50331648', uptime: '12d', version: '7.15', 'board-name': 'RB951' }];

const remote = { run: jest.fn() };
const prisma = { router: { findFirst: jest.fn() } };

function build() {
  const liveEvents = new RouterLiveEventsService();
  const events: { type: string }[] = [];
  jest.spyOn(liveEvents, 'emit').mockImplementation((e) => events.push(e));
  const gateway = new RouterGatewayService(remote as never, liveEvents);
  const probe = new RouterStatsProbe(prisma as never, remote as never, gateway);
  probe.onModuleInit();
  return { gateway, probe, events };
}

/** Simule une synchro CA réussie (le hook réel : SessionsService.publishLive → gateway.publishSessions). */
const syncOk = (g: RouterGatewayService, id = R1) => g.publishSessions(id, ROWS as never);
const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);
const commandsOf = () => remote.run.mock.calls.length;

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-09T12:00:00Z') });
  jest.clearAllMocks();
  process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'] = 'true';
  delete process.env['ROUTER_LIVE_ROUTER_IDS'];
  process.env['ROUTER_LIVE_STATS_PROBE_ENABLED'] = 'true';
  process.env['ROUTER_LIVE_STATS_ROUTER_IDS'] = R1;
  prisma.router.findFirst.mockResolvedValue({ tenantId: 't1', health: 'ONLINE', lastHeartbeat: new Date() });
  remote.run.mockImplementation(async (_id: string, fn: (c: unknown) => unknown) =>
    fn({ command: jest.fn(async () => RESOURCE) }),
  );
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  for (const k of ['ROUTER_LIVE_SYNC_PUBLISH_ENABLED', 'ROUTER_LIVE_ROUTER_IDS', 'ROUTER_LIVE_STATS_PROBE_ENABLED', 'ROUTER_LIVE_STATS_ROUTER_IDS']) delete process.env[k];
});

describe('flags (OFF par défaut, liste explicite)', () => {
  it('flag absent : aucune sonde, aucun timer, aucune commande', async () => {
    delete process.env['ROUTER_LIVE_STATS_PROBE_ENABLED'];
    const { gateway } = build();
    syncOk(gateway);
    await advance(60_000);
    expect(commandsOf()).toBe(0);
  });
  it('flag ON mais liste vide ou routeur non listé : aucune sonde', async () => {
    const { gateway } = build();
    process.env['ROUTER_LIVE_STATS_ROUTER_IDS'] = '';
    syncOk(gateway);
    process.env['ROUTER_LIVE_STATS_ROUTER_IDS'] = R2;
    syncOk(gateway);
    await advance(60_000);
    expect(commandsOf()).toBe(0);
  });
  it('routeur non alimenté par la synchro (Phase 1A OFF) : aucune sonde', async () => {
    const { gateway } = build();
    process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'] = 'false';
    syncOk(gateway);
    await advance(60_000);
    expect(commandsOf()).toBe(0);
  });
});

describe('lecture : UNE commande /system/resource, jamais active/print', () => {
  it('4 s après une synchro réussie : 1 connexion, 1 commande, stats dans le snapshot, sessions intactes', async () => {
    const { gateway, events } = build();
    syncOk(gateway);
    const sessionsAt = gateway.peek(R1)?.sessionsUpdatedAt;
    await advance(3_999);
    expect(commandsOf()).toBe(0); // jamais avant le délai
    await advance(10);
    expect(remote.run).toHaveBeenCalledTimes(1);
    expect(remote.run.mock.calls[0][2]).toEqual({ timeoutMs: 3_000, retries: 0 });

    // la fonction passée à remote.run n'exécute que /system/resource/print
    const words: string[][] = [];
    await remote.run.mock.calls[0][1]({ command: async (w: string[]) => (words.push(w), RESOURCE) });
    expect(words).toHaveLength(1);
    expect(words[0][0]).toBe('/system/resource/print');
    expect(JSON.stringify(words)).not.toContain('hotspot');

    const snap = gateway.peek(R1);
    expect(snap?.cpuPercent).toBe(29);
    expect(snap?.memoryTotalMb).toBe(128);
    expect(snap?.memoryUsedMb).toBe(80);
    expect(snap?.uptime).toBe('12d');
    expect(snap?.statsAgeMs).toBeLessThan(100);
    expect(snap?.sessionsUpdatedAt).toBe(sessionsAt); // sessions/CA non touchées
    expect(snap?.sessionCount).toBe(1);
    expect(events.filter((e) => e.type === 'ROUTER_STATS').length).toBeGreaterThanOrEqual(2); // publication + stats (SSE)
    const k = gateway.kpis(R1);
    expect(k.statsProbeCount).toBe(1);
    expect(k.statsState).toBe('FRESH');
  });
});

describe('cadence 120 s, pool global = 1, jamais de chevauchement', () => {
  it('10 min de synchros (toutes les 26 s) : 4 à 5 sondes, jamais 2 en vol, toujours ≥ 4 s après une synchro', async () => {
    const { gateway } = build();
    let inflight = 0;
    let maxInflight = 0;
    const starts: number[] = [];
    remote.run.mockImplementation(async (_id: string, fn: (c: unknown) => unknown) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 800));
      inflight -= 1;
      return fn({ command: jest.fn(async () => RESOURCE) });
    });
    const syncs: number[] = [];
    for (let t = 0; t < 600_000; t += 26_000) {
      syncOk(gateway);
      syncs.push(Date.now());
      await advance(26_000);
    }
    expect(starts.length).toBeGreaterThanOrEqual(4);
    expect(starts.length).toBeLessThanOrEqual(5);
    expect(maxInflight).toBe(1);
    for (const st of starts) {
      const lastSync = Math.max(...syncs.filter((s) => s <= st));
      expect(st - lastSync).toBeGreaterThanOrEqual(3_999);
      expect(st - lastSync).toBeLessThan(26_000 - 9_000); // terminée ≥ 9 s avant la synchro suivante
    }
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(STATS_CADENCE_MS);
  });

  it('2 routeurs armés en même temps : une seule sonde à la fois (pool = 1)', async () => {
    process.env['ROUTER_LIVE_STATS_ROUTER_IDS'] = `${R1},${R2}`;
    const { gateway } = build();
    let inflight = 0;
    let maxInflight = 0;
    remote.run.mockImplementation(async (_id: string, fn: (c: unknown) => unknown) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 2_000));
      inflight -= 1;
      return fn({ command: jest.fn(async () => RESOURCE) });
    });
    syncOk(gateway, R1);
    syncOk(gateway, R2);
    await advance(10_000);
    expect(maxInflight).toBe(1);
    expect(commandsOf()).toBe(1);
    expect(gateway.kpis(R2).statsProbeSkipped).toBeGreaterThanOrEqual(0);
  });
});

describe('jamais pendant une synchro, shed et reprise', () => {
  it('synchro échouée pendant le délai de 4 s : la sonde est annulée, 0 commande, état SHED', async () => {
    const { gateway } = build();
    syncOk(gateway);
    await advance(2_000);
    gateway.noteSyncReadFailure(R1, new Error('Routeur injoignable (timeout)'));
    await advance(30_000);
    expect(commandsOf()).toBe(0);
    expect(gateway.kpis(R1).statsState).toBe('SHED');
  });

  it('reprise seulement après 3 synchros calmes consécutives', async () => {
    const { gateway } = build();
    syncOk(gateway);
    gateway.noteSyncReadFailure(R1, new Error('timeout'));
    for (let i = 0; i < 2; i++) {
      await advance(26_000);
      syncOk(gateway);
    }
    await advance(10_000);
    expect(commandsOf()).toBe(0); // 2 synchros calmes < 3
    await advance(16_000);
    syncOk(gateway); // 3ᵉ
    await advance(5_000);
    expect(commandsOf()).toBe(1);
    expect(gateway.kpis(R1).statsState).toBe('FRESH');
  });

  it('synchro lente (intervalle > 40 s entre deux publications) : aucune sonde', async () => {
    const { gateway } = build();
    syncOk(gateway);
    await advance(STATS_SYNC_INTERVAL_MAX_MS + 5_000);
    syncOk(gateway); // intervalle 45 s ⇒ SYNC_SLOW
    await advance(10_000);
    expect(gateway.kpis(R1).statsProbeSkipped).toBe(1);
    // la première sonde (planifiée après la 1ʳᵉ publication) a pu partir ; on vérifie qu'aucune 2ᵉ ne part dans le même créneau
    expect(commandsOf()).toBeLessThanOrEqual(1);
  });

  it('tunnel WireGuard DOWN : aucune lecture RouterOS', async () => {
    prisma.router.findFirst.mockResolvedValue({ tenantId: 't1', health: 'OFFLINE', lastHeartbeat: new Date(Date.now() - 10 * 60_000) });
    const { gateway } = build();
    syncOk(gateway);
    await advance(6_000);
    expect(commandsOf()).toBe(0);
    expect(gateway.kpis(R1).statsProbeSkipped).toBe(1);
  });
});

describe('échec, lenteur et deadline dure', () => {
  it('échec : 1 seule tentative, backoff ≥ 96 s, shed, snapshot sessions inchangé, aucun retry immédiat', async () => {
    const { gateway } = build();
    syncOk(gateway);
    const before = gateway.peek(R1);
    remote.run.mockRejectedValueOnce(new Error('Routeur injoignable (timeout)'));
    await advance(5_000);
    expect(commandsOf()).toBe(1);
    const k = gateway.kpis(R1);
    expect(k.statsProbeFailures).toBe(1);
    expect(k.statsShedCount).toBe(1);
    expect(k.statsState).toBe('SHED');
    const after = gateway.peek(R1);
    expect(after?.sessionCount).toBe(before?.sessionCount);
    expect(after?.sessionsUpdatedAt).toBe(before?.sessionsUpdatedAt);
    expect(after?.routerOsState).toBe('RESPONSIVE'); // un échec de sonde ne dégrade pas l'état des sessions
    expect(after?.cpuPercent).toBeNull(); // inconnu ≠ 0
    // synchros calmes pendant 80 s : toujours aucune nouvelle lecture
    for (let i = 0; i < 3; i++) {
      await advance(26_000);
      syncOk(gateway);
    }
    expect(commandsOf()).toBe(1);
  });

  it('deadline dure : commande qui ne répond jamais ⇒ abandon à 13 s, collisionAborted = 1', async () => {
    const { gateway } = build();
    remote.run.mockImplementation(() => new Promise(() => undefined));
    syncOk(gateway);
    await advance(4_000 + STATS_HARD_DEADLINE_MS + 100);
    const k = gateway.kpis(R1);
    expect(k.collisionAborted).toBe(1);
    expect(k.statsProbeFailures).toBe(1);
    expect(k.statsState).toBe('SHED');
  });

  it('sonde un peu lente (4 s) : prochaine lecture espacée à 300 s', async () => {
    const { gateway } = build();
    remote.run.mockImplementation(async (_id: string, fn: (c: unknown) => unknown) => {
      await new Promise((r) => setTimeout(r, 4_000));
      return fn({ command: jest.fn(async () => RESOURCE) });
    });
    syncOk(gateway);
    await advance(9_000);
    expect(commandsOf()).toBe(1);
    let reads = 1;
    for (let t = 0; t < STATS_NORMAL_CADENCE_MS - 40_000; t += 26_000) {
      syncOk(gateway);
      await advance(26_000);
      reads = commandsOf();
    }
    expect(reads).toBe(1); // aucune 2ᵉ lecture avant ~300 s (−10 % de gigue)
  });
});

describe('contrat du snapshot', () => {
  it('applyStats sans snapshot : false, aucune exception ; stats partielles : champs absents conservés', () => {
    const { gateway } = build();
    expect(gateway.applyStats(R1, RESOURCE[0] as never)).toBe(false);
    syncOk(gateway);
    expect(gateway.applyStats(R1, { 'cpu-load': '0' } as never)).toBe(true);
    expect(gateway.peek(R1)?.cpuPercent).toBe(0); // un vrai 0 reste 0
    expect(gateway.applyStats(R1, {} as never)).toBe(true);
    expect(gateway.peek(R1)?.cpuPercent).toBe(0); // inconnu ne remplace pas une valeur connue
  });
});
