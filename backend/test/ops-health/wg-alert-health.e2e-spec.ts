import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RemotePeerStatus } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from '../helpers/app.helper';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WgAlertHealthService } from '../../src/modules/ops-health/wg-alert-health';
import { WgStaleAlertService } from '../../src/modules/ops-health/wg-stale-alert.service';
import { WireGuardService } from '../../src/common/wireguard/wireguard.service';

/**
 * GET /admin/system-health (bloc `wgAlerts`) basé sur la base : niveaux, métriques d'acceptation fournisseur,
 * ancien `staleAlertedAt` sans épisode (9 peers dont 2 incidents), redémarrage sans perte.
 * Canaux simulés : aucun envoi réel, aucun token réel.
 */
describe('Ops Health — wgAlerts durables (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let service: WgStaleAlertService;
  let health: WgAlertHealthService;
  let adminToken = '';
  let tenantId = '';
  const sendAlert = jest.fn();
  const sendPush = jest.fn();
  const DAY = 86_400_000;
  const H = 3_600_000;
  const stamp = Date.now();
  const NOW = stamp;
  const mine: string[] = [];
  let frozen: string[] = [];

  const othersKeys = [...Array.from({ length: 7 }, (_, i) => `pk-ok${i}-${stamp}`), `pk-legacy1-${stamp}`, `pk-legacy2-${stamp}`];
  /** Passe du cron à l'instant t, les 9 autres peers étant sains (handshake frais) : seul le peer testé reste muet. */
  const checkAt = (t: number, extra: Record<string, { latestHandshake: number }> = {}) => {
    const wg = (service as unknown as { wg: WireGuardService }).wg;
    (wg.livePeers as jest.Mock).mockResolvedValue({
      ...Object.fromEntries(othersKeys.map((k) => [k, { latestHandshake: Math.floor(t / 1000) }])),
      ...extra,
    });
    return service.check(t);
  };

  const http = async () => {
    const res = await request(app.getHttpServer()).get('/api/admin/system-health').set('Authorization', `Bearer ${adminToken}`).expect(200);
    return (res.body.data ?? res.body).wgAlerts as Record<string, unknown>;
  };

  const mkPeer = async (tag: string, over: Record<string, unknown> = {}) => {
    const router = await prisma.router.create({ data: { tenantId, identity: `${tag}-${stamp}`, alias: tag } });
    const n = mine.length + 1;
    const peer = await prisma.remotePeer.create({
      data: {
        routerId: router.id,
        tenantId,
        wgPublicKey: `pk-${tag}-${stamp}`,
        wgIp: `10.95.${n}.${n}`,
        allocatedPort: 34000 + n + (stamp % 1000),
        serverPublicKey: 'srv',
        endpoint: 'vps:51820',
        status: RemotePeerStatus.ACTIVE,
        provisionedAt: new Date(NOW - 60 * DAY),
        lastHandshakeAt: new Date(NOW - 19 * DAY),
        ...over,
      },
    });
    mine.push(peer.id);
    return peer;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    service = app.get(WgStaleAlertService);
    health = app.get(WgAlertHealthService);
    const wg = (service as unknown as { wg: WireGuardService }).wg;
    jest.spyOn(wg, 'enabled', 'get').mockReturnValue(true);
    jest.spyOn(wg, 'livePeers').mockResolvedValue({} as never);
    Object.assign(service, { mail: { sendAlert }, notifications: { sendPushToTenant: sendPush }, config: { get: () => 'ops@e2e.local' } });

    const owner = await signupUser(app, { tenantName: 'WG health', email: `wgh-${stamp}@e2e.local` });
    tenantId = (await prisma.user.findUniqueOrThrow({ where: { email: owner.email } })).tenantId;
    adminToken = (await promoteToSuperAdmin(app, owner.email, owner.password)).accessToken;

    frozen = (await prisma.remotePeer.findMany({ where: { status: RemotePeerStatus.ACTIVE }, select: { id: true } })).map((p) => p.id);
    await prisma.remotePeer.updateMany({ where: { id: { in: frozen } }, data: { status: RemotePeerStatus.REVOKED } });
    await prisma.wgAlertEpisode.deleteMany({});
  });

  afterAll(async () => {
    await prisma.remotePeer.deleteMany({ where: { id: { in: mine } } });
    await prisma.remotePeer.updateMany({ where: { id: { in: frozen } }, data: { status: RemotePeerStatus.ACTIVE } });
    await app.close();
  });

  it('A. aucun incident : GREEN, métadonnées DATABASE / durable', async () => {
    expect(await http()).toMatchObject({
      level: 'GREEN',
      persistence: 'DATABASE',
      resetOnRestart: false,
      deliveryProofDurable: true,
      wgAlertEpisodesOpen: 0,
      wgAlertEpisodesExhausted: 0,
      wgAcceptanceUnknownLegacy: 0,
      wgOldestOpenAgeMs: null,
    });
  });

  it('B. 9 peers dont 2 anciens incidents : acceptation inconnue, jamais présumée, 2 épisodes legacy rejoués une seule fois', async () => {
    for (let i = 0; i < 7; i++) await mkPeer(`ok${i}`, { lastHandshakeAt: new Date(NOW - 20_000) });
    const old = new Date(NOW - 5 * H);
    await mkPeer('legacy1', { staleAlertedAt: old });
    await mkPeer('legacy2', { staleAlertedAt: old });
    sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
    sendPush.mockResolvedValue({ status: 'NO_TOKEN', tokensFound: 0, accepted: 0, invalid: 0 });

    expect(await health.snapshot(NOW)).toMatchObject({ level: 'ORANGE', wgAcceptanceUnknownLegacy: 2, wgAlertEpisodesProviderAccepted: 0 });

    expect((await service.check(NOW)).alerted).toBe(2);
    const eps = await prisma.wgAlertEpisode.findMany({ where: { remotePeerId: { in: mine } } });
    expect(eps).toHaveLength(2);
    for (const e of eps) {
      expect(e).toMatchObject({ legacy: true, failureCode: 'LEGACY_ACCEPTANCE_UNKNOWN', status: 'OPEN', providerAcceptedAt: null, attemptCount: 1 });
      expect(e.detectedAt.getTime()).toBe(NOW - 5 * H);
    }
    await service.check(NOW + 60_000); // idempotent : ni nouvel épisode ni nouvel envoi
    expect(await prisma.wgAlertEpisode.count({ where: { remotePeerId: { in: mine } } })).toBe(2);
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(await health.snapshot(NOW + 60_000)).toMatchObject({ wgAcceptanceUnknownLegacy: 0, wgAlertEpisodesOpen: 2, wgAlertEpisodesProviderAccepted: 0 });
  });

  it('C. épisode OPEN sans acceptation : ORANGE immédiat (retry programmé), RED au-delà d’une heure, HTTP = même contrat', async () => {
    await prisma.wgAlertEpisode.deleteMany({});
    await prisma.remotePeer.updateMany({ where: { id: { in: mine } }, data: { staleAlertedAt: null, lastHandshakeAt: new Date(NOW + 10 * 60_000) } });
    await mkPeer('fresh');
    const t = NOW + 10 * 60_000;
    await service.check(t);
    const snap = await health.snapshot(t);
    expect(snap).toMatchObject({ level: 'ORANGE', wgAlertEpisodesOpen: 1, wgRetryScheduled: 1, wgRetryDue: 0, wgNoProviderAccepted: 1, wgNoRecipient: 0 });
    expect(snap.wgProviderFailures).toBe(1);
    expect((await health.snapshot(t + 2 * H)).level).toBe('RED');
    expect(['ORANGE', 'RED']).toContain((await http()).level);
  });

  it('D. tentatives épuisées : RED, EXHAUSTED visible, plus aucune relance', async () => {
    const t = NOW + 10 * 60_000;
    await checkAt(t + H);
    await checkAt(t + 7 * H);
    const snap = await health.snapshot(t + 8 * H);
    expect(snap).toMatchObject({ level: 'RED', wgAlertEpisodesExhausted: 1, wgAlertEpisodesOpen: 0, wgRetryScheduled: 0, message: 'tentatives épuisées sans fournisseur accepté' });
    sendAlert.mockClear();
    await checkAt(t + 30 * H);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('E. redémarrage simulé : nouvelles instances, même état en base, aucune perte, aucun nouvel envoi, jamais GREEN', async () => {
    const t = NOW + 10 * 60_000 + 40 * H;
    const before = await health.snapshot(t);
    const after = await new WgAlertHealthService(prisma).snapshot(t);
    expect(after).toEqual(before);
    expect(after.level).toBe('RED');
    sendAlert.mockClear();
    sendPush.mockClear();
    await checkAt(t);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('F. fournisseur accepté : épisode PROVIDER_ACCEPTED, métriques e-mail, niveau GREEN', async () => {
    await prisma.wgAlertEpisode.deleteMany({});
    await prisma.remotePeer.updateMany({ where: { id: { in: mine } }, data: { staleAlertedAt: null, lastHandshakeAt: new Date(NOW + 90 * H) } });
    await mkPeer('accepted');
    sendAlert.mockResolvedValue({ status: 'SENT' });
    const t = NOW + 90 * H + 60_000;
    await service.check(t);
    const snap = await health.snapshot(t);
    expect(snap).toMatchObject({ level: 'GREEN', wgAlertEpisodesProviderAccepted: 1, wgEmailProviderAccepted: 1, wgNoProviderAccepted: 0, message: null });
    expect(JSON.stringify(snap)).not.toMatch(/@|ExponentPushToken|pk-/);
  });

  it('G. résolution : épisode clos compté en Resolved24h, retour GREEN', async () => {
    const t = NOW + 91 * H;
    expect((await checkAt(t, { [`pk-accepted-${stamp}`]: { latestHandshake: Math.floor(t / 1000) } })).resolved).toBe(1);
    expect(await health.snapshot(t)).toMatchObject({ level: 'GREEN', wgAlertEpisodesProviderAccepted: 0, wgAlertEpisodesResolved24h: 1 });
  });
});
