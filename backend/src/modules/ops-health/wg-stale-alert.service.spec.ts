import { WgStaleAlertService } from './wg-stale-alert.service';
import { WgAlertEpisodeService, WG_ALERT_CLAIM_TTL_MS } from './wg-alert-episode.service';
import { deliveryEntityRef } from './wg-alert-delivery';
import { FakeWgAlertPrisma } from '../../../test/helpers/fake-wg-alert-prisma';

jest.mock('@sentry/node', () => ({ captureMessage: jest.fn(), captureException: jest.fn(), addBreadcrumb: jest.fn() }));

const Sentry = jest.requireMock('@sentry/node') as { captureMessage: jest.Mock; addBreadcrumb: jest.Mock };
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const H = 3_600_000;
const MIN = 60_000;
const OLD = new Date(T0 - 30 * H);

const PUSH_OK = { status: 'SENT', tokensFound: 1, accepted: 1, invalid: 0 };
const PUSH_NO_TOKEN = { status: 'NO_TOKEN', tokensFound: 0, accepted: 0, invalid: 0 };
const PUSH_FAIL = { status: 'FAILED', tokensFound: 1, accepted: 0, invalid: 0, failureCode: 'HTTP_500' };
const MAIL_OK = { status: 'SENT' };
const MAIL_FAIL = { status: 'FAILED', failureCode: 'SMTP_ERROR' };

interface Opts {
  alertEmail?: string;
  superAdmins?: Array<{ email: string }>;
  live?: Record<string, { latestHandshake: number }>;
  mail?: unknown;
  push?: unknown;
}

function setup(o: Opts = {}) {
  const db = new FakeWgAlertPrisma();
  db.superAdmins = o.superAdmins ?? [];
  db.addPeer({ id: 'p1', tenantId: 't1', lastHandshakeAt: OLD, provisionedAt: OLD });
  const wg = { enabled: true, livePeers: jest.fn().mockResolvedValue(o.live ?? {}) };
  const mail = { sendAlert: jest.fn().mockResolvedValue(o.mail ?? MAIL_OK) };
  const notifications = { sendPushToTenant: jest.fn().mockResolvedValue(o.push ?? PUSH_NO_TOKEN) };
  const config = { get: jest.fn().mockReturnValue(o.alertEmail ?? 'ops@example.test') };
  const episodes = new WgAlertEpisodeService(db as never);
  const service = new WgStaleAlertService(db as never, wg as never, mail as never, notifications as never, config as never, episodes);
  const logs = {
    error: jest.spyOn(service['logger'], 'error').mockImplementation(),
    log: jest.spyOn(service['logger'], 'log').mockImplementation(),
    warn: jest.spyOn(service['logger'], 'warn').mockImplementation(),
  };
  return { db, wg, mail, notifications, config, episodes, service, logs };
}

const ep = (db: FakeWgAlertPrisma, i = 0) => db.episodes[i];
const sentryCodes = () => Sentry.captureMessage.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  Sentry.captureMessage.mockClear();
  Sentry.addBreadcrumb.mockClear();
});

