import {
  RouterSyncScheduler,
  SYNC_BACKOFF_CAP_MS,
  type SchedulerRouter,
  type SyncRunStatus,
} from './router-sync-scheduler';

/**
 * Simulation à horloge virtuelle : le temps avance par pas de 1 s, le dispatcheur
 * est appelé toutes les 5 s (comme @Interval(5_000)) et chaque lecture « dure »
 * le temps configuré pour son routeur.
 */
interface Behavior {
  durationMs: number;
  status?: SyncRunStatus | ((attempt: number, t: number) => SyncRunStatus);
}

function makeSim(
  routers: () => SchedulerRouter[],
  behaviors: Record<string, Behavior>,
  poolMax = 3,
) {
  let t = 1_000_000;
  const t0 = t;
  const starts: Record<string, number[]> = {};
  const attempts: Record<string, number> = {};
  const running = new Set<string>();
  const pending: { finishAt: number; done: () => void }[] = [];
  const stats = { maxActive: 0, maxSlowActive: 0, concurrentSameRouter: 0 };
  const lines: string[] = [];
  let slowIds = new Set<string>();

  const scheduler = new RouterSyncScheduler({
    now: () => t,
    poolMax,
    listRouters: async () => routers(),
    log: (l) => lines.push(l),
    warn: (l) => lines.push(l),
    run: (r) =>
      new Promise<SyncRunStatus>((resolve, reject) => {
        if (running.has(r.id)) stats.concurrentSameRouter += 1;
        running.add(r.id);
        (starts[r.id] ??= []).push(t);
        const attempt = (attempts[r.id] = (attempts[r.id] ?? 0) + 1);
        stats.maxActive = Math.max(stats.maxActive, running.size);
        stats.maxSlowActive = Math.max(
          stats.maxSlowActive,
          [...running].filter((id) => slowIds.has(id)).length,
        );
        const b = behaviors[r.id];
        const status =
          typeof b.status === 'function' ? b.status(attempt, t) : (b.status ?? 'ok');
        pending.push({
          finishAt: t + b.durationMs,
          done: () => {
            running.delete(r.id);
            if (status === ('throw' as SyncRunStatus)) reject(new Error('boom'));
            else resolve(status);
          },
        });
      }),
  });

  const flush = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };

  return {
    scheduler,
    starts,
    stats,
    lines,
    now: () => t,
    elapsed: () => t - t0,
    markSlow: (ids: string[]) => (slowIds = new Set(ids)),
    async run(totalMs: number) {
      const end = t + totalMs;
      while (t < end) {
        t += 1_000;
        for (const p of pending.filter((x) => x.finishAt <= t)) {
          pending.splice(pending.indexOf(p), 1);
          p.done();
        }
        await flush();
        if ((t - t0) % 5_000 === 0) {
          await scheduler.dispatch();
          await flush();
        }
      }
    },
  };
}

const router = (id: string, over: Partial<SchedulerRouter> = {}): SchedulerRouter => ({
  id,
  tenantId: 't1',
  hasCredentials: true,
  hasActivePeer: true,
  tunnelDown: false,
  ...over,
});

const gaps = (a: number[] = []) => a.slice(1).map((x, i) => (x - a[i]) / 1000);
const afterWarmup = (a: number[], from: number) => a.filter((x) => x >= from);

