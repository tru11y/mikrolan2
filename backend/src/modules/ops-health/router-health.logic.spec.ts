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

describe('summarizeRouters — items', () => {
  it('tri : OFFLINE anciens, jamais vus (createdAt), DEGRADED, ONLINE', () => {
    const on = router({ name: 'on' });
    const deg = router({ name: 'deg', health: 'DEGRADED' });
    const nev = router({ name: 'nev', health: 'OFFLINE', lastHeartbeat: null, createdAt: ago(5000) });
    const offRecent = router({ name: 'off-recent', health: 'OFFLINE', lastHeartbeat: ago(30) });
    const offOld = router({ name: 'off-old', health: 'OFFLINE', lastHeartbeat: ago(9000) });
    expect(run([on, deg, nev, offRecent, offOld]).items.map((i) => i.name)).toEqual(['off-old', 'off-recent', 'nev', 'deg', 'on']);
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
    const r = run(Array.from({ length: 120 }, () => router()));
    expect(r.items).toHaveLength(ROUTER_ITEMS_MAX);
    expect(r.remote).toBe(120);
  });
});
