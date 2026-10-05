import { Logger } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { RouterGatewayService } from '../router-gateway/router-gateway.service';
import { RouterLiveEventsService } from '../router-gateway/router-live-events.service';
import { SYNC_FEED_STALE_MS } from '../router-gateway/router-gateway.types';

/**
 * Phase 1A : syncActivations réutilise SA lecture active/print pour alimenter le snapshot live.
 * Le CA doit rester strictement indépendant du live (best effort, jamais d'échec propagé).
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

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ '.id': `*${i}`, user: `T${i}`, address: '10.0.0.' + i, 'mac-address': 'AA', 'bytes-in': '1', 'bytes-out': '2', uptime: '1m' }));
const vouchers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `v${i}`, code: `T${i}`, status: 'GENERATED', session: null, plan: { priceXof: 500 } }));

function build() {
  const liveEvents = new RouterLiveEventsService();
  const emitted: { type: string }[] = [];
  jest.spyOn(liveEvents, 'emit').mockImplementation((e) => emitted.push(e));
  const gateway = new RouterGatewayService(mockRemote as never, liveEvents);
  const svc = new SessionsService(mockPrisma as never, mockRemote as never, mockEvents as never, mockNotifications as never, gateway);
  const sync = (): Promise<'ok' | 'failed' | 'skipped'> =>
    (svc as unknown as { syncRouter(r: { id: string; tenantId: string }): Promise<'ok' | 'failed' | 'skipped'> }).syncRouter({ id: 'r1', tenantId: 't1' });
  return { svc, gateway, emitted, sync };
}

const businessCalls = () => ({
  promoted: mockPrisma.voucher.updateMany.mock.calls.length,
  created: mockPrisma.session.create.mock.calls.length,
  notified: mockPrisma.notification.create.mock.calls.length,
});

let now = 5_000_000;
beforeEach(() => {
  jest.clearAllMocks();
  now = 5_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'] = 'true';
  delete process.env['ROUTER_LIVE_ROUTER_IDS'];
  mockPrisma.session.findMany.mockResolvedValue([]);
  mockPrisma.voucher.findMany.mockResolvedValue(vouchers(13));
  mockPrisma.voucher.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.session.create.mockResolvedValue({});
  mockPrisma.notification.create.mockResolvedValue({ id: 'n1' });
  mockRemote.run.mockResolvedValue(rows(12));
});
afterEach(() => {
  delete process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'];
  jest.restoreAllMocks();
});

describe('Phase 1A — sessions live alimentées par syncActivations', () => {
  it('A. 12 sessions : la logique CA est identique (flag ON vs OFF) et le snapshot live = 12', async () => {
    delete process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'];
    await build().sync();
    const off = businessCalls();

    jest.clearAllMocks();
    mockPrisma.session.findMany.mockResolvedValue([]);
    mockPrisma.voucher.findMany.mockResolvedValue(vouchers(13));
    mockPrisma.voucher.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.session.create.mockResolvedValue({});
    mockPrisma.notification.create.mockResolvedValue({ id: 'n1' });
    mockRemote.run.mockResolvedValue(rows(12));
    process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'] = 'true';
    const { gateway, sync } = build();
    expect(await sync()).toBe('ok');

    expect(businessCalls()).toEqual(off);
    expect(off.promoted).toBe(12);
    const snap = gateway.peek('r1');
    expect(snap?.sessionCount).toBe(12);
    expect(snap?.sessions).toHaveLength(12);
    expect(snap?.sessionsSource).toBe('SYNC_ACTIVATIONS');
    expect(mockRemote.run).toHaveBeenCalledTimes(1); // une seule lecture RouterOS
  });

  it('B. publication snapshot qui lève : syncActivations continue, résultat CA inchangé', async () => {
    const { gateway, sync } = build();
    jest.spyOn(gateway, 'publishSessions').mockImplementation(() => {
      throw new Error('live cassé');
    });
    expect(await sync()).toBe('ok');
    expect(businessCalls().promoted).toBe(12);
    expect(businessCalls().created).toBe(12);
  });

  it('B3. publication qui lève : aucune activation, prix ni Session perdus (payloads identiques au flag OFF)', async () => {
    delete process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'];
    await build().sync();
    const offPromote = mockPrisma.voucher.updateMany.mock.calls.map((c) => c[0]);
    const offCreate = mockPrisma.session.create.mock.calls.map((c) => c[0]);

    jest.clearAllMocks();
    mockPrisma.session.findMany.mockResolvedValue([]);
    mockPrisma.voucher.findMany.mockResolvedValue(vouchers(13));
    mockPrisma.voucher.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.session.create.mockResolvedValue({});
    mockPrisma.notification.create.mockResolvedValue({ id: 'n1' });
    mockRemote.run.mockResolvedValue(rows(12));
    process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'] = 'true';
    const { gateway, sync } = build();
    jest.spyOn(gateway, 'publishSessions').mockImplementation(() => {
      throw new Error('live cassé');
    });
    expect(await sync()).toBe('ok');

    const onPromote = mockPrisma.voucher.updateMany.mock.calls.map((c) => c[0]);
    expect(onPromote).toHaveLength(12);
    expect(onPromote.map((c) => c.data.priceXofAtActivation)).toEqual(Array(12).fill(500));
    expect(onPromote.map((c) => c.data.priceSnapshotSource)).toEqual(Array(12).fill('EXACT'));
    const strip = (x: { data: Record<string, unknown> }[]) => x.map((c) => ({ ...c, data: { ...c.data, usedAt: 0, lastSeenAt: 0 } }));
    expect(strip(onPromote)).toEqual(strip(offPromote));
    expect(strip(mockPrisma.session.create.mock.calls.map((c) => c[0]))).toEqual(strip(offCreate));
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(12);
  });

  it('B4. lecture RouterOS en échec ET noteSyncReadFailure qui lève : erreur d origine gérée comme avant', async () => {
    const { gateway, sync } = build();
    jest.spyOn(gateway, 'noteSyncReadFailure').mockImplementation(() => {
      throw new Error('live cassé');
    });
    mockRemote.run.mockRejectedValue(new Error('Routeur injoignable (timeout)'));
    const warn = jest.spyOn(Logger.prototype, 'warn');
    expect(await sync()).toBe('failed');
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.startsWith('Activation sync failed for router r1: Routeur injoignable (timeout)'))).toBe(true);
  });

  it('B2. gateway absent (module live indisponible) : syncActivations inchangé', async () => {
    const svc = new SessionsService(mockPrisma as never, mockRemote as never, mockEvents as never, mockNotifications as never);
    const status = await (svc as unknown as { syncRouter(r: { id: string; tenantId: string }): Promise<string> }).syncRouter({ id: 'r1', tenantId: 't1' });
    expect(status).toBe('ok');
    expect(businessCalls().promoted).toBe(12);
  });

  it('C. 1, 5, 10 consumers sur un snapshot existant : 0 lecture active/print supplémentaire', async () => {
    const { gateway, sync } = build();
    await sync();
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    for (const n of [1, 5, 10]) {
      const res = await Promise.all(Array.from({ length: n }, () => gateway.getLiveSnapshot('r1', 'both')));
      expect(res.every((r) => r.sessionCount === 12)).toBe(true);
      expect(new Set(res.map((r) => r.sessionsUpdatedAt)).size).toBe(1);
    }
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
  });

  it('D. 12 → 13 : snapshot mis à jour et SSE émis (ROUTER_STATS + SESSION_COUNT_CHANGED + SESSIONS_CHANGED)', async () => {
    const { gateway, emitted, sync } = build();
    await sync();
    emitted.length = 0;
    now += 25_000;
    mockRemote.run.mockResolvedValue(rows(13));
    await sync();
    expect(gateway.peek('r1')?.sessionCount).toBe(13);
    const types = emitted.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['ROUTER_STATS', 'SESSION_COUNT_CHANGED', 'SESSIONS_CHANGED']));
  });

  it('D2. aucun changement : ROUTER_STATS seul (âge remis à zéro), pas de SESSIONS_CHANGED', async () => {
    const { emitted, sync } = build();
    await sync();
    emitted.length = 0;
    now += 25_000;
    await sync();
    expect(emitted.map((e) => e.type)).toEqual(['ROUTER_STATS']);
  });

  it('E. timeout RouterOS côté sync : snapshot précédent conservé, âge qui grandit, jamais « 0 session », tunnel non touché', async () => {
    const { gateway, emitted, sync } = build();
    await sync();
    now += 25_000;
    mockRemote.run.mockRejectedValue(new Error('Routeur injoignable (timeout)'));
    expect(await sync()).toBe('failed');

    let snap = gateway.peek('r1');
    expect(snap?.sessionCount).toBe(12);
    expect(snap?.sessions).toHaveLength(12);
    expect(snap?.routerOsState).toBe('SLOW');
    expect(snap?.health).toBe('ONLINE'); // l'API lente n'est jamais « tunnel offline »
    expect(emitted.some((e) => e.type === 'ROUTER_LIVE_STALE')).toBe(true);

    now += SYNC_FEED_STALE_MS;
    snap = gateway.peek('r1');
    expect(snap?.sessionsAgeMs).toBeGreaterThan(SYNC_FEED_STALE_MS);
    expect(snap?.stale).toBe(true);
    expect(snap?.sessionCount).toBe(12);

    // récupération automatique au prochain cycle sync réussi
    mockRemote.run.mockResolvedValue(rows(12));
    await sync();
    expect(gateway.peek('r1')?.routerOsState).toBe('RESPONSIVE');
    expect(gateway.peek('r1')?.stale).toBe(false);
  });

  it('F. snapshot absent : état inconnu/stale (pas « 0 session »), aucune lecture RouterOS déclenchée', async () => {
    const { gateway } = build();
    const res = await gateway.getLiveSnapshot('r1', 'both');
    expect(res.sessionCount).toBeNull();
    expect(res.sessions).toBeNull();
    expect(res.stale).toBe(true);
    expect(res.routerOsState).toBe('UNKNOWN');
    expect(mockRemote.run).not.toHaveBeenCalled();
  });

  it('flag OFF : publishSessions est un no-op et le comportement Gateway historique est inchangé', async () => {
    delete process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'];
    const { gateway, sync } = build();
    await sync();
    expect(gateway.peek('r1')).toBeNull();
  });

  it('allowlist ROUTER_LIVE_ROUTER_IDS : un routeur hors liste n\'est pas publié', async () => {
    process.env['ROUTER_LIVE_ROUTER_IDS'] = 'autre-routeur';
    const { gateway, sync } = build();
    await sync();
    expect(gateway.peek('r1')).toBeNull();
    expect(gateway.syncFeedEnabled('autre-routeur')).toBe(true);
  });
});
