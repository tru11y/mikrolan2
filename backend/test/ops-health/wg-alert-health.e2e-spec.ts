import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RemotePeerStatus } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from '../helpers/app.helper';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OpsHealthController } from '../../src/modules/ops-health/ops-health.controller';
import { WgStaleAlertService } from '../../src/modules/ops-health/wg-stale-alert.service';
import { WgAlertDeliveryRegistry } from '../../src/modules/ops-health/wg-alert-delivery';
import { WireGuardService } from '../../src/common/wireguard/wireguard.service';

/**
 * Contrat de la réponse GET /admin/system-health (bloc `wgAlerts`) au fil de la vie du processus :
 * démarrage, scan sans incident, alerte acceptée, alerte non acceptée, redémarrage avec `staleAlertedAt`.
 * Canaux simulés : aucun envoi réel, aucun token réel.
 */
describe('Ops Health — wgAlerts (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let service: WgStaleAlertService;
  let controller: OpsHealthController;
  let adminToken = '';
  let tenantId = '';
  const sendAlert = jest.fn();
  const sendPush = jest.fn();
  const DAY = 86_400_000;
  const stamp = Date.now();
  const mineIds: string[] = [];
  let frozenIds: string[] = [];

  const health = async () => {
    const res = await request(app.getHttpServer()).get('/api/admin/system-health').set('Authorization', `Bearer ${adminToken}`).expect(200);
    return (res.body.data ?? res.body).wgAlerts as Record<string, unknown>;
  };

  const mkPeer = async (tag: string, over: Record<string, unknown> = {}) => {
    const router = await prisma.router.create({ data: { tenantId, identity: `${tag}-${stamp}`, alias: tag } });
    const n = mineIds.length + 1;
    const peer = await prisma.remotePeer.create({
      data: {
        routerId: router.id,
        tenantId,
        wgPublicKey: `pk-${tag}-${stamp}`,
        wgIp: `10.97.${n}.${n}`,
        allocatedPort: 32000 + n + (stamp % 1000),
        serverPublicKey: 'srv',
        endpoint: 'vps:51820',
        status: RemotePeerStatus.ACTIVE,
        provisionedAt: new Date(stamp - 60 * DAY),
        lastHandshakeAt: new Date(stamp - 19 * DAY),
        ...over,
      },
    });
    mineIds.push(peer.id);
    return peer;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    service = app.get(WgStaleAlertService);
    controller = app.get(OpsHealthController);
    const wg = (service as unknown as { wg: WireGuardService }).wg;
    jest.spyOn(wg, 'enabled', 'get').mockReturnValue(true);
    jest.spyOn(wg, 'livePeers').mockResolvedValue({} as never);
    Object.assign(service, { mail: { sendAlert }, notifications: { sendPushToTenant: sendPush }, config: { get: () => 'ops@e2e.local' } });

    const owner = await signupUser(app, { tenantName: 'WG health', email: `wgh-${stamp}@e2e.local` });
    tenantId = (await prisma.user.findUniqueOrThrow({ where: { email: owner.email } })).tenantId;
    adminToken = (await promoteToSuperAdmin(app, owner.email, owner.password)).accessToken;

    // La base est partagée : on écarte temporairement les peers des autres fichiers (restaurés en afterAll).
    frozenIds = (await prisma.remotePeer.findMany({ where: { status: RemotePeerStatus.ACTIVE }, select: { id: true } })).map((p) => p.id);
    await prisma.remotePeer.updateMany({ where: { id: { in: frozenIds } }, data: { status: RemotePeerStatus.REVOKED } });
  });

  afterAll(async () => {
    await prisma.remotePeer.deleteMany({ where: { id: { in: mineIds } } });
    await prisma.remotePeer.updateMany({ where: { id: { in: frozenIds } }, data: { status: RemotePeerStatus.ACTIVE } });
    await app.close();
  });

  it('A. démarrage : MEMORY_ONLY, non durable, scan en attente, ORANGE', async () => {
    expect(await health()).toMatchObject({
      persistence: 'MEMORY_ONLY',
      resetOnRestart: true,
      deliveryProofDurable: false,
      wgDeliveryProofDurable: false,
      scanPending: true,
      level: 'ORANGE',
    });
  });

  it('B. scan sans incident : scanPending=false, GREEN', async () => {
    expect((await service.check(Date.now())).alerted).toBe(0);
    expect(await health()).toMatchObject({ scanPending: false, level: 'GREEN', wgAlertsCreated: 0, wgUnknownDeliveryAfterRestart: 0 });
  });

  it('C. incident accepté par un fournisseur : métriques d acceptation, niveau GREEN', async () => {
    await mkPeer('accepted');
    sendAlert.mockResolvedValue({ status: 'SENT' });
    sendPush.mockResolvedValue({ status: 'NO_TOKEN', tokensFound: 0, accepted: 0, invalid: 0 });
    expect((await service.check(Date.now())).alerted).toBe(1);
    expect(await health()).toMatchObject({ level: 'GREEN', wgAlertsCreated: 1, wgEmailProviderAccepted: 1, wgPushProviderAccepted: 0, wgNoProviderAccepted: 0 });
  });

  it('D. incident sans fournisseur : RED, codes d échec visibles sans secret', async () => {
    await mkPeer('refused');
    sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
    sendPush.mockResolvedValue({ status: 'FAILED', tokensFound: 1, accepted: 0, invalid: 0, failureCode: 'HTTP_500' });
    expect((await service.check(Date.now())).alerted).toBe(1);
    // Seuils : ORANGE après 15 min, RED après 1 h sans acceptation -> on lit la réponse 2 h plus tard.
    expect(await health()).toMatchObject({ level: 'GREEN', wgNoProviderAccepted: 1 });
    const real = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(real + 2 * 3_600_000);
    let h: Record<string, unknown>;
    try {
      // Le JWT (15 min) expirerait avec l'horloge décalée : on lit le même contrôleur sans passer par HTTP.
      h = (await controller.get()).wgAlerts as unknown as Record<string, unknown>;
    } finally {
      spy.mockRestore();
    }
    expect(h).toMatchObject({ level: 'RED', wgNoProviderAccepted: 1, wgProviderFailures: 2, wgOpenNoProviderAcceptedOver1h: 1 });
    expect(h.recentFailureCodes).toEqual(expect.arrayContaining(['SMTP_ERROR', 'HTTP_500']));
    expect(JSON.stringify(h)).not.toMatch(/@|ExponentPushToken|pk-|refused|accepted-/);
  });

  it('E. redémarrage simulé avec staleAlertedAt : UNKNOWN_DELIVERY, ORANGE, aucune fausse acceptation, aucun nouvel envoi', async () => {
    const fresh = new WgAlertDeliveryRegistry();
    (service as unknown as { deliveries: WgAlertDeliveryRegistry }).deliveries = fresh;
    (controller as unknown as { wgAlerts: WgAlertDeliveryRegistry }).wgAlerts = fresh;
    sendAlert.mockClear();
    sendPush.mockClear();

    await service.check(Date.now()); // les deux peers portent staleAlertedAt
    expect(sendAlert).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
    expect(await health()).toMatchObject({
      level: 'ORANGE',
      wgUnknownDeliveryAfterRestart: 2,
      message: 'livraison inconnue après redémarrage',
      wgEmailProviderAccepted: 0,
      wgPushProviderAccepted: 0,
      wgAlertsCreated: 0,
    });
  });
});