describe('RouterSyncScheduler', () => {
  it('A. un routeur lent (30 s) ne ralentit pas un routeur sain : lu toutes les 25-30 s', async () => {
    const sim = makeSim(() => [router('slow'), router('healthy')], {
      slow: { durationMs: 30_000 },
      healthy: { durationMs: 1_000 },
    });
    await sim.run(600_000);
    const g = gaps(sim.starts['healthy']);
    expect(g.length).toBeGreaterThan(15);
    expect(Math.min(...g)).toBeGreaterThanOrEqual(25);
    expect(Math.max(...g)).toBeLessThanOrEqual(30);
    // le lent : période ≥ 2 × sa durée (60 s), pas 25 s
    expect(Math.min(...gaps(sim.starts['slow']))).toBeGreaterThanOrEqual(60);
  });

  it('B. deux routeurs lents + un sain (pool 3) : un emplacement reste toujours disponible au sain', async () => {
    const sim = makeSim(() => [router('s1'), router('s2'), router('healthy')], {
      s1: { durationMs: 30_000, status: 'failed' },
      s2: { durationMs: 30_000, status: 'failed' },
      healthy: { durationMs: 1_000 },
    });
    sim.markSlow(['s1', 's2']);
    await sim.run(900_000);
    const g = gaps(afterWarmup(sim.starts['healthy'], sim.now() - 800_000));
    expect(Math.max(...g)).toBeLessThanOrEqual(30);
    expect(sim.stats.maxActive).toBeLessThanOrEqual(3);
  });

  it('B2. trois routeurs lents : au plus poolMax-1 = 2 en même temps, le sain n\'attend pas', async () => {
    const sim = makeSim(() => [router('s1'), router('s2'), router('s3'), router('healthy')], {
      s1: { durationMs: 40_000, status: 'failed' },
      s2: { durationMs: 40_000, status: 'failed' },
      s3: { durationMs: 40_000, status: 'failed' },
      healthy: { durationMs: 1_000 },
    });
    sim.markSlow(['s1', 's2', 's3']);
    await sim.run(900_000);
    // après l'échauffement (la 1re lecture d'un routeur inconnu n'est pas encore « lente »)
    const g = gaps(afterWarmup(sim.starts['healthy'], sim.now() - 800_000));
    expect(Math.max(...g)).toBeLessThanOrEqual(30);
  });

  it('C. dix routeurs sains : le pool ne dépasse jamais 3 et chacun reste frais', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `r${i}`);
    const sim = makeSim(
      () => ids.map((id) => router(id)),
      Object.fromEntries(ids.map((id) => [id, { durationMs: 1_000 }])),
    );
    await sim.run(600_000);
    expect(sim.stats.maxActive).toBeLessThanOrEqual(3);
    for (const id of ids) expect(Math.max(...gaps(sim.starts[id]))).toBeLessThanOrEqual(40);
  });

  it('D. le même routeur déclenché deux fois : une seule opération', async () => {
    const sim = makeSim(() => [router('r1')], { r1: { durationMs: 20_000 } });
    await Promise.all([sim.scheduler.dispatch(), sim.scheduler.dispatch()]);
    await sim.scheduler.dispatch(); // pendant que la lecture est en cours
    expect(sim.starts['r1']).toHaveLength(1);
    await sim.run(10_000);
    await sim.scheduler.dispatch();
    expect(sim.starts['r1']).toHaveLength(1);
    expect(sim.stats.concurrentSameRouter).toBe(0);
  });

  it('E. échecs répétés : backoff croissant (25 s, 50 s, 100 s…) plafonné à 5 min', async () => {
    const sim = makeSim(() => [router('r1')], { r1: { durationMs: 1_000, status: 'failed' } });
    await sim.run(2_400_000);
    const g = gaps(sim.starts['r1']);
    // intervalle entre débuts = durée (1 s) + backoff, au pas du dispatcheur (5 s)
    expect(g[0]).toBeGreaterThanOrEqual(26);
    expect(g[1]).toBeGreaterThan(g[0]);
    expect(g[2]).toBeGreaterThan(g[1]);
    expect(Math.max(...g)).toBeLessThanOrEqual((SYNC_BACKOFF_CAP_MS + 1_000 + 5_000) / 1000);
    expect(g[g.length - 1]).toBeGreaterThanOrEqual(SYNC_BACKOFF_CAP_MS / 1000);
  });

  it('E2. tunnel mort : une sonde toutes les 3 min au lieu d\'une tentative toutes les 25 s', async () => {
    const sim = makeSim(() => [router('dead', { tunnelDown: true })], {
      dead: { durationMs: 26_000, status: 'failed' },
    });
    await sim.run(900_000); // 15 min
    const n = sim.starts['dead'].length;
    expect(n).toBeLessThanOrEqual(5); // contre 6 avec le seul backoff et ~36 à cadence fixe de 25 s
    for (const g of gaps(sim.starts['dead'])) expect(g).toBeGreaterThanOrEqual(180); // sonde : ≥ 3 min entre deux tentatives
  });

  it('E3. le handshake revient : lecture immédiate, sans attendre le backoff', async () => {
    let down = true;
    const sim = makeSim(() => [router('r1', { tunnelDown: down })], {
      r1: { durationMs: 1_000, status: (a) => (a <= 1 ? 'failed' : 'ok') },
    });
    await sim.run(60_000);
    const before = sim.starts['r1'].length;
    down = false;
    await sim.run(40_000); // 15 s de TTL de liste + pas du dispatcheur
    expect(sim.starts['r1'].length).toBeGreaterThan(before);
  });

  it('F. le routeur récupère : un succès réinitialise le backoff et la cadence redevient 25-30 s', async () => {
    const sim = makeSim(() => [router('r1')], {
      r1: { durationMs: 1_000, status: (a) => (a <= 4 ? 'failed' : 'ok') },
    });
    await sim.run(1_200_000);
    const g = gaps(sim.starts['r1']);
    const tail = g.slice(-5);
    for (const x of tail) {
      expect(x).toBeGreaterThanOrEqual(25);
      expect(x).toBeLessThanOrEqual(30);
    }
    expect(sim.lines.some((l) => /RESULT .* status=ok .* consecutiveFailures=0 backoffMs=0/.test(l))).toBe(true);
  });

  it('G. routeur sans identifiants : aucun appel RouterOS ; réintroduit dès que la configuration apparaît', async () => {
    let hasCredentials = false;
    const sim = makeSim(() => [router('nocreds', { hasCredentials })], { nocreds: { durationMs: 1_000 } });
    await sim.run(300_000);
    expect(sim.starts['nocreds']).toBeUndefined();
    hasCredentials = true;
    await sim.run(25_000); // TTL de liste (15 s) + pas du dispatcheur (5 s)
    expect(sim.starts['nocreds']?.length).toBeGreaterThanOrEqual(1);
    expect(sim.lines.filter((l) => l.includes('ELIGIBILITY routerId=nocreds')).length).toBe(2);
  });

  it('G2. tunnel non provisionné : jamais lu', async () => {
    const sim = makeSim(() => [router('nopeer', { hasActivePeer: false })], { nopeer: { durationMs: 1_000 } });
    await sim.run(120_000);
    expect(sim.starts['nopeer']).toBeUndefined();
  });

  it('H. exception dans une lecture : emplacement libéré, dispatcheur intact, reprise avec backoff', async () => {
    const sim = makeSim(() => [router('r1'), router('r2')], {
      r1: { durationMs: 1_000, status: 'throw' as SyncRunStatus },
      r2: { durationMs: 1_000 },
    });
    await sim.run(300_000);
    expect(sim.scheduler.poolActive).toBe(0);
    expect(sim.starts['r1'].length).toBeGreaterThanOrEqual(2); // repris après backoff
    expect(sim.starts['r2'].length).toBeGreaterThan(8); // le sain n'est pas affecté
    expect(sim.lines.some((l) => l.includes('RUN_ERROR routerId=r1'))).toBe(true);
  });

  it('un « skipped » (verrou du routeur pris ailleurs) ne compte pas comme un échec', async () => {
    const sim = makeSim(() => [router('r1')], { r1: { durationMs: 1_000, status: 'skipped' } });
    await sim.run(60_000);
    expect(sim.lines.some((l) => /consecutiveFailures=[1-9]/.test(l))).toBe(false);
  });

  it('journaux mesurables : DISPATCH/RESULT/SUMMARY avec fraîcheur par routeur', async () => {
    const sim = makeSim(() => [router('abcdef12-0000')], { 'abcdef12-0000': { durationMs: 1_000 } });
    await sim.run(130_000);
    expect(sim.lines.some((l) => /^sync scheduler DISPATCH routerId=abcdef12-0000 dueAt=\S+ queueWaitMs=\d+ poolActive=1 poolMax=3$/.test(l))).toBe(true);
    expect(sim.lines.some((l) => /^sync scheduler RESULT routerId=abcdef12-0000 status=ok startedAt=\S+ durationMs=1000 consecutiveFailures=0 backoffMs=0 nextDueAt=\S+ poolActive=0 poolMax=3 lastSuccessAgeMs=0$/.test(l))).toBe(true);
    expect(sim.lines.some((l) => /^sync scheduler SUMMARY routers=1 eligible=1 .* lastSuccessAgeMs=\{abcdef12=\d+\}$/.test(l))).toBe(true);
  });

  it('échec de la liste des routeurs : on garde la liste précédente et on le journalise', async () => {
    let fail = false;
    const sim = makeSim(
      () => {
        if (fail) throw new Error('db down');
        return [router('r1')];
      },
      { r1: { durationMs: 1_000 } },
    );
    await sim.run(60_000);
    const before = sim.starts['r1'].length;
    fail = true;
    await sim.run(120_000);
    expect(sim.starts['r1'].length).toBeGreaterThan(before);
    expect(sim.lines.some((l) => l.includes('LIST_FAILED'))).toBe(true);
  });
});
