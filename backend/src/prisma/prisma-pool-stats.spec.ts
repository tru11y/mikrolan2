import { PrismaPoolStats, SLOW_QUERY_MS, isPoolTimeout } from './prisma-pool-stats';
import { PrismaService } from './prisma.service';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 15, 10, 0, 0);

describe('PrismaPoolStats', () => {
  it('vide : tout à zéro', () => {
    expect(new PrismaPoolStats().snapshot(T0)).toEqual({
      windowMinutes: 60,
      queriesLast1h: 0,
      avgQueryMsLast1h: 0,
      maxQueryMsLast1h: 0,
      slowQueriesLast1h: 0,
      p2024Last1h: 0,
      p2024Total: 0,
      lastP2024At: null,
    });
  });

  it('durées : moyenne, maximum et requêtes lentes (>= 2 s)', () => {
    const s = new PrismaPoolStats();
    s.recordQuery(10, T0);
    s.recordQuery(30, T0);
    s.recordQuery(SLOW_QUERY_MS, T0 + MIN);
    expect(s.snapshot(T0 + MIN)).toMatchObject({ queriesLast1h: 3, maxQueryMsLast1h: SLOW_QUERY_MS, slowQueriesLast1h: 1, avgQueryMsLast1h: Math.round((10 + 30 + SLOW_QUERY_MS) / 3) });
  });

  it('P2024 : compteur sur 1 h glissante, total cumulé conservé, dernière date', () => {
    const s = new PrismaPoolStats();
    s.recordPoolTimeout(T0);
    s.recordPoolTimeout(T0 + 5 * MIN);
    expect(s.snapshot(T0 + 10 * MIN)).toMatchObject({ p2024Last1h: 2, p2024Total: 2, lastP2024At: new Date(T0 + 5 * MIN).toISOString() });
    const later = s.snapshot(T0 + 61 * MIN); // le premier seau a quitté la fenêtre
    expect(later.p2024Last1h).toBe(1);
    expect(later.p2024Total).toBe(2);
    expect(s.snapshot(T0 + 120 * MIN).p2024Last1h).toBe(0);
  });

  it('mémoire constante : un seau recyclé ne mélange pas deux heures différentes', () => {
    const s = new PrismaPoolStats();
    s.recordQuery(100, T0);
    s.recordQuery(7, T0 + 60 * MIN); // même seau (modulo 60), 1 h plus tard
    expect(s.snapshot(T0 + 60 * MIN)).toMatchObject({ queriesLast1h: 1, maxQueryMsLast1h: 7 });
  });

  it('isPoolTimeout : reconnaît uniquement le code P2024', () => {
    expect(isPoolTimeout({ code: 'P2024' })).toBe(true);
    expect(isPoolTimeout({ code: 'P2002' })).toBe(false);
    expect(isPoolTimeout(new Error('x'))).toBe(false);
    expect(isPoolTimeout(null)).toBe(false);
  });
});

describe('PrismaService — middleware de mesure', () => {
  const call = (svc: PrismaService, next: () => Promise<unknown>) =>
    (svc as unknown as { statsMiddleware(p: unknown, n: () => Promise<unknown>): Promise<unknown> }).statsMiddleware({}, next);

  it('une requête réussie est mesurée, sans erreur P2024', async () => {
    const svc = new PrismaService();
    await expect(call(svc, async () => 'ok')).resolves.toBe('ok');
    expect(svc.poolStats.snapshot()).toMatchObject({ queriesLast1h: 1, p2024Last1h: 0 });
  });

  it('une erreur P2024 est comptée, mesurée et relancée telle quelle', async () => {
    const svc = new PrismaService();
    const err = Object.assign(new Error('Timed out fetching a new connection'), { code: 'P2024' });
    await expect(call(svc, async () => Promise.reject(err))).rejects.toBe(err);
    expect(svc.poolStats.snapshot()).toMatchObject({ queriesLast1h: 1, p2024Last1h: 1, p2024Total: 1 });
  });

  it('une autre erreur n est pas comptée comme P2024', async () => {
    const svc = new PrismaService();
    await expect(call(svc, async () => Promise.reject(Object.assign(new Error('dup'), { code: 'P2002' })))).rejects.toThrow('dup');
    expect(svc.poolStats.snapshot().p2024Last1h).toBe(0);
  });
});
