import { ROUTER_ITEMS_MAX, RouterRow, summarizeRouters } from './router-health.logic';

const NOW = new Date('2026-11-05T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
let n = 0;
const router = (o: Partial<RouterRow> = {}): RouterRow => ({
  id: `id${(n += 1)}-0000-0000`,
  name: `r${n}`,
  mode: 'REMOTE',
  health: 'ONLINE',
  credentialsConfigured: true,
  lastHeartbeat: ago(1),
  createdAt: ago(100_000),
  ...o,
});
const run = (rows: RouterRow[]) => summarizeRouters(rows, NOW);

describe('summarizeRouters — niveaux', () => {
  it('aucun routeur → GREEN', () => {
    expect(run([])).toMatchObject({ level: 'GREEN', total: 0, remote: 0, local: 0, items: [] });
  });
  it('LOCAL OFFLINE uniquement → GREEN, jamais compté offline', () => {
    const r = run([router({ mode: 'LOCAL', health: 'OFFLINE', lastHeartbeat: null, credentialsConfigured: false })]);
    expect(r).toMatchObject({ level: 'GREEN', local: 1, remote: 0, offline: 0, neverSeen: 0, remoteWithoutCredentials: 0 });
    expect(r.items).toEqual([]);
  });
  it('tous REMOTE ONLINE → GREEN', () => {
    expect(run([router(), router()])).toMatchObject({ level: 'GREEN', online: 2 });
  });
  it('DEGRADED → ORANGE', () => {
    expect(run([router({ health: 'DEGRADED' })])).toMatchObject({ level: 'ORANGE', degraded: 1 });
  });
  it('OFFLINE récent → ORANGE', () => {
    expect(run([router({ health: 'OFFLINE', lastHeartbeat: ago(600) })])).toMatchObject({
      level: 'ORANGE', offline: 1, offlineOver24h: 0, oldestOfflineMinutes: 600,
    });
  });
  it('OFFLINE à exactement 24 h → RED', () => {
    expect(run([router({ health: 'OFFLINE', lastHeartbeat: ago(1440) })])).toMatchObject({ level: 'RED', offlineOver24h: 1 });
  });
  it('plusieurs OFFLINE → RED, oldest = le plus ancien', () => {
    const r = run([
      router({ health: 'OFFLINE', lastHeartbeat: ago(20_456) }),
      router({ health: 'OFFLINE', lastHeartbeat: ago(10) }),
    ]);
    expect(r).toMatchObject({ level: 'RED', offline: 2, offlineOver24h: 1, oldestOfflineMinutes: 20_456 });
  });
  it('REMOTE sans identifiants → ORANGE', () => {
    expect(run([router({ credentialsConfigured: false })])).toMatchObject({ level: 'ORANGE', remoteWithoutCredentials: 1 });
  });
  it('neverSeen < 24 h → GREEN ; ≥ 24 h → ORANGE ; séparé de oldestOfflineMinutes', () => {
    const fresh = router({ health: 'OFFLINE', lastHeartbeat: null, createdAt: ago(60) });
    expect(run([fresh])).toMatchObject({ level: 'GREEN', neverSeen: 1, offline: 1, oldestOfflineMinutes: null });
    const old = router({ health: 'OFFLINE', lastHeartbeat: null, createdAt: ago(1440) });
    expect(run([old])).toMatchObject({ level: 'ORANGE', neverSeen: 1, oldestOfflineMinutes: null, offlineOver24h: 0 });
  });
  it('UNKNOWN seul → ORANGE ; ERROR seul → ORANGE', () => {
    expect(run([router({ health: 'UNKNOWN' })])).toMatchObject({ level: 'ORANGE', unknown: 1 });
    expect(run([router({ health: 'ERROR' })])).toMatchObject({ level: 'ORANGE', unknown: 1 });
  });
  it('UNKNOWN + OFFLINE ancien → RED', () => {
    expect(run([router({ health: 'UNKNOWN' }), router({ health: 'OFFLINE', lastHeartbeat: ago(2000) })]).level).toBe('RED');
  });
  it('LOCAL UNKNOWN / ERROR → GREEN, unknown ne compte que les REMOTE', () => {
    const r = run([router({ mode: 'LOCAL', health: 'UNKNOWN' }), router({ mode: 'LOCAL', health: 'ERROR' })]);
    expect(r).toMatchObject({ level: 'GREEN', unknown: 0, local: 2, remote: 0 });
  });
  it('RED prime sur ORANGE', () => {
    expect(
      run([router({ health: 'DEGRADED' }), router({ credentialsConfigured: false }), router({ health: 'OFFLINE', lastHeartbeat: ago(3000) })]).level,
    ).toBe('RED');
  });
  it('compteurs de santé mutuellement exclusifs, somme = remote', () => {
    const r = run([
      router(), router({ health: 'DEGRADED' }), router({ health: 'OFFLINE', lastHeartbeat: ago(5) }),
      router({ health: 'UNKNOWN', lastHeartbeat: null }), router({ mode: 'LOCAL', health: 'ONLINE' }),
    ]);
    expect(r.online + r.degraded + r.offline + r.unknown).toBe(r.remote);
    expect(r).toMatchObject({ total: 5, remote: 4, local: 1 });
  });
  it('lastHeartbeatAt = le plus récent des REMOTE (LOCAL ignorés)', () => {
    const r = run([router({ lastHeartbeat: ago(30) }), router({ lastHeartbeat: ago(2) }), router({ mode: 'LOCAL', lastHeartbeat: ago(0) })]);
    expect(r.lastHeartbeatAt).toEqual(ago(2));
  });
});

describe('summarizeRouters — période de grâce (jamais vu, créé < 24 h)', () => {
  const fresh = (o: Partial<RouterRow> = {}) =>
    router({ lastHeartbeat: null, createdAt: ago(30), health: 'UNKNOWN', credentialsConfigured: false, ...o });

  it('UNKNOWN sans identifiants créé depuis 30 min → GREEN, compteurs descriptifs visibles', () => {
    const r = run([fresh()]);
    expect(r).toMatchObject({ level: 'GREEN', neverSeen: 1, remoteWithoutCredentials: 1, unknown: 1 });
    expect(r.items[0].provisionPendingMinutes).toBe(30);
  });
  it('même routeur créé depuis 25 h → ORANGE', () => {
    expect(run([fresh({ createdAt: ago(25 * 60) })]).level).toBe('ORANGE');
  });
  it('OFFLINE jamais vu créé depuis 2 h → GREEN ; 25 h → ORANGE', () => {
    expect(run([fresh({ health: 'OFFLINE', credentialsConfigured: true, createdAt: ago(120) })]).level).toBe('GREEN');
    expect(run([fresh({ health: 'OFFLINE', credentialsConfigured: true, createdAt: ago(25 * 60) })]).level).toBe('ORANGE');
  });
  it('déjà vu : UNKNOWN / ERROR / DEGRADED → ORANGE immédiatement', () => {
    for (const health of ['UNKNOWN', 'ERROR', 'DEGRADED'] as const) {
      expect(run([router({ health, createdAt: ago(30) })]).level).toBe('ORANGE');
    }
  });
  it('déjà vu : OFFLINE depuis 25 h → RED', () => {
    expect(run([router({ health: 'OFFLINE', lastHeartbeat: ago(25 * 60) })]).level).toBe('RED');
  });
  it('routeur en grâce + ancien OFFLINE → RED', () => {
    expect(run([fresh(), router({ health: 'OFFLINE', lastHeartbeat: ago(3000) })]).level).toBe('RED');
  });
  it('routeur en grâce sans identifiants seul : GREEN mais remoteWithoutCredentials = 1', () => {
    expect(run([fresh({ health: 'ONLINE' })])).toMatchObject({ level: 'GREEN', remoteWithoutCredentials: 1 });
  });
});

describe('summarizeRouters — items', () => {
  it('tri : OFFLINE anciens, jamais vus (createdAt), ERROR, DEGRADED, UNKNOWN, ONLINE', () => {
    const on = router({ name: 'on' });
    const deg = router({ name: 'deg', health: 'DEGRADED' });
    const nev = router({ name: 'nev', health: 'OFFLINE', lastHeartbeat: null, createdAt: ago(5000) });
    const offRecent = router({ name: 'off-recent', health: 'OFFLINE', lastHeartbeat: ago(30) });
    const offOld = router({ name: 'off-old', health: 'OFFLINE', lastHeartbeat: ago(9000) });
    const err = router({ name: 'err', health: 'ERROR' });
    const unk = router({ name: 'unk', health: 'UNKNOWN' });
    expect(run([on, unk, deg, nev, err, offRecent, offOld]).items.map((i) => i.name)).toEqual([
      'off-old', 'off-recent', 'nev', 'err', 'deg', 'unk', 'on',
    ]);
  });
  it('minutes calculées et id tronqué', () => {
    const [i] = run([router({ health: 'OFFLINE', lastHeartbeat: ago(125) })]).items;
    expect(i.offlineMinutes).toBe(125);
    expect(i.provisionPendingMinutes).toBeNull();
    expect(i.id).toHaveLength(8);
    const [j] = run([router({ health: 'OFFLINE', lastHeartbeat: null, createdAt: ago(90) })]).items;
    expect(j).toMatchObject({ offlineMinutes: null, provisionPendingMinutes: 90 });
  });
  it(`plafond à ${ROUTER_ITEMS_MAX}`, () => {
    const rows = [
      ...Array.from({ length: 119 }, () => router()),
      router({ name: 'critique', health: 'OFFLINE', lastHeartbeat: ago(5000) }),
    ];
    const r = run(rows);
    expect(r.items).toHaveLength(ROUTER_ITEMS_MAX);
    expect(r.items[0].name).toBe('critique'); // le tri précède le plafond
    expect(r.remote).toBe(120);
  });
});
