import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Prisma, RemotePeerStatus } from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import { signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WgStaleAlertService } from '../../src/modules/ops-health/wg-stale-alert.service';
import { WireGuardService } from '../../src/common/wireguard/wireguard.service';

/**
 * Épisodes d'alerte WireGuard sur PostgreSQL réel : création, index unique partiel contre les courses, claim,
 * planning des retries (horloge contrôlée), résolution, nouvel épisode, isolation des tenants, absence de secret.
 * Canaux simulés : aucun envoi réel, aucun token réel.
 */
describe('Épisodes d’alerte WireGuard (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let service: WgStaleAlertService;
  let live: Record<string, { latestHandshake: number }> = {};
  const sendAlert = jest.fn();
  const sendPush = jest.fn();
  const H = 3_600_000;
  const stamp = Date.now();
  const NOW = stamp;
  const mine: string[] = [];
  let frozen: string[] = [];
  const tenants: Record<string, string> = {};
  const peers: Record<string, { id: string; key: string; tenantId: string }> = {};

  const mkPeer = async (tag: string, tenantKey: string, over: Record<string, unknown> = {}) => {
    const tenantId = tenants[tenantKey];
    const router = await prisma.router.create({ data: { tenantId, identity: `${tag}-${stamp}`, alias: `ALIAS-${tag}` } });
    const n = mine.length + 1;
    const key = `pk-${tag}-${stamp}`;
    const peer = await prisma.remotePeer.create({
      data: {
        routerId: router.id,
        tenantId,
        wgPublicKey: key,
        wgIp: `10.96.${n}.${n}`,
        allocatedPort: 33000 + n + (stamp % 1000),
        serverPublicKey: 'srv',
        endpoint: 'vps:51820',
        status: RemotePeerStatus.ACTIVE,
        provisionedAt: new Date(NOW - 60 * 86_400_000),
        lastHandshakeAt: new Date(NOW - 19 * 86_400_000),
        ...over,
      },
    });
    mine.push(peer.id);
    peers[tag] = { id: peer.id, key, tenantId };
    return peer;
  };

  const episodesOf = (tag: string) => prisma.wgAlertEpisode.findMany({ where: { remotePeerId: peers[tag].id }, orderBy: { createdAt: 'asc' } });
  const failProviders = () => {
    sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
    sendPush.mockResolvedValue({ status: 'NO_TOKEN', tokensFound: 0, accepted: 0, invalid: 0 });
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    service = app.get(WgStaleAlertService);
    const wg = (service as unknown as { wg: WireGuardService }).wg;
    jest.spyOn(wg, 'enabled', 'get').mockReturnValue(true);
    jest.spyOn(wg, 'livePeers').mockImplementation(async () => live as never);
    Object.assign(service, { mail: { sendAlert }, notifications: { sendPushToTenant: sendPush }, config: { get: () => 'ops@e2e.local' } });

    for (const k of ['A', 'B', 'C']) {
      const u = await signupUser(app, { tenantName: `Episode ${k}`, email: `ep-${k.toLowerCase()}-${stamp}@e2e.local` });
      tenants[k] = (await prisma.user.findUniqueOrThrow({ where: { email: u.email } })).tenantId;
    }
    frozen = (await prisma.remotePeer.findMany({ where: { status: RemotePeerStatus.ACTIVE }, select: { id: true } })).map((p) => p.id);
    await prisma.remotePeer.updateMany({ where: { id: { in: frozen } }, data: { status: RemotePeerStatus.REVOKED } });
    failProviders();
  });

  afterAll(async () => {
    await prisma.remotePeer.deleteMany({ where: { id: { in: mine } } }); // cascade sur les épisodes et tentatives
    await prisma.remotePeer.updateMany({ where: { id: { in: frozen } }, data: { status: RemotePeerStatus.ACTIVE } });
    await app.close();
  });

  it('peer éligible : épisode OPEN créé, première tentative immédiate ; l’autre tenant a son propre épisode', async () => {
    await mkPeer('a1', 'A');
    await mkPeer('b1', 'B');
    await mkPeer('healthy', 'A', { lastHandshakeAt: new Date(NOW - 30_000) });
    live = {};
    expect((await service.check(NOW)).alerted).toBe(2);

    const [a] = await episodesOf('a1');
    const [b] = await episodesOf('b1');
    expect(a).toMatchObject({ tenantId: tenants.A, status: 'OPEN', attemptCount: 1, alertType: 'STALE_24H', providerAcceptedAt: null, legacy: false });
    expect(b).toMatchObject({ tenantId: tenants.B, attemptCount: 1 });
    expect(a.nextAttemptAt?.getTime()).toBe(NOW + H);
    expect(await episodesOf('healthy')).toHaveLength(0);
    const pushedTenants = sendPush.mock.calls.map((c) => c[0]).sort();
    expect(pushedTenants).toEqual([tenants.A, tenants.B].sort());
    const attempts = await prisma.wgAlertDeliveryAttempt.findMany({ where: { episodeId: a.id }, orderBy: { channel: 'asc' } });
    expect(attempts.map((x) => `${x.channel}:${x.status}:${x.attemptNumber}`)).toEqual(['EMAIL:PROVIDER_FAILED:1', 'PUSH:NO_TOKEN:1']);
  });

  it('deux déclenchements concurrents : un seul épisode et une seule tentative (index unique partiel + claim)', async () => {
    await mkPeer('c1', 'C');
    sendPush.mockClear();
    await Promise.all([service.check(NOW + 10_000), service.check(NOW + 10_000)]);
    const eps = await episodesOf('c1');
    expect(eps).toHaveLength(1);
    expect(eps[0].attemptCount).toBe(1);
    expect(await prisma.wgAlertDeliveryAttempt.count({ where: { episodeId: eps[0].id } })).toBe(2);
    expect(sendPush.mock.calls.filter((c) => c[0] === tenants.C)).toHaveLength(1);
  });

  it('PostgreSQL refuse un second épisode non résolu, accepte un nouveau après résolution, refuse une tentative en double', async () => {
    const [a] = await episodesOf('a1');
    const dup = prisma.wgAlertEpisode.create({ data: { remotePeerId: peers.a1.id, tenantId: tenants.A, alertType: 'STALE_24H', detectedAt: new Date(NOW) } });
    await expect(dup).rejects.toMatchObject({ code: 'P2002' });
    await expect(dup).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    await expect(
      prisma.wgAlertDeliveryAttempt.create({ data: { episodeId: a.id, channel: 'EMAIL', attemptNumber: 1, status: 'PROVIDER_FAILED', attemptedAt: new Date(NOW) } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('retries sur horloge contrôlée : rien avant +1 h, tentative 2 à +1 h, tentative 3 à +7 h, puis EXHAUSTED sans relance', async () => {
    await service.check(NOW + 30 * 60_000);
    expect((await episodesOf('a1'))[0].attemptCount).toBe(1); // rien avant nextAttemptAt

    await service.check(NOW + H);
    let [a] = await episodesOf('a1');
    expect(a).toMatchObject({ attemptCount: 2, status: 'OPEN' });
    expect(a.nextAttemptAt?.getTime()).toBe(NOW + H + 6 * H);

    await service.check(NOW + 6 * H);
    expect((await episodesOf('a1'))[0].attemptCount).toBe(2);

    await service.check(NOW + 7 * H);
    [a] = await episodesOf('a1');
    expect(a).toMatchObject({ attemptCount: 3, status: 'EXHAUSTED', nextAttemptAt: null });
    expect(await prisma.wgAlertDeliveryAttempt.count({ where: { episodeId: a.id } })).toBe(6);

    await service.check(NOW + 48 * H);
    await service.check(NOW + 96 * H);
    const exhausted = (await episodesOf('a1'))[0];
    expect(exhausted).toMatchObject({ status: 'EXHAUSTED', attemptCount: 3 }); // jamais de 4e tentative
    expect(await prisma.wgAlertDeliveryAttempt.count({ where: { episodeId: exhausted.id } })).toBe(6);
  });

  it('acceptation par un fournisseur : PROVIDER_ACCEPTED, jamais relancé', async () => {
    sendAlert.mockResolvedValue({ status: 'SENT' });
    await mkPeer('acc', 'B');
    await service.check(NOW + 60 * H);
    const [e] = await episodesOf('acc');
    expect(e).toMatchObject({ status: 'PROVIDER_ACCEPTED', attemptCount: 1, nextAttemptAt: null });
    expect(e.providerAcceptedAt).not.toBeNull();
    await service.check(NOW + 100 * H);
    expect((await episodesOf('acc'))[0]).toMatchObject({ status: 'PROVIDER_ACCEPTED', attemptCount: 1 });
    failProviders();
  });

  it('résolution par handshake puis nouvel épisode après nouvelle inactivité', async () => {
    const before = (await episodesOf('a1'))[0];
    live = { [peers.a1.key]: { latestHandshake: Math.floor((NOW + 120 * H) / 1000) } };
    const out = await service.check(NOW + 120 * H + 60_000);
    expect(out.resolved).toBeGreaterThanOrEqual(1);
    const resolved = (await episodesOf('a1'))[0];
    expect(resolved).toMatchObject({ id: before.id, status: 'RESOLVED', nextAttemptAt: null });
    expect(resolved.resolvedAt).not.toBeNull();
    expect((await prisma.remotePeer.findUniqueOrThrow({ where: { id: peers.a1.id } })).staleAlertedAt).toBeNull();

    await service.check(NOW + 125 * H);
    expect(await episodesOf('a1')).toHaveLength(1); // aucun retry ni nouvel épisode après résolution

    live = {};
    await service.check(NOW + 120 * H + 60_000 + 25 * H);
    const eps = await episodesOf('a1');
    expect(eps).toHaveLength(2);
    expect(eps[1]).toMatchObject({ status: 'OPEN', attemptCount: 1, legacy: false });
    expect(eps[1].id).not.toBe(before.id);
    expect(eps[0].status).toBe('RESOLVED');
  });

  it('rappels quotidiens : rien avant 24 h, un seul rappel logique à 24 h, un seul sous concurrence, jamais de doublon en base', async () => {
    sendAlert.mockResolvedValue({ status: 'SENT' });
    sendPush.mockResolvedValue({ status: 'NO_TOKEN', tokensFound: 0, accepted: 0, invalid: 0 });
    await mkPeer('rem', 'B');
    const R = NOW + 200 * H;
    await service.check(R);
    let [e] = await episodesOf('rem');
    expect(e).toMatchObject({ status: 'PROVIDER_ACCEPTED', reminderCount: 0 });
    expect(e.nextReminderAt?.getTime()).toBe(R + 24 * H);

    await service.check(R + 23 * H);
    expect((await episodesOf('rem'))[0].reminderCount).toBe(0);

    await service.check(R + 24 * H);
    [e] = await episodesOf('rem');
    expect(e).toMatchObject({ reminderCount: 1, status: 'PROVIDER_ACCEPTED' });
    expect(e.nextReminderAt?.getTime()).toBe(R + 48 * H);
    const rows = await prisma.wgAlertDeliveryAttempt.findMany({ where: { episodeId: e.id, kind: 'REMINDER' } });
    expect(rows.map((r) => `${r.channel}:${r.reminderNumber}`).sort()).toEqual(['EMAIL:1', 'PUSH:1']);

    await Promise.all([service.check(R + 48 * H), service.check(R + 48 * H)]);
    [e] = await episodesOf('rem');
    expect(e.reminderCount).toBe(2);
    expect(await prisma.wgAlertDeliveryAttempt.count({ where: { episodeId: e.id, kind: 'REMINDER', reminderNumber: 2 } })).toBe(2);

    // PostgreSQL refuse un second rappel pour le même (épisode, canal, numéro).
    await expect(
      prisma.wgAlertDeliveryAttempt.create({
        data: { episodeId: e.id, channel: 'EMAIL', attemptNumber: 99, kind: 'REMINDER', reminderNumber: 1, status: 'PROVIDER_ACCEPTED', attemptedAt: new Date(R) },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('limite de 7 rappels : aucun huitième, épisode toujours actif ; tunnel sain : RESOLVED sans rappel', async () => {
    const R = NOW + 200 * H;
    for (let k = 3; k <= 12; k++) await service.check(R + k * 24 * H);
    let [e] = await episodesOf('rem');
    expect(e).toMatchObject({ status: 'PROVIDER_ACCEPTED', reminderCount: 7, nextReminderAt: null, resolvedAt: null });
    expect(await prisma.wgAlertDeliveryAttempt.count({ where: { episodeId: e.id, kind: 'REMINDER' } })).toBe(14);

    live = { [peers.rem.key]: { latestHandshake: Math.floor((R + 13 * 24 * H) / 1000) } };
    await service.check(R + 13 * 24 * H + 60_000);
    [e] = await episodesOf('rem');
    expect(e).toMatchObject({ status: 'RESOLVED', nextReminderAt: null });
    expect(await prisma.wgAlertDeliveryAttempt.count({ where: { episodeId: e.id, kind: 'REMINDER' } })).toBe(14);
    live = {};
  });

  it('valeurs persistées fermées : un statut inconnu est refusé par PostgreSQL / Prisma', async () => {
    const [e] = await episodesOf('b1');
    await expect(prisma.wgAlertEpisode.update({ where: { id: e.id }, data: { emailStatus: 'DELIVERED_TO_HUMAN' as never } })).rejects.toThrow();
    await expect(prisma.wgAlertEpisode.update({ where: { id: e.id }, data: { pushStatus: 'whatever' as never } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "WgAlertEpisode" SET "emailStatus" = 'BOGUS' WHERE id = '${e.id}'`)).rejects.toThrow();
  });

  it('aucune donnée sensible en base (adresse, token, alias, IP, clé, message)', async () => {
    const eps = await prisma.wgAlertEpisode.findMany({ where: { remotePeerId: { in: mine } } });
    const attempts = await prisma.wgAlertDeliveryAttempt.findMany({ where: { episodeId: { in: eps.map((e) => e.id) } } });
    const dump = JSON.stringify([eps, attempts]);
    expect(dump).not.toMatch(/@|ExponentPushToken|ALIAS-|pk-|10\.96\.|vps:51820|injoignable|handshake/i);
  });
});
