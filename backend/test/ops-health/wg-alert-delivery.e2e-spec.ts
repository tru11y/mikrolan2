import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RemotePeerStatus, UserRole, UserStatus } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from '../helpers/app.helper';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { WgStaleAlertService } from '../../src/modules/ops-health/wg-stale-alert.service';
import { WireGuardService } from '../../src/common/wireguard/wireguard.service';

/**
 * Preuve de livraison des alertes WireGuard sur PostgreSQL réel : sélection des destinataires push par
 * tenant/rôle/statut, invalidation de token limitée au bon tenant, visibilité livrée / non livrée en Ops Health.
 * Aucun appel réseau : `fetch` (Expo) et l'envoi SMTP sont simulés, aucun token réel.
 */
describe('Alertes WireGuard — preuve de livraison (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let service: WgStaleAlertService;
  let adminToken = '';
  const originalFetch = global.fetch;
  const sendAlert = jest.fn();
  const DAY = 86_400_000;
  const stamp = Date.now();
  const tok = (n: string) => `ExponentPushToken[${n}-${stamp}]`;
  const t: Record<string, string> = {};
  const peerIds: string[] = [];
  let tenantA = '';
  let tenantB = '';
  let tenantC = '';

  const mkUser = (tenantId: string, tag: string, role: UserRole, token: string | null, over: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: { tenantId, email: `${tag}-${stamp}@e2e.local`, passwordHash: 'x', role, pushToken: token, ...over },
    });

  const mkPeer = async (tenantId: string, tag: string) => {
    const router = await prisma.router.create({ data: { tenantId, identity: `${tag}-${stamp}`, alias: tag } });
    const n = peerIds.length + 1;
    const peer = await prisma.remotePeer.create({
      data: {
        routerId: router.id,
        tenantId,
        wgPublicKey: `pk-${tag}-${stamp}`,
        wgIp: `10.98.${n}.${n}`,
        allocatedPort: 31000 + n + (stamp % 1000),
        serverPublicKey: 'srv',
        endpoint: 'vps:51820',
        status: RemotePeerStatus.ACTIVE,
        provisionedAt: new Date(stamp - 60 * DAY),
        lastHandshakeAt: new Date(stamp - 19 * DAY),
      },
    });
    peerIds.push(peer.id);
    return peer;
  };

  const expoOk = (n: number) => ({ ok: true, json: async () => ({ data: Array.from({ length: n }, (_, i) => ({ status: 'ok', id: `tk${i}` })) }) });
  const sentTokens = (mock: jest.Mock): string[] => (mock.mock.calls.flatMap(([, init]) => JSON.parse(init.body) as Array<{ to: string }>)).map((m) => m.to);

  /** Les autres fichiers e2e partagent la base : on gèle leurs peers pour que seuls les nôtres soient évalués. */
  const frozen: string[] = [];
  const freezeOtherPeers = async () => {
    const others = await prisma.remotePeer.findMany({ where: { status: RemotePeerStatus.ACTIVE, id: { notIn: peerIds } }, select: { id: true } });
    frozen.push(...others.map((p) => p.id));
    await prisma.remotePeer.updateMany({ where: { id: { in: others.map((p) => p.id) } }, data: { status: RemotePeerStatus.REVOKED } });
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    service = app.get(WgStaleAlertService);
    const wg = (service as unknown as { wg: WireGuardService }).wg;
    jest.spyOn(wg, 'enabled', 'get').mockReturnValue(true);
    jest.spyOn(wg, 'livePeers').mockResolvedValue({} as never);
    // ALERT_EMAIL vide : le repli SUPER_ADMIN lit la vraie base.
    Object.assign(service, { mail: { sendAlert }, config: { get: () => '' } });

    const a = await signupUser(app, { tenantName: 'Delivery A', email: `owner-a-${stamp}@e2e.local` });
    const b = await signupUser(app, { tenantName: 'Delivery B', email: `owner-b-${stamp}@e2e.local` });
    const c = await signupUser(app, { tenantName: 'Delivery C', email: `owner-c-${stamp}@e2e.local` });
    const ownerA = await prisma.user.findUniqueOrThrow({ where: { email: a.email } });
    const ownerB = await prisma.user.findUniqueOrThrow({ where: { email: b.email } });
    tenantA = ownerA.tenantId;
    tenantB = ownerB.tenantId;
    tenantC = (await prisma.user.findUniqueOrThrow({ where: { email: c.email } })).tenantId;

    t.ownerA = tok('ownerA');
    t.adminA = tok('adminA');
    await prisma.user.update({ where: { id: ownerA.id }, data: { pushToken: t.ownerA } });
    await mkUser(tenantA, 'admin-a', UserRole.ADMIN, t.adminA);
    await mkUser(tenantA, 'verifier-a', UserRole.TICKET_VERIFIER, tok('verifierA'));
    await mkUser(tenantA, 'member-a', UserRole.MEMBER, tok('memberA'));
    await mkUser(tenantA, 'suspended-a', UserRole.ADMIN, tok('suspendedA'), { status: UserStatus.SUSPENDED });
    await mkUser(tenantA, 'muted-a', UserRole.ADMIN, tok('mutedA'), { notificationsEnabled: false });
    // Tenant B : un OWNER et un ADMIN qui portent EXACTEMENT le même token que l'ADMIN du tenant A.
    await prisma.user.update({ where: { id: ownerB.id }, data: { pushToken: tok('ownerB') } });
    await mkUser(tenantB, 'admin-b-shared', UserRole.ADMIN, t.adminA);

    // SUPER_ADMIN : destinataire e-mail de repli (compte distinct des tenants testés).
    adminToken = (await promoteToSuperAdmin(app, c.email, c.password)).accessToken;
    // Le propriétaire du tenant C devient SUPER_ADMIN : il n'a aucun token → tenant C sans destinataire push.
    await prisma.user.update({ where: { email: c.email }, data: { pushToken: null } });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    // La base est partagée avec les autres fichiers e2e : on retire nos peers (wg-stale.e2e-spec compte les siens).
    await prisma.remotePeer.deleteMany({ where: { id: { in: peerIds } } });
    await prisma.remotePeer.updateMany({ where: { id: { in: frozen } }, data: { status: RemotePeerStatus.ACTIVE } });
    await app.close();
  });

  it('push : OWNER et ADMIN actifs du bon tenant uniquement', async () => {
    global.fetch = jest.fn().mockResolvedValue(expoOk(2));
    const res = await notifications.sendPushToTenant(tenantA, 'Routeur injoignable', 'test', null, undefined, [UserRole.OWNER, UserRole.ADMIN]);
    expect(res).toMatchObject({ status: 'SENT', tokensFound: 2, accepted: 2 });
    expect(sentTokens(global.fetch as jest.Mock).sort()).toEqual([t.adminA, t.ownerA].sort());
  });

  it('push : le tenant B ne reçoit jamais les destinataires du tenant A (et inversement)', async () => {
    global.fetch = jest.fn().mockResolvedValue(expoOk(2));
    await notifications.sendPushToTenant(tenantB, 'T', 'C', null, undefined, [UserRole.OWNER, UserRole.ADMIN]);
    const sent = sentTokens(global.fetch as jest.Mock);
    expect(sent).toContain(tok('ownerB'));
    expect(sent).not.toContain(t.ownerA);
    expect(sent.filter((x) => x === t.adminA)).toHaveLength(1); // l'ADMIN de B, pas celui de A
  });

  it('invalidation DeviceNotRegistered : limitée à l utilisateur et au tenant ciblés', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: 'ok', id: 'a' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
    });
    // Ordre de findMany non garanti : on identifie le token mort par le message envoyé.
    const spy = jest.spyOn(prisma.user, 'updateMany');
    await notifications.sendPushToTenant(tenantA, 'T', 'C', null, undefined, [UserRole.OWNER, UserRole.ADMIN]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ where: { tenantId: tenantA } });
    spy.mockRestore();

    const [aOwner, aAdmin, bAdmin] = await Promise.all([
      prisma.user.findFirstOrThrow({ where: { tenantId: tenantA, role: UserRole.OWNER } }),
      prisma.user.findFirstOrThrow({ where: { tenantId: tenantA, role: UserRole.ADMIN, status: UserStatus.ACTIVE, notificationsEnabled: true } }),
      prisma.user.findFirstOrThrow({ where: { tenantId: tenantB, role: UserRole.ADMIN } }),
    ]);
    const cleared = [aOwner, aAdmin].filter((u) => u.pushToken === null);
    expect(cleared).toHaveLength(1); // exactement un token du tenant A invalidé
    expect(bAdmin.pushToken).toBe(t.adminA); // même chaîne de token, autre tenant : intacte
    // Restaure pour la suite.
    await prisma.user.update({ where: { id: aOwner.id }, data: { pushToken: t.ownerA } });
    await prisma.user.update({ where: { id: aAdmin.id }, data: { pushToken: t.adminA } });
  });

  it('aucun fournisseur (SMTP KO, tenant sans token) : épisode OPEN sans acceptation, visible dans Ops Health sans secret', async () => {
    const peer = await mkPeer(tenantC, 'undelivered');
    await freezeOtherPeers();
    sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
    global.fetch = jest.fn();

    expect((await service.check(Date.now())).alerted).toBe(1);

    const ep = await prisma.wgAlertEpisode.findFirstOrThrow({ where: { remotePeerId: peer.id } });
    expect(ep).toMatchObject({ status: 'OPEN', attemptCount: 1, providerAcceptedAt: null, tenantId: tenantC });
    expect(global.fetch).not.toHaveBeenCalled();
    expect((await prisma.remotePeer.findUniqueOrThrow({ where: { id: peer.id } })).staleAlertedAt).not.toBeNull();

    const res = await request(app.getHttpServer()).get('/api/admin/system-health').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const wg = (res.body.data ?? res.body).wgAlerts;
    expect(wg).toMatchObject({ persistence: 'DATABASE', resetOnRestart: false, deliveryProofDurable: true });
    expect(['ORANGE', 'RED']).toContain(wg.level);
    expect(wg.wgNoProviderAccepted).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(res.body)).not.toMatch(/ExponentPushToken|@e2e\.local|@example/);
  });

  it('fournisseurs qui acceptent (SMTP + Expo) : épisode PROVIDER_ACCEPTED, 1 e-mail et 2 tokens ciblés', async () => {
    const peer = await mkPeer(tenantA, 'delivered');
    await freezeOtherPeers();
    sendAlert.mockResolvedValue({ status: 'SENT' });
    global.fetch = jest.fn().mockResolvedValue(expoOk(2));

    expect((await service.check(Date.now())).alerted).toBe(1);

    const ep = await prisma.wgAlertEpisode.findFirstOrThrow({ where: { remotePeerId: peer.id } });
    expect(ep).toMatchObject({ status: 'PROVIDER_ACCEPTED', emailStatus: 'SENT', pushStatus: 'SENT', nextAttemptAt: null });
    expect(ep.providerAcceptedAt).not.toBeNull();
    expect(sendAlert).toHaveBeenCalledWith(expect.stringContaining('@e2e.local'), expect.anything(), expect.anything());
    const push = await prisma.wgAlertDeliveryAttempt.findFirstOrThrow({ where: { episodeId: ep.id, channel: 'PUSH' } });
    expect(push).toMatchObject({ status: 'PROVIDER_ACCEPTED', recipientCount: 2 });
  });
});
