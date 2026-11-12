import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RemotePeerStatus } from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import request from 'supertest';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WgStaleAlertService } from '../../src/modules/ops-health/wg-stale-alert.service';
import { WireGuardService } from '../../src/common/wireguard/wireguard.service';

/**
 * Alerte tunnel injoignable, sur Postgres réel : la migration `remote_peer_stale_tracking` est appliquée par
 * le setup, la déduplication et la résolution sont vérifiées dans la base. Cas réels : FREEDOM (handshake
 * il y a 19 j) et un peer « jamais connecté depuis 53 j ».
 */
describe('Alerte WireGuard stale (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let service: WgStaleAlertService;
  let live: Record<string, { latestHandshake: number }>;
  let healthyKey = '';
  const sendAlert = jest.fn().mockResolvedValue({ status: 'SENT' });
  const sendPush = jest.fn().mockResolvedValue({ status: 'SENT', tokensFound: 1, accepted: 1, invalid: 0 });
  const DAY = 86_400_000;
  const NOW = Date.now();
  const ids: Record<string, string> = {};
  let adminToken = '';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    service = app.get(WgStaleAlertService);
    // WireGuardService est fourni par plusieurs modules : on prend l'instance réellement injectée dans le service.
    const wg = (service as unknown as { wg: WireGuardService }).wg;
    jest.spyOn(wg, 'enabled', 'get').mockReturnValue(true);
    jest.spyOn(wg, 'livePeers').mockImplementation(async () => live as never);
    // Le harnais de test remplace MailService par un stub sans `sendAlert` : on branche les canaux directement.
    Object.assign(service, { mail: { sendAlert }, notifications: { sendPushToTenant: sendPush }, config: { get: () => 'ops@e2e.local' } });

    const stamp = Date.now();
    const owner = await signupUser(app, { tenantName: 'WG stale', email: `wgs-${stamp}@e2e.local` });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    adminToken = (await promoteToSuperAdmin(app, owner.email, owner.password)).accessToken;
    let n = 0;
    const mk = async (key: string, alias: string, provisionedDaysAgo: number, lastHandshakeDaysAgo: number | null) => {
      n++;
      const router = await prisma.router.create({ data: { tenantId: user.tenantId, identity: `${key}-${stamp}`, alias } });
      const peer = await prisma.remotePeer.create({
        data: {
          routerId: router.id,
          tenantId: user.tenantId,
          wgPublicKey: `pk-${key}-${stamp}`,
          wgIp: `10.99.${n}.${n}`,
          allocatedPort: 30000 + n + (stamp % 1000),
          serverPublicKey: 'srv',
          endpoint: 'vps:51820',
          status: RemotePeerStatus.ACTIVE,
          provisionedAt: new Date(NOW - provisionedDaysAgo * DAY),
          lastHandshakeAt: lastHandshakeDaysAgo === null ? null : new Date(NOW - lastHandshakeDaysAgo * DAY),
        },
      });
      ids[key] = peer.id;
      return `pk-${key}-${stamp}`;
    };
    const kFreedom = await mk('freedom', 'FREEDOM', 60, 19);
    const kNever = await mk('never', 'JAMAIS', 53, null);
    const kHealthy = await mk('healthy', 'SAIN', 60, 0);
    healthyKey = kHealthy;
    live = { [kHealthy]: { latestHandshake: Math.floor((NOW - 30_000) / 1000) } };
    void kFreedom;
    void kNever;
  });

  afterAll(async () => {
    await app.close();
  });

  const row = (key: string) => prisma.remotePeer.findUniqueOrThrow({ where: { id: ids[key] } });

  it('alerte FREEDOM (19 j) et le peer jamais connecté (53 j), pas le peer sain', async () => {
    const out = await service.check(NOW);
    expect(out.alerted).toBe(2);
    expect((await row('freedom')).staleAlertedAt).not.toBeNull();
    expect((await row('never')).staleAlertedAt).not.toBeNull();
    expect((await row('healthy')).staleAlertedAt).toBeNull();
    expect((await row('healthy')).lastHandshakeAt!.getTime()).toBeGreaterThan(NOW - 120_000);
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(sendPush).toHaveBeenCalledTimes(2);
  });

  it('déduplication : un second passage dans l’heure n’envoie rien', async () => {
    sendAlert.mockClear();
    sendPush.mockClear();
    expect((await service.check(NOW + 3_600_000)).alerted).toBe(0);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('pas de rappel tant que l’épisode est accepté par un fournisseur (un épisode = une alerte, résolution au handshake)', async () => {
    sendAlert.mockClear();
    live[healthyKey] = { latestHandshake: Math.floor((NOW + DAY - 30_000) / 1000) }; // le peer sain reste sain
    expect((await service.check(NOW + DAY)).alerted).toBe(0);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(await prisma.wgAlertEpisode.count({ where: { remotePeerId: { in: [ids.freedom, ids.never] }, status: 'PROVIDER_ACCEPTED' } })).toBe(2);
  });

  it('résolution automatique au handshake : épisode clos dans la base', async () => {
    const hs = Math.floor((NOW + DAY) / 1000);
    const key = (await row('freedom')).wgPublicKey;
    live[key] = { latestHandshake: hs };
    const out = await service.check(NOW + DAY + 60_000);
    expect(out.resolved).toBe(1);
    const freedom = await row('freedom');
    expect(freedom.staleAlertedAt).toBeNull();
    expect(freedom.lastHandshakeAt!.getTime()).toBe(hs * 1000);
  });

  describe('affichage dans la liste admin des peers (onglets Fleet)', () => {
    const list = async (qs: string) => {
      const res = await request(app.getHttpServer()).get(`/api/admin/wireguard/peers${qs}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      return res.body.data as { items: { id: string; staleness: string; inactiveSince: string | null }[]; summary: { stale24h: number; neverConnected: number } };
    };

    it('un peer STALE_24H apparaît dans son onglet, et seulement dans celui-ci', async () => {
      // FREEDOM est de nouveau « résolu » à la fin des tests précédents : on le remet muet depuis 19 j.
      // WireGuardService est partagé avec le service admin : on retire le handshake simulé par le test précédent.
      delete live[(await row('freedom')).wgPublicKey];
      await prisma.remotePeer.update({ where: { id: ids.freedom }, data: { lastHandshakeAt: new Date(NOW - 19 * DAY), staleAlertedAt: null } });
      const stale = await list('?staleness=STALE_24H');
      expect(stale.items.map((i) => i.id)).toEqual([ids.freedom]);
      expect(stale.items[0].staleness).toBe('STALE_24H');
      expect(new Date(stale.items[0].inactiveSince as string).getTime()).toBe(NOW - 19 * DAY);
      expect(stale.summary.stale24h).toBeGreaterThanOrEqual(1);
    });

    it('un peer NEVER_CONNECTED apparaît dans son onglet', async () => {
      const never = await list('?staleness=NEVER_CONNECTED');
      expect(never.items.map((i) => i.id)).toContain(ids.never);
      expect(never.items.every((i) => i.staleness === 'NEVER_CONNECTED')).toBe(true);
      expect(never.summary.neverConnected).toBeGreaterThanOrEqual(1);
    });

    it('le peer sain n’apparaît dans aucun des deux onglets et vaut OK', async () => {
      const all = await list('');
      const healthy = all.items.find((i) => i.id === ids.healthy);
      expect(healthy).toMatchObject({ staleness: 'OK', inactiveSince: null });
    });
  });
});
