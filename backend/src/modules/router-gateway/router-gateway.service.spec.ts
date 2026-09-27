import { RouterGatewayService } from './router-gateway.service';
import { RouterLiveEventsService } from './router-live-events.service';
import { GATEWAY_FRESH_MS, GATEWAY_RETRY_COOLDOWN_MS } from './router-gateway.types';

const mockRemote = { run: jest.fn() };

function build() {
  const liveEvents = new RouterLiveEventsService();
  const events: unknown[] = [];
  jest.spyOn(liveEvents, 'emit').mockImplementation((e) => events.push(e));
  const gateway = new RouterGatewayService(mockRemote as never, liveEvents);
  return { gateway, events, liveEvents };
}

const RESOURCE_ROW = (cpu = '10') => [{ 'cpu-load': cpu, 'total-memory': '134217728', 'free-memory': '67108864', uptime: '1d', version: '7.15.3', 'board-name': 'hAP ac3' }];
const ACTIVE_ROWS = (n = 2) =>
  Array.from({ length: n }, (_, i) => ({ '.id': `*${i}`, user: `u${i}`, address: '10.0.0.1', 'mac-address': 'AA', 'bytes-in': '1', 'bytes-out': '2', uptime: '1m' }));

/** Faux RouterOS : renvoie resource puis (si demandé) la liste active, sur UNE connexion. */
function fakeClient(opts: { cpu?: string; sessions?: number; fail?: Error } = {}) {
  return {
    command: jest.fn(async (words: string[]) => {
      if (opts.fail) throw opts.fail;
      if (words[0] === '/system/resource/print') return RESOURCE_ROW(opts.cpu);
      if (words.includes('=count-only=')) return [{ ret: String(opts.sessions ?? 2) }];
      return ACTIVE_ROWS(opts.sessions ?? 2);
    }),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('RouterGatewayService — cache et déduplication', () => {
  it('MISS puis HIT : un seul accès RouterOS pour deux lectures rapprochées', async () => {
    const { gateway } = build();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient()));
    const a = await gateway.getLiveSnapshot('r1', 'stats');
    const b = await gateway.getLiveSnapshot('r1', 'stats');
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    expect(a.stale).toBe(false);
    expect(b.stale).toBe(false);
    expect(b.cpuPercent).toBe(10);
  });

  it('10 requêtes simultanées (N clients) → 1 seul accès RouterOS (dédup MISS = JOIN)', async () => {
    const { gateway } = build();
    let release!: () => void;
    mockRemote.run.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(RESOURCE_ROW());
        }),
    );
    mockRemote.run.mockImplementationOnce(
      (_id: string, fn: (c: unknown) => unknown) =>
        new Promise((resolve) => {
          release = () => resolve(fn(fakeClient()));
        }),
    );
    const calls = Array.from({ length: 10 }, () => gateway.getLiveSnapshot('r1', 'stats'));
    await Promise.resolve();
    release();
    const results = await Promise.all(calls);
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(10);
    for (const r of results) expect(r.cpuPercent).toBe(10);
  });

  it('donnée périmée : servie immédiatement (stale), un seul refresh partagé pendant qu\'elle est en vol', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { gateway } = build();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient()));
    await gateway.getLiveSnapshot('r1', 'stats');
    jest.advanceTimersByTime(GATEWAY_FRESH_MS + 1000);

    let release!: () => void;
    mockRemote.run.mockImplementationOnce(
      (_id: string, fn: (c: unknown) => unknown) => new Promise((resolve) => (release = () => resolve(fn(fakeClient({ cpu: '20' }))))),
    );
    const [a, b, c] = await Promise.all([
      gateway.getLiveSnapshot('r1', 'stats'),
      gateway.getLiveSnapshot('r1', 'stats'),
      gateway.getLiveSnapshot('r1', 'stats'),
    ]);
    expect([a.stale, b.stale, c.stale]).toEqual([true, true, true]);
    expect(a.refreshing).toBe(true);
    expect(mockRemote.run).toHaveBeenCalledTimes(2); // 1 initial + 1 refresh partagé

    release();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const fresh = await gateway.getLiveSnapshot('r1', 'stats');
    expect(fresh.stale).toBe(false);
    expect(fresh.cpuPercent).toBe(20);
    jest.useRealTimers();
  });

  it('le refresh échoue : le dernier snapshot valide reste servi (jamais un écran vide)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { gateway } = build();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient()));
    const first = await gateway.getLiveSnapshot('r1', 'stats');
    jest.advanceTimersByTime(GATEWAY_FRESH_MS + 1000);

    mockRemote.run.mockRejectedValueOnce(new Error('Routeur injoignable (timeout)'));
    const again = await gateway.getLiveSnapshot('r1', 'stats'); // sert l'ancien snapshot pendant que le refresh échoue en fond
    expect(again.cpuPercent).toBe(first.cpuPercent); // pas d'écran vide
    expect(again.stale).toBe(true);

    for (let i = 0; i < 20; i++) await Promise.resolve(); // le refresh en fond a le temps d'échouer
    const after = await gateway.getLiveSnapshot('r1', 'stats');
    expect(after.cpuPercent).toBe(first.cpuPercent); // toujours pas d'écran vide
    expect(after.lastError).toMatch(/injoignable/i);
    jest.useRealTimers();
  });

  it('cooldown après échec : pas de nouvelle tentative avant le délai', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { gateway } = build();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient()));
    await gateway.getLiveSnapshot('r1', 'stats');
    jest.advanceTimersByTime(GATEWAY_FRESH_MS + 1000);
    mockRemote.run.mockRejectedValueOnce(new Error('timeout'));
    await gateway.getLiveSnapshot('r1', 'stats');
    for (let i = 0; i < 20; i++) await Promise.resolve();

    await gateway.getLiveSnapshot('r1', 'stats'); // dans la fenêtre de cooldown
    expect(mockRemote.run).toHaveBeenCalledTimes(2); // pas de 3e appel

    jest.advanceTimersByTime(GATEWAY_RETRY_COOLDOWN_MS + 1000);
    mockRemote.run.mockImplementationOnce((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient()));
    await gateway.getLiveSnapshot('r1', 'stats');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mockRemote.run).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });
});