describe('WgAlertEpisodeService', () => {
  it('création atomique : deux ouvertures concurrentes -> un seul épisode (le second reçoit P2002 -> faux)', async () => {
    const { db, episodes } = setup();
    const res = await Promise.all([
      episodes.open({ id: 'p1', tenantId: 't1' }, 'STALE_24H', new Date(T0), T0, false),
      episodes.open({ id: 'p1', tenantId: 't1' }, 'STALE_24H', new Date(T0), T0, false),
    ]);
    expect(res.sort()).toEqual([false, true]);
    expect(db.episodes).toHaveLength(1);
    expect(ep(db)).toMatchObject({ status: 'OPEN', attemptCount: 0, nextAttemptAt: new Date(T0) });
  });

  it('un épisode résolu n empêche pas un nouvel épisode', async () => {
    const { db, episodes } = setup();
    await episodes.open({ id: 'p1', tenantId: 't1' }, 'STALE_24H', new Date(T0), T0, false);
    await episodes.resolvePeer('p1', T0 + H);
    expect(await episodes.open({ id: 'p1', tenantId: 't1' }, 'STALE_24H', new Date(T0 + 2 * H), T0 + 2 * H, false)).toBe(true);
    expect(db.episodes.map((e) => e.status)).toEqual(['RESOLVED', 'OPEN']);
  });

  it('deux claims simultanés : un seul gagne', async () => {
    const { episodes } = setup();
    await episodes.open({ id: 'p1', tenantId: 't1' }, 'STALE_24H', new Date(T0), T0, false);
    const [due] = await episodes.findDue(T0);
    const wins = await Promise.all([episodes.claim(due.id, 0, T0), episodes.claim(due.id, 0, T0)]);
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  it('complete est idempotent : un second écrivain pour la même tentative est ignoré (aucune ligne en double)', async () => {
    const { db, episodes } = setup();
    await episodes.open({ id: 'p1', tenantId: 't1' }, 'STALE_24H', new Date(T0), T0, false);
    const record = {
      emailStatus: 'FAILED' as const,
      pushStatus: 'NO_TOKEN' as const,
      channels: [
        { channel: 'EMAIL' as const, status: 'PROVIDER_FAILED' as const, failureCode: 'SMTP_ERROR', recipientCount: 1 },
        { channel: 'PUSH' as const, status: 'NO_TOKEN' as const, failureCode: null, recipientCount: 0 },
      ],
    };
    const first = await episodes.complete(ep(db).id, 0, record, T0, { detectedAt: new Date(T0), legacy: false });
    const second = await episodes.complete(ep(db).id, 0, record, T0, { detectedAt: new Date(T0), legacy: false });
    expect([first.saved, second.saved]).toEqual([true, false]);
    expect(db.attempts).toHaveLength(2);
    expect(ep(db).attemptCount).toBe(1);
  });
});

describe('WgStaleAlertService — épisode durable', () => {
  it('détection : épisode créé, première tentative immédiate, une ligne EMAIL et une ligne PUSH même sans canal', async () => {
    const { db, service } = setup({ alertEmail: '', superAdmins: [] });
    expect(await service.check(T0)).toEqual({ alerted: 1, resolved: 0 });
    expect(db.episodes).toHaveLength(1);
    expect(ep(db)).toMatchObject({ alertType: 'STALE_24H', attemptCount: 1, lastAttemptAt: new Date(T0), emailStatus: 'NO_RECIPIENT', pushStatus: 'NO_TOKEN', providerAcceptedAt: null });
    expect(db.attempts.map((a) => `${a.channel}:${a.status}:${a.recipientCount}`).sort()).toEqual(['EMAIL:NO_RECIPIENT:0', 'PUSH:NO_TOKEN:0']);
    expect(db.peers[0].staleAlertedAt).toEqual(new Date(T0));
  });

  it('SMTP non configuré : tentative EMAIL NOT_CONFIGURED enregistrée', async () => {
    const { db, service } = setup({ mail: { status: 'NOT_CONFIGURED' } });
    await service.check(T0);
    expect(db.attempts.find((a) => a.channel === 'EMAIL')).toMatchObject({ status: 'NOT_CONFIGURED', recipientCount: 1 });
  });

  it('première tentative acceptée par e-mail : PROVIDER_ACCEPTED, plus de retry programmé', async () => {
    const { db, service } = setup();
    await service.check(T0);
    expect(ep(db)).toMatchObject({ status: 'PROVIDER_ACCEPTED', providerAcceptedAt: new Date(T0), nextAttemptAt: null, attemptCount: 1 });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('première tentative acceptée par push (e-mail sans destinataire) : PROVIDER_ACCEPTED', async () => {
    const { db, service } = setup({ alertEmail: '', push: PUSH_OK });
    await service.check(T0);
    expect(ep(db)).toMatchObject({ status: 'PROVIDER_ACCEPTED', nextAttemptAt: null });
    expect(db.attempts.find((a) => a.channel === 'PUSH')).toMatchObject({ status: 'PROVIDER_ACCEPTED', providerAcceptedAt: new Date(T0) });
  });

  it('canal dégradé : accepté par un canal, l autre en échec = warn WG_ALERT_PROVIDER_DEGRADED, aucune erreur globale', async () => {
    const { db, service, logs } = setup({ push: PUSH_FAIL });
    await service.check(T0);
    expect(ep(db).status).toBe('PROVIDER_ACCEPTED');
    expect(logs.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'WG_ALERT_PROVIDER_DEGRADED' }));
    expect(logs.error).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(db.attempts.find((a) => a.channel === 'PUSH')).toMatchObject({ status: 'PROVIDER_FAILED', failureCode: 'HTTP_500' });
  });

  it('aucun fournisseur : OPEN, attemptCount 1, prochaine tentative à +1 h, un seul Sentry WG_ALERT_UNDELIVERED', async () => {
    const { db, service } = setup({ mail: MAIL_FAIL, push: PUSH_NO_TOKEN });
    await service.check(T0);
    expect(ep(db)).toMatchObject({ status: 'OPEN', attemptCount: 1, nextAttemptAt: new Date(T0 + H), providerAcceptedAt: null });
    expect(sentryCodes()).toEqual(['WG_ALERT_UNDELIVERED']);
  });

  it('retry interdit avant nextAttemptAt', async () => {
    const { mail, service } = setup({ mail: MAIL_FAIL });
    await service.check(T0);
    await service.check(T0 + 59 * MIN);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('planning : tentative 2 à +1 h, tentative 3 à +6 h après la 2e (≈ T0+7 h), puis EXHAUSTED', async () => {
    const { db, mail, service } = setup({ mail: MAIL_FAIL });
    await service.check(T0);
    await service.check(T0 + H);
    expect(ep(db)).toMatchObject({ attemptCount: 2, status: 'OPEN', nextAttemptAt: new Date(T0 + 7 * H) });
    await service.check(T0 + 6 * H);
    expect(mail.sendAlert).toHaveBeenCalledTimes(2);
    await service.check(T0 + 7 * H);
    expect(ep(db)).toMatchObject({ attemptCount: 3, status: 'EXHAUSTED', nextAttemptAt: null });
    expect(mail.sendAlert).toHaveBeenCalledTimes(3);
    expect(db.attempts).toHaveLength(6);
  });

  it('Sentry : UNDELIVERED une seule fois (tentative 1), EXHAUSTED une seule fois, aucun spam ensuite', async () => {
    const { service } = setup({ mail: MAIL_FAIL });
    for (const dt of [0, H, 7 * H, 8 * H, 30 * H, 60 * H]) await service.check(T0 + dt);
    expect(sentryCodes()).toEqual(['WG_ALERT_UNDELIVERED', 'WG_ALERT_DELIVERY_EXHAUSTED']);
  });

  it('aucun retry pour un épisode EXHAUSTED', async () => {
    const { db, mail, service } = setup({ mail: MAIL_FAIL });
    for (const dt of [0, H, 7 * H]) await service.check(T0 + dt);
    mail.sendAlert.mockClear();
    await service.check(T0 + 50 * H);
    expect(mail.sendAlert).not.toHaveBeenCalled();
    expect(db.episodes).toHaveLength(1);
    expect(ep(db).status).toBe('EXHAUSTED');
  });

  it('aucun retry pour un épisode PROVIDER_ACCEPTED : tentatives jamais relancées, prochain rappel à détection + 24 h', async () => {
    const { db, mail, service } = setup();
    await service.check(T0);
    expect(ep(db)).toMatchObject({ nextAttemptAt: null, nextReminderAt: new Date(T0 + 24 * H), reminderCount: 0 });
    await service.check(T0 + 10 * H);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(ep(db).attemptCount).toBe(1);
  });

  it('deux crons concurrents : une seule tentative, un seul épisode', async () => {
    const { db, mail, service } = setup();
    await Promise.all([service.check(T0), service.check(T0)]);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(db.episodes).toHaveLength(1);
    expect(db.attempts).toHaveLength(2);
  });

  it('crash après claim : rien n est compté, le claim valide bloque, le claim expiré est repris', async () => {
    const { db, mail, episodes, service } = setup({ mail: MAIL_FAIL });
    const complete = jest.spyOn(episodes, 'complete').mockRejectedValueOnce(new Error('process killed'));
    await service.check(T0);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(ep(db)).toMatchObject({ attemptCount: 0, status: 'OPEN' });
    expect(ep(db).claimExpiresAt).toEqual(new Date(T0 + WG_ALERT_CLAIM_TTL_MS));
    expect(db.attempts).toHaveLength(0);

    await service.check(T0 + MIN); // claim encore valide : pas de seconde tentative
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);

    complete.mockRestore();
    await service.check(T0 + WG_ALERT_CLAIM_TTL_MS + MIN); // claim expiré : repris, tentative 1 enfin comptée
    expect(mail.sendAlert).toHaveBeenCalledTimes(2);
    expect(ep(db)).toMatchObject({ attemptCount: 1, claimExpiresAt: null });
    expect(db.attempts).toHaveLength(2);
  });

  it('résolution par handshake : épisode RESOLVED, staleAlertedAt remis à NULL, aucun retry ensuite', async () => {
    const { db, mail, wg, service } = setup({ mail: MAIL_FAIL });
    await service.check(T0);
    wg.livePeers.mockResolvedValue({ 'pk-p1': { latestHandshake: Math.floor((T0 + 20 * MIN) / 1000) } });
    expect((await service.check(T0 + 30 * MIN)).resolved).toBe(1);
    expect(ep(db)).toMatchObject({ status: 'RESOLVED', resolvedAt: new Date(T0 + 30 * MIN), nextAttemptAt: null });
    expect(db.peers[0].staleAlertedAt).toBeNull();
    mail.sendAlert.mockClear();
    await service.check(T0 + 2 * H);
    expect(mail.sendAlert).not.toHaveBeenCalled();
  });

  it('nouvel épisode après nouvelle inactivité de 24 h : nouvel id, compteur à zéro, ancien épisode intact', async () => {
    const { db, mail, wg, service } = setup({ mail: MAIL_FAIL });
    await service.check(T0);
    wg.livePeers.mockResolvedValue({ 'pk-p1': { latestHandshake: Math.floor((T0 + 20 * MIN) / 1000) } });
    await service.check(T0 + 30 * MIN);
    const oldId = ep(db).id;
    wg.livePeers.mockResolvedValue({});
    mail.sendAlert.mockClear();
    expect((await service.check(T0 + 30 * MIN + 25 * H)).alerted).toBe(1);
    expect(db.episodes).toHaveLength(2);
    expect(db.episodes[1]).toMatchObject({ status: 'OPEN', attemptCount: 1 });
    expect(db.episodes[1].id).not.toBe(oldId);
    expect(db.episodes[0]).toMatchObject({ id: oldId, status: 'RESOLVED', attemptCount: 1 });
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('isolation tenant : chaque épisode notifie son tenant, la résolution d un peer ne touche pas l autre', async () => {
    const { db, notifications, episodes, service } = setup({ mail: MAIL_FAIL });
    db.addPeer({ id: 'p2', tenantId: 't2', lastHandshakeAt: OLD, provisionedAt: OLD });
    await service.check(T0);
    expect(notifications.sendPushToTenant.mock.calls.map((c) => c[0]).sort()).toEqual(['t1', 't2']);
    await episodes.resolvePeer('p1', T0 + MIN);
    expect(db.episodes.find((e) => e.tenantId === 't1')?.status).toBe('RESOLVED');
    expect(db.episodes.find((e) => e.tenantId === 't2')?.status).toBe('OPEN');
  });

  it('push : un seul appel par tentative, rôles exactement OWNER et ADMIN (TICKET_VERIFIER exclu)', async () => {
    const { notifications, service } = setup();
    await service.check(T0);
    expect(notifications.sendPushToTenant).toHaveBeenCalledTimes(1);
    const roles = notifications.sendPushToTenant.mock.calls[0][5] as string[];
    expect([...roles].sort()).toEqual(['ADMIN', 'OWNER']);
    expect(roles).not.toContain('TICKET_VERIFIER');
  });

  it('peer révoqué entre-temps : épisode résolu, aucun envoi', async () => {
    const { db, mail, service } = setup({ mail: MAIL_FAIL });
    await service.check(T0);
    db.peers[0].status = 'REVOKED';
    mail.sendAlert.mockClear();
    await service.check(T0 + H);
    expect(mail.sendAlert).not.toHaveBeenCalled();
    expect(ep(db).status).toBe('RESOLVED');
  });

  it('WireGuard désactivé ou lecture wg impossible : aucun épisode', async () => {
    const a = setup();
    (a.wg as { enabled: boolean }).enabled = false;
    expect(await a.service.check(T0)).toEqual({ alerted: 0, resolved: 0 });
    const b = setup();
    b.wg.livePeers.mockRejectedValue(new Error('wg: not found'));
    expect(await b.service.check(T0)).toEqual({ alerted: 0, resolved: 0 });
    expect(a.db.episodes).toHaveLength(0);
    expect(b.db.episodes).toHaveLength(0);
  });
});

describe('WgStaleAlertService — destinataires e-mail (un envoi par adresse)', () => {
  it('ALERT_EMAIL défini : sendAlert appelé exactement une fois, SUPER_ADMIN non utilisés', async () => {
    const { mail, service } = setup({ alertEmail: 'ops@example.test', superAdmins: [{ email: 'root@example.test' }] });
    await service.check(T0);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(mail.sendAlert).toHaveBeenCalledWith('ops@example.test', expect.anything(), expect.anything());
  });

  it('ALERT_EMAIL identique à un SUPER_ADMIN : exactement une fois', async () => {
    const { mail, service } = setup({ alertEmail: 'Root@Example.test', superAdmins: [{ email: 'root@example.test' }] });
    await service.check(T0);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('ALERT_EMAIL absent, doublon de SUPER_ADMIN (casse différente) : exactement une fois', async () => {
    const { mail, service } = setup({ alertEmail: '', superAdmins: [{ email: 'Root@Example.test' }, { email: 'root@example.test' }] });
    await service.check(T0);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('plusieurs SUPER_ADMIN distincts : une fois par adresse', async () => {
    const { mail, service } = setup({ alertEmail: '', superAdmins: [{ email: 'a@example.test' }, { email: 'b@example.test' }] });
    await service.check(T0);
    expect(mail.sendAlert.mock.calls.map((c) => c[0]).sort()).toEqual(['a@example.test', 'b@example.test']);
  });

  it('aucun destinataire : aucune tentative SMTP, NO_RECIPIENT', async () => {
    const { db, mail, service } = setup({ alertEmail: '', superAdmins: [] });
    await service.check(T0);
    expect(mail.sendAlert).not.toHaveBeenCalled();
    expect(db.attempts.find((a) => a.channel === 'EMAIL')?.status).toBe('NO_RECIPIENT');
  });

  it('timeout SMTP : tentative EMAIL TIMEOUT', async () => {
    const { db, service } = setup({ mail: { status: 'FAILED', failureCode: 'TIMEOUT' } });
    await service.check(T0);
    expect(db.attempts.find((a) => a.channel === 'EMAIL')).toMatchObject({ status: 'TIMEOUT', failureCode: 'TIMEOUT' });
  });
});

describe('WgStaleAlertService — données existantes (backfill) ', () => {
  it('ancien staleAlertedAt sans épisode : épisode LEGACY, acceptation inconnue (jamais présumée), une seule nouvelle tentative', async () => {
    const { db, mail, service } = setup({ mail: MAIL_FAIL });
    db.peers[0].staleAlertedAt = new Date(T0 - 5 * H);
    await service.check(T0);
    expect(db.episodes).toHaveLength(1);
    expect(ep(db)).toMatchObject({ legacy: true, failureCode: 'LEGACY_ACCEPTANCE_UNKNOWN', detectedAt: new Date(T0 - 5 * H), providerAcceptedAt: null, status: 'OPEN', attemptCount: 1 });
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    await service.check(T0 + 10 * MIN);
    await service.check(T0 + 20 * MIN);
    expect(db.episodes).toHaveLength(1);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('backfill idempotent : repasser le cron ne crée ni second épisode ni seconde alerte', async () => {
    const { db, mail, service } = setup();
    db.peers[0].staleAlertedAt = new Date(T0 - 5 * H);
    await Promise.all([service.check(T0), service.check(T0)]);
    await service.check(T0 + MIN);
    expect(db.episodes).toHaveLength(1);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('ancien staleAlertedAt mais tunnel sain : résolu, aucun envoi', async () => {
    const { db, mail, wg, service } = setup();
    db.peers[0].staleAlertedAt = new Date(T0 - 5 * H);
    wg.livePeers.mockResolvedValue({ 'pk-p1': { latestHandshake: Math.floor((T0 - MIN) / 1000) } });
    expect(await service.check(T0)).toEqual({ alerted: 0, resolved: 1 });
    expect(db.episodes).toHaveLength(0);
    expect(mail.sendAlert).not.toHaveBeenCalled();
    expect(db.peers[0].staleAlertedAt).toBeNull();
  });
});

describe('WgStaleAlertService — aucune donnée sensible', () => {
  it('base : ni adresse, ni token, ni alias, ni IP, ni clé, ni message utilisateur', async () => {
    const { db, service } = setup({ mail: MAIL_FAIL, push: PUSH_FAIL });
    await service.check(T0);
    await service.check(T0 + H);
    const rows = JSON.stringify([db.episodes, db.attempts]);
    expect(rows).not.toMatch(/@|ExponentPushToken|FREEDOM|freedom-id|pk-p1|10\.\d+\.\d+\.\d+|injoignable|handshake/i);
  });

  it('logs et Sentry : références pseudonymisées, aucun identifiant brut', async () => {
    const { db, service, logs } = setup({ mail: MAIL_FAIL, push: PUSH_FAIL });
    for (const dt of [0, H, 7 * H]) await service.check(T0 + dt);
    const all = JSON.stringify([...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls, Sentry.captureMessage.mock.calls, Sentry.addBreadcrumb.mock.calls]);
    for (const raw of ['"p1"', '"t1"', '"r-p1"', 'FREEDOM', 'freedom-id', 'ops@example.test', 'pk-p1', db.episodes[0].id]) expect(all).not.toContain(raw);
    expect(all).toContain(deliveryEntityRef(db.episodes[0].id));
    expect(all).toContain(deliveryEntityRef('p1'));
  });

  it('contrat Sentry : tags et extra limités, jamais d identifiant brut ni de texte utilisateur', async () => {
    const { db, service } = setup({ mail: MAIL_FAIL, push: PUSH_FAIL });
    await service.check(T0);
    const [message, ctx] = Sentry.captureMessage.mock.calls[0] as [string, { level: string; tags: Record<string, unknown>; extra: Record<string, unknown> }];
    expect(message).toBe('WG_ALERT_UNDELIVERED');
    expect(Object.keys(ctx.tags).sort()).toEqual(['alertType', 'domain', 'emailStatus', 'errorCode', 'pushStatus']);
    expect(Object.keys(ctx.extra).sort()).toEqual(['attemptNumber', 'episodeRef', 'failureCodes', 'peerRef', 'tenantRef']);
    expect(ctx.extra.episodeRef).toBe(deliveryEntityRef(db.episodes[0].id));
    const json = JSON.stringify([message, ctx]);
    for (const secret of ['p1"', 't1"', 'FREEDOM', 'freedom-id', 'pk-p1', '@', 'ExponentPushToken', 'injoignable']) expect(json).not.toContain(secret);
  });

  it('aucun événement Sentry avant le résultat des canaux', async () => {
    const { mail, service } = setup();
    const seen: number[] = [];
    mail.sendAlert.mockImplementation(async () => {
      seen.push(Sentry.captureMessage.mock.calls.length + Sentry.addBreadcrumb.mock.calls.length);
      return MAIL_OK;
    });
    await service.check(T0);
    expect(seen).toEqual([0]);
  });
});

describe('WgStaleAlertService — rappels quotidiens (incident toujours non résolu)', () => {
  const DAY = 24 * H;
  const remindersOf = (db: FakeWgAlertPrisma) => db.attempts.filter((a) => a.kind === 'REMINDER');

  it('alerte initiale acceptée, peer toujours stale avant 24 h : aucun rappel', async () => {
    const { db, mail, service } = setup();
    await service.check(T0);
    await service.check(T0 + 23 * H);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(remindersOf(db)).toHaveLength(0);
  });

  it('à 24 h : exactement un rappel logique, une tentative EMAIL et une PUSH, planning +24 h', async () => {
    const { db, mail, notifications, service } = setup();
    await service.check(T0);
    await service.check(T0 + DAY);
    expect(mail.sendAlert).toHaveBeenCalledTimes(2);
    expect(notifications.sendPushToTenant).toHaveBeenCalledTimes(2);
    expect(ep(db)).toMatchObject({ status: 'PROVIDER_ACCEPTED', reminderCount: 1, lastReminderAt: new Date(T0 + DAY), nextReminderAt: new Date(T0 + 2 * DAY), attemptCount: 1 });
    expect(remindersOf(db).map((a) => `${a.channel}:${a.reminderNumber}:${a.attemptNumber}`).sort()).toEqual(['EMAIL:1:4', 'PUSH:1:4']);
  });

  it('deux crons concurrents à 24 h : un seul rappel logique', async () => {
    const { db, mail, service } = setup();
    await service.check(T0);
    await Promise.all([service.check(T0 + DAY), service.check(T0 + DAY)]);
    expect(mail.sendAlert).toHaveBeenCalledTimes(2);
    expect(ep(db).reminderCount).toBe(1);
    expect(remindersOf(db)).toHaveLength(2);
  });

  it('un rappel n est jamais réessayé toutes les 10 minutes, même en échec : prochain essai = J+1', async () => {
    const { db, mail, service } = setup();
    await service.check(T0);
    mail.sendAlert.mockResolvedValue(MAIL_FAIL);
    await service.check(T0 + DAY);
    await service.check(T0 + DAY + 10 * MIN);
    await service.check(T0 + DAY + 20 * MIN);
    expect(mail.sendAlert).toHaveBeenCalledTimes(2);
    expect(ep(db)).toMatchObject({ reminderCount: 1, nextReminderAt: new Date(T0 + 2 * DAY), status: 'PROVIDER_ACCEPTED' });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('à 48 h : rappel numéro 2', async () => {
    const { db, service } = setup();
    for (const dt of [0, DAY, 2 * DAY]) await service.check(T0 + dt);
    expect(ep(db)).toMatchObject({ reminderCount: 2, nextReminderAt: new Date(T0 + 3 * DAY) });
    expect(remindersOf(db).filter((a) => a.reminderNumber === 2)).toHaveLength(2);
  });

  it('handshake sain : aucun rappel, épisode RESOLVED, nextReminderAt null', async () => {
    const { db, mail, wg, service } = setup();
    await service.check(T0);
    wg.livePeers.mockResolvedValue({ 'pk-p1': { latestHandshake: Math.floor((T0 + DAY - MIN) / 1000) } });
    await service.check(T0 + DAY);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(ep(db)).toMatchObject({ status: 'RESOLVED', nextReminderAt: null, nextAttemptAt: null });
    await service.check(T0 + DAY + H); // tunnel toujours sain : ni rappel ni nouvel épisode
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(db.episodes).toHaveLength(1);
  });

  it('rappel dû mais tunnel redevenu sain entre-temps : pas de rappel, épisode résolu', async () => {
    const { db, mail, episodes, service } = setup();
    await service.check(T0);
    db.peers[0].lastHandshakeAt = new Date(T0 + DAY - MIN); // handshake observé hors cron
    await service.check(T0 + DAY);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(ep(db).status).toBe('RESOLVED');
    expect(await episodes.hasActive('p1')).toBe(false);
  });

  it('course entre le scan et le rappel : tunnel redevenu sain après la lecture des rappels dus -> aucun envoi, épisode résolu', async () => {
    const { db, mail, episodes, service } = setup();
    await service.check(T0);
    const [due] = await episodes.findRemindersDue(T0 + DAY);
    expect(due).toBeDefined();
    db.peers[0].lastHandshakeAt = new Date(T0 + DAY - MIN); // le tunnel reprend entre la lecture et l'envoi
    await (service as unknown as { runReminder(ep: unknown, now: number): Promise<void> }).runReminder(due, T0 + DAY);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(ep(db)).toMatchObject({ status: 'RESOLVED', nextReminderAt: null, reminderCount: 0 });
  });

  it('nouvel épisode après résolution : reminderCount repart à zéro, nouveau planning', async () => {
    const { db, wg, service } = setup();
    await service.check(T0);
    await service.check(T0 + DAY);
    expect(ep(db).reminderCount).toBe(1);
    wg.livePeers.mockResolvedValue({ 'pk-p1': { latestHandshake: Math.floor((T0 + DAY + 20 * MIN) / 1000) } });
    await service.check(T0 + DAY + 30 * MIN);
    wg.livePeers.mockResolvedValue({});
    const t = T0 + DAY + 30 * MIN + 25 * H;
    await service.check(t);
    expect(db.episodes).toHaveLength(2);
    expect(db.episodes[1]).toMatchObject({ reminderCount: 0, lastReminderAt: null, status: 'PROVIDER_ACCEPTED', nextReminderAt: new Date(t + DAY) });
    expect(db.episodes[0]).toMatchObject({ status: 'RESOLVED', reminderCount: 1 });
  });

  it('après 7 rappels : aucun huitième, épisode actif conservé', async () => {
    const { db, mail, service } = setup();
    for (let k = 0; k <= 12; k++) await service.check(T0 + k * DAY);
    expect(ep(db)).toMatchObject({ status: 'PROVIDER_ACCEPTED', reminderCount: 7, nextReminderAt: null, resolvedAt: null });
    expect(mail.sendAlert).toHaveBeenCalledTimes(1 + 7);
    expect(remindersOf(db)).toHaveLength(14);
  });

  it('crash après claim du rappel : reprise après expiration, un seul rappel enregistré par numéro et canal', async () => {
    const { db, mail, episodes, service } = setup();
    await service.check(T0);
    const spy = jest.spyOn(episodes, 'completeReminder').mockRejectedValueOnce(new Error('process killed'));
    await service.check(T0 + DAY);
    expect(ep(db)).toMatchObject({ reminderCount: 0 });
    expect(ep(db).claimExpiresAt).toEqual(new Date(T0 + DAY + WG_ALERT_CLAIM_TTL_MS));
    await service.check(T0 + DAY + MIN); // claim valide : rien
    expect(mail.sendAlert).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    await service.check(T0 + DAY + WG_ALERT_CLAIM_TTL_MS + MIN); // claim expiré : repris
    expect(ep(db)).toMatchObject({ reminderCount: 1, claimExpiresAt: null });
    expect(remindersOf(db).filter((a) => a.reminderNumber === 1)).toHaveLength(2); // une ligne par canal, jamais de doublon
  });

  it('redémarrage du backend : le planning du rappel est conservé (état en base, nouvelles instances)', async () => {
    const a = setup();
    await a.service.check(T0);
    const before = { ...ep(a.db) };
    const episodes2 = new WgAlertEpisodeService(a.db as never);
    const mail2 = { sendAlert: jest.fn().mockResolvedValue(MAIL_OK) };
    const service2 = new WgStaleAlertService(a.db as never, a.wg as never, mail2 as never, a.notifications as never, a.config as never, episodes2);
    expect(before.nextReminderAt).toEqual(new Date(T0 + DAY));
    await service2.check(T0 + 2 * H);
    expect(mail2.sendAlert).not.toHaveBeenCalled();
    await service2.check(T0 + DAY);
    expect(mail2.sendAlert).toHaveBeenCalledTimes(1);
    expect(ep(a.db).reminderCount).toBe(1);
  });

  it('autre tenant non affecté : chaque rappel notifie son tenant, la résolution d un peer garde l autre', async () => {
    const { db, notifications, episodes, service } = setup();
    db.addPeer({ id: 'p2', tenantId: 't2', lastHandshakeAt: OLD, provisionedAt: OLD });
    await service.check(T0);
    notifications.sendPushToTenant.mockClear();
    await service.check(T0 + DAY);
    expect(notifications.sendPushToTenant.mock.calls.map((c) => c[0]).sort()).toEqual(['t1', 't2']);
    await episodes.resolvePeer('p1', T0 + DAY + MIN);
    expect(db.episodes.find((e) => e.tenantId === 't2')).toMatchObject({ status: 'PROVIDER_ACCEPTED', reminderCount: 1 });
  });

  it('push du rappel : un seul appel, OWNER et ADMIN seulement (TICKET_VERIFIER exclu)', async () => {
    const { notifications, service } = setup();
    await service.check(T0);
    notifications.sendPushToTenant.mockClear();
    await service.check(T0 + DAY);
    expect(notifications.sendPushToTenant).toHaveBeenCalledTimes(1);
    expect([...(notifications.sendPushToTenant.mock.calls[0][5] as string[])].sort()).toEqual(['ADMIN', 'OWNER']);
  });

  it('aucun secret dans la base, les logs ni Sentry après plusieurs rappels', async () => {
    const { db, service, logs } = setup({ push: PUSH_FAIL });
    for (const k of [0, 1, 2, 3]) await service.check(T0 + k * DAY);
    const rows = JSON.stringify([db.episodes, db.attempts]);
    expect(rows).not.toMatch(/@|ExponentPushToken|FREEDOM|freedom-id|pk-p1|10\.\d+\.\d+\.\d+|injoignable/i);
    const out = JSON.stringify([logs.log.mock.calls, logs.warn.mock.calls, logs.error.mock.calls, Sentry.captureMessage.mock.calls, Sentry.addBreadcrumb.mock.calls]);
    expect(out).not.toMatch(/@|ExponentPushToken|FREEDOM|freedom-id|pk-p1|"p1"|"t1"|r-p1|injoignable/i);
  });
});

describe('WgAlertEpisodeService — valeurs persistées fermées', () => {
  const record = (over: Record<string, unknown> = {}) =>
    ({
      emailStatus: 'FAILED',
      pushStatus: 'NO_TOKEN',
      channels: [
        { channel: 'EMAIL', status: 'PROVIDER_FAILED', failureCode: 'SMTP_ERROR', recipientCount: 1 },
        { channel: 'PUSH', status: 'NO_TOKEN', failureCode: null, recipientCount: 0 },
      ],
      ...over,
    }) as never;

  it('statut e-mail ou push inconnu : rejeté avant toute écriture', async () => {
    const { db, episodes } = setup();
    await episodes.open({ id: 'p1', tenantId: 't1' }, 'STALE_24H', new Date(T0), T0, false);
    const ctx = { detectedAt: new Date(T0), legacy: false };
    await expect(episodes.complete(ep(db).id, 0, record({ emailStatus: 'DELIVERED_TO_HUMAN' }), T0, ctx)).rejects.toThrow('INVALID_ALERT_STATUS');
    await expect(episodes.complete(ep(db).id, 0, record({ pushStatus: 'whatever' }), T0, ctx)).rejects.toThrow('INVALID_ALERT_STATUS');
    await expect(episodes.completeReminder(ep(db).id, 0, record({ emailStatus: 'x' }), T0)).rejects.toThrow('INVALID_ALERT_STATUS');
    expect(db.attempts).toHaveLength(0);
    expect(ep(db).attemptCount).toBe(0);
  });

  it('statut de tentative inconnu : rejeté ; code d échec libre (texte, adresse) neutralisé', async () => {
    const { db, episodes } = setup();
    await episodes.open({ id: 'p1', tenantId: 't1' }, 'STALE_24H', new Date(T0), T0, false);
    const ctx = { detectedAt: new Date(T0), legacy: false };
    const bad = record({ channels: [{ channel: 'EMAIL', status: 'BOGUS', failureCode: null, recipientCount: 0 }] });
    await expect(episodes.complete(ep(db).id, 0, bad, T0, ctx)).rejects.toThrow('INVALID_ALERT_STATUS');
    const leaky = record({ channels: [{ channel: 'EMAIL', status: 'PROVIDER_FAILED', failureCode: '550 bob@example.test refused', recipientCount: 1 }] });
    await episodes.complete(ep(db).id, 0, leaky, T0, ctx);
    expect(db.attempts[0].failureCode).toBe('UNKNOWN_FAILURE');
  });
});