describe('RouterGatewayService — sessions (want)', () => {
  it("want='stats' seul : sessionCount fait partie des stats (count-only), la LISTE reste null", async () => {
    const { gateway } = build();
    let usedClient!: ReturnType<typeof fakeClient>;
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => {
      usedClient = fakeClient();
      return fn(usedClient);
    });
    const r = await gateway.getLiveSnapshot('r1', 'stats');
    expect(r.sessionCount).toBe(2); // count-only par défaut
    expect(r.sessions).toBeNull(); // liste jamais demandée
    expect(usedClient.command).toHaveBeenCalledTimes(2); // resource + count-only, une seule connexion
    expect(usedClient.command.mock.calls[1][0]).toEqual(['/ip/hotspot/active/print', '=count-only=']);
  });

  it("want='sessions' : liste demandée et renvoyée", async () => {
    const { gateway } = build();
    let usedClient!: ReturnType<typeof fakeClient>;
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => {
      usedClient = fakeClient({ sessions: 3 });
      return fn(usedClient);
    });
    const r = await gateway.getLiveSnapshot('r1', 'sessions');
    expect(r.sessionCount).toBe(3);
    expect(r.sessions).toHaveLength(3);
    expect(usedClient.command).toHaveBeenCalledTimes(2); // resource + active, une seule connexion
  });

  it('watch()/unwatch() : tant qu\'un abonné sessions existe, les refresh suivants incluent la liste même appelés avec want=stats', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { gateway } = build();
    const unwatch = gateway.watch('r1');
    expect(gateway.watchers('r1')).toBe(1);

    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient({ sessions: 2 })));
    const r = await gateway.getLiveSnapshot('r1', 'stats'); // demande seulement 'stats'...
    expect(r.sessions).toHaveLength(2); // ...mais la liste est là grâce au watcher

    unwatch();
    expect(gateway.watchers('r1')).toBe(0);
    jest.advanceTimersByTime(GATEWAY_FRESH_MS + 1000);
    let usedClient!: ReturnType<typeof fakeClient>;
    mockRemote.run.mockImplementationOnce((_id: string, fn: (c: unknown) => unknown) => {
      usedClient = fakeClient({ sessions: 2 });
      return fn(usedClient);
    });
    await gateway.getLiveSnapshot('r1', 'stats');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    // resource + count-only : plus de lecture de LISTE (§5), mais le compteur reste toujours collecté
    expect(usedClient.command).toHaveBeenCalledTimes(2);
    expect(usedClient.command.mock.calls[1][0]).toEqual(['/ip/hotspot/active/print', '=count-only=']);
    jest.useRealTimers();
  });

  it('double désabonnement idempotent : ne fait pas mentir le compteur', () => {
    const { gateway } = build();
    const unwatch = gateway.watch('r1');
    gateway.watch('r1');
    unwatch();
    unwatch(); // deuxième appel, ne doit pas décrémenter deux fois
    expect(gateway.watchers('r1')).toBe(1);
  });
});

describe('RouterGatewayService — priorité et minFreshnessMs', () => {
  it('minFreshnessMs plus tolérant (Telemetry) : sert le cache sans déclencher de refresh', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { gateway } = build();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient()));
    await gateway.getLiveSnapshot('r1', 'stats');
    jest.advanceTimersByTime(GATEWAY_FRESH_MS + 1000); // périmé pour l'UI (8-10s)

    const forTelemetry = await gateway.getLiveSnapshot('r1', 'stats', { priority: 'P3_TELEMETRY', minFreshnessMs: 5 * 60_000 });
    expect(forTelemetry.stale).toBe(false); // accepté tel quel, pas de refresh
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

describe('RouterGatewayService — routeur offline / timeout / recovery', () => {
  it("échec sans snapshot préalable (cold start) : l'erreur remonte à l'appelant", async () => {
    const { gateway } = build();
    mockRemote.run.mockRejectedValueOnce(new Error('Routeur injoignable (timeout)'));
    await expect(gateway.getLiveSnapshot('r1', 'stats')).rejects.toThrow(/injoignable/);
  });

  it("E/F. cold-start : après le premier échec, 10 requêtes pendant le cooldown → 0 nouvelle lecture RouterOS (le RB951 est protégé dès son 1er échec, pas seulement après un succès)", async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { gateway } = build();
    mockRemote.run.mockRejectedValueOnce(new Error('Routeur injoignable (timeout)'));
    await expect(gateway.getLiveSnapshot('r1', 'stats')).rejects.toThrow(); // 1er échec, jamais de snapshot
    expect(mockRemote.run).toHaveBeenCalledTimes(1);

    const attempts = Array.from({ length: 10 }, () =>
      gateway.getLiveSnapshot('r1', 'stats').catch((e: Error) => e),
    );
    const results = await Promise.all(attempts);
    expect(mockRemote.run).toHaveBeenCalledTimes(1); // toujours 1 : aucune des 10 n'a rouvert RouterOS
    for (const r of results) expect(r).toBeInstanceOf(Error); // état contrôlé, pas un écran silencieux
    jest.useRealTimers();
  });

  it('G. cooldown expiré : 10 nouvelles requêtes concurrentes → exactement 1 nouvelle lecture RouterOS', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { gateway } = build();
    mockRemote.run.mockRejectedValueOnce(new Error('Routeur injoignable (timeout)'));
    await expect(gateway.getLiveSnapshot('r1', 'stats')).rejects.toThrow();
    jest.advanceTimersByTime(GATEWAY_RETRY_COOLDOWN_MS + 1000);

    let release!: () => void;
    mockRemote.run.mockImplementationOnce(
      (_id: string, fn: (c: unknown) => unknown) => new Promise((resolve) => (release = () => resolve(fn(fakeClient({ cpu: '30' }))))),
    );
    const attempts = Array.from({ length: 10 }, () => gateway.getLiveSnapshot('r1', 'stats'));
    await Promise.resolve();
    release();
    const results = await Promise.all(attempts);
    expect(mockRemote.run).toHaveBeenCalledTimes(2); // 1er échec + exactement 1 nouvelle lecture
    for (const r of results) expect(r.cpuPercent).toBe(30);
    jest.useRealTimers();
  });

  it('recovery : health repasse ONLINE et ROUTER_LIVE_RECOVERED est émis après un ROUTER_LIVE_STALE', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { gateway, events } = build();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient()));
    await gateway.getLiveSnapshot('r1', 'stats');
    jest.advanceTimersByTime(GATEWAY_FRESH_MS + 1000);

    mockRemote.run.mockRejectedValueOnce(new Error('timeout'));
    await gateway.getLiveSnapshot('r1', 'stats'); // déclenche le refresh en fond
    for (let i = 0; i < 20; i++) await Promise.resolve(); // laisse le refresh échouer
    const degraded = await gateway.getLiveSnapshot('r1', 'stats');
    expect(degraded.health).toBe('OFFLINE');
    expect(events.some((e: any) => e.type === 'ROUTER_LIVE_STALE')).toBe(true);

    jest.advanceTimersByTime(GATEWAY_RETRY_COOLDOWN_MS + 1000);
    mockRemote.run.mockImplementationOnce((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient()));
    await gateway.getLiveSnapshot('r1', 'stats');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const recovered = await gateway.getLiveSnapshot('r1', 'stats');
    expect(recovered.health).toBe('ONLINE');
    expect(events.some((e: any) => e.type === 'ROUTER_LIVE_RECOVERED')).toBe(true);
    jest.useRealTimers();
  });

  it('routeur lent (worst-case RB951) : le cache reste servi < 300 ms même si RouterOS répond après 20-30s', async () => {
    const { gateway } = build();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient()));
    await gateway.getLiveSnapshot('r1', 'stats');
    const t0 = Date.now();
    const r = await gateway.getLiveSnapshot('r1', 'stats'); // HIT, RouterOS jamais interrogé de nouveau
    expect(Date.now() - t0).toBeLessThan(300);
    expect(r.stale).toBe(false);
  });
});

describe('RouterGatewayService — SESSION_COUNT_CHANGED / SESSIONS_CHANGED', () => {
  it('émet un événement seulement quand le compteur change réellement', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const { gateway, events } = build();
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient({ sessions: 2 })));
    await gateway.getLiveSnapshot('r1', 'sessions');
    events.length = 0;
    jest.advanceTimersByTime(GATEWAY_FRESH_MS + 1000);
    mockRemote.run.mockImplementationOnce((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient({ sessions: 2 })));
    await gateway.getLiveSnapshot('r1', 'sessions');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(events.some((e: any) => e.type === 'SESSION_COUNT_CHANGED')).toBe(false); // inchangé (2→2)

    jest.advanceTimersByTime(GATEWAY_FRESH_MS + 1000);
    mockRemote.run.mockImplementationOnce((_id: string, fn: (c: unknown) => unknown) => fn(fakeClient({ sessions: 3 })));
    await gateway.getLiveSnapshot('r1', 'sessions');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(events.some((e: any) => e.type === 'SESSION_COUNT_CHANGED' && e.sessionCount === 3)).toBe(true);
    expect(events.some((e: any) => e.type === 'SESSIONS_CHANGED')).toBe(true);
    jest.useRealTimers();
  });
});
