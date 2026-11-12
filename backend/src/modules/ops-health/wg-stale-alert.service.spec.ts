import { WgStaleAlertService } from './wg-stale-alert.service';
import { WgAlertDeliveryRegistry, deliveryEntityRef } from './wg-alert-delivery';

jest.mock('@sentry/node', () => ({ captureMessage: jest.fn(), captureException: jest.fn(), addBreadcrumb: jest.fn() }));

const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);
const H = 3_600_000;
const KEY = 'pubkey-1';

function peer(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    routerId: 'r1',
    tenantId: 't1',
    wgPublicKey: KEY,
    lastHandshakeAt: new Date(T0 - 30 * H),
    provisionedAt: new Date(T0 - 100 * H),
    createdAt: new Date(T0 - 100 * H),
    staleAlertedAt: null as Date | null,
    router: { alias: 'FREEDOM', identity: 'freedom-id' },
    ...over,
  };
}

const PUSH_OK = { status: 'SENT', tokensFound: 1, accepted: 1, invalid: 0 };
const PUSH_NO_TOKEN = { status: 'NO_TOKEN', tokensFound: 0, accepted: 0, invalid: 0 };

function setup(
  peers: unknown[],
  live: Record<string, { latestHandshake: number }> | Error,
  enabled = true,
  alertEmail: string | undefined = 'ops@example.test',
  superAdmins: Array<{ email: string }> = [],
  sharedRegistry?: WgAlertDeliveryRegistry,
) {
  const prisma = {
    remotePeer: {
      findMany: jest.fn().mockResolvedValue(peers),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findMany: jest.fn().mockResolvedValue(superAdmins) },
  };
  const wg = {
    enabled,
    livePeers: jest.fn().mockImplementation(async () => {
      if (live instanceof Error) throw live;
      return live;
    }),
  };
  const mail = { sendAlert: jest.fn().mockResolvedValue({ status: 'SENT' }) };
  const notifications = { sendPushToTenant: jest.fn().mockResolvedValue(PUSH_OK) };
  const config = { get: jest.fn().mockReturnValue(alertEmail) };
  const registry = sharedRegistry ?? new WgAlertDeliveryRegistry();
  const service = new WgStaleAlertService(prisma as never, wg as never, mail as never, notifications as never, config as never, registry);
  const logs = { error: jest.spyOn(service['logger'], 'error').mockImplementation(), log: jest.spyOn(service['logger'], 'log').mockImplementation(), warn: jest.spyOn(service['logger'], 'warn').mockImplementation() };
  return { service, prisma, wg, mail, notifications, registry, logs };
}

describe('WgStaleAlertService.check', () => {
  it('peer sans handshake depuis 30 h : alerte e-mail + push, épisode marqué', async () => {
    const { service, prisma, mail, notifications } = setup([peer()], {});
    expect(await service.check(T0)).toEqual({ alerted: 1, resolved: 0 });
    expect(prisma.remotePeer.updateMany).toHaveBeenCalledTimes(1);
    expect(mail.sendAlert).toHaveBeenCalledWith('ops@example.test', 'Tunnel WireGuard injoignable', expect.stringContaining('FREEDOM'));
    expect(notifications.sendPushToTenant).toHaveBeenCalledWith('t1', 'Routeur injoignable', expect.stringContaining('30 h'), 'r1', undefined, ['OWNER', 'ADMIN']);
  });

  it('déjà alerté il y a 1 h : aucune seconde alerte (déduplication)', async () => {
    const { service, mail, notifications, prisma } = setup([peer({ staleAlertedAt: new Date(T0 - H) })], {});
    expect(await service.check(T0)).toEqual({ alerted: 0, resolved: 0 });
    expect(prisma.remotePeer.updateMany).not.toHaveBeenCalled();
    expect(mail.sendAlert).not.toHaveBeenCalled();
    expect(notifications.sendPushToTenant).not.toHaveBeenCalled();
  });

  it('rappel après 24 h', async () => {
    const { service, mail } = setup([peer({ staleAlertedAt: new Date(T0 - 24 * H) })], {});
    expect((await service.check(T0)).alerted).toBe(1);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('un autre processus a déjà pris l’alerte (verrou atomique count 0) : rien n’est envoyé', async () => {
    const { service, prisma, mail } = setup([peer()], {});
    prisma.remotePeer.updateMany.mockResolvedValue({ count: 0 });
    expect((await service.check(T0)).alerted).toBe(0);
    expect(mail.sendAlert).not.toHaveBeenCalled();
  });

  it('handshake frais : épisode résolu automatiquement, pas d’alerte', async () => {
    const fresh = Math.floor((T0 - 60_000) / 1000);
    const { service, prisma, mail } = setup([peer({ staleAlertedAt: new Date(T0 - 5 * H) })], { [KEY]: { latestHandshake: fresh } });
    expect(await service.check(T0)).toEqual({ alerted: 0, resolved: 1 });
    expect(prisma.remotePeer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { lastHandshakeAt: new Date(fresh * 1000) } });
    expect(prisma.remotePeer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { staleAlertedAt: null } });
    expect(mail.sendAlert).not.toHaveBeenCalled();
  });

  it('jamais connecté depuis 53 jours : alerte NEVER_CONNECTED', async () => {
    const { service, mail } = setup([peer({ lastHandshakeAt: null, provisionedAt: new Date(T0 - 53 * 24 * H) })], {});
    expect((await service.check(T0)).alerted).toBe(1);
    expect(mail.sendAlert).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining('jamais connecté'));
  });

  it('lecture `wg` impossible : on n’alerte pas (état inconnu ≠ tunnel mort)', async () => {
    const { service, mail, prisma } = setup([peer()], new Error('wg: not found'));
    expect(await service.check(T0)).toEqual({ alerted: 0, resolved: 0 });
    expect(prisma.remotePeer.findMany).not.toHaveBeenCalled();
    expect(mail.sendAlert).not.toHaveBeenCalled();
  });

  it('WireGuard désactivé : rien à faire', async () => {
    const { service, wg } = setup([peer()], {}, false);
    expect(await service.check(T0)).toEqual({ alerted: 0, resolved: 0 });
    expect(wg.livePeers).not.toHaveBeenCalled();
  });

  it('l’échec de l’e-mail n’empêche pas le push', async () => {
    const { service, mail, notifications } = setup([peer()], {});
    mail.sendAlert.mockRejectedValue(new Error('smtp down'));
    expect((await service.check(T0)).alerted).toBe(1);
    expect(notifications.sendPushToTenant).toHaveBeenCalledTimes(1);
  });
});

describe('WgStaleAlertService — preuve de livraison', () => {
  const undelivered = (logs: ReturnType<typeof setup>['logs']) =>
    logs.error.mock.calls.filter(([m]) => (m as { errorCode?: string }).errorCode === 'WG_ALERT_UNDELIVERED');

  it('ALERT_EMAIL configuré et SMTP accepté : un seul e-mail, providerAccepted, aucun SUPER_ADMIN interrogé', async () => {
    const { service, mail, prisma, registry, logs } = setup([peer()], {});
    await service.check(T0);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(mail.sendAlert).toHaveBeenCalledWith('ops@example.test', expect.anything(), expect.anything());
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(registry.snapshot(T0).wgNoProviderAccepted).toBe(0);
    expect(undelivered(logs)).toHaveLength(0);
    expect(logs.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'WG_ALERT_ACCEPTED' }));
  });

  it('ALERT_EMAIL absent : repli sur les SUPER_ADMIN actifs (requête filtrée actifs, non supprimés, e-mail non vide)', async () => {
    const { service, mail, prisma } = setup([peer()], {}, true, '', [{ email: 'root@example.test' }]);
    await service.check(T0);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE', deletedAt: null, anonymizedAt: null, email: { not: '' } },
      select: { email: true },
    });
    expect(mail.sendAlert).toHaveBeenCalledWith('root@example.test', expect.anything(), expect.anything());
  });

  it('SUPER_ADMIN en doublon (casse différente) : une seule livraison par adresse', async () => {
    const { service, mail } = setup([peer()], {}, true, '', [
      { email: 'Root@Example.test' },
      { email: 'root@example.test' },
      { email: 'second@example.test' },
    ]);
    await service.check(T0);
    expect(mail.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('aucun destinataire e-mail et aucun token : non livrée, WG_ALERT_UNDELIVERED, jamais « delivered »', async () => {
    const { service, mail, notifications, registry, logs, prisma } = setup([peer()], {}, true, '', []);
    notifications.sendPushToTenant.mockResolvedValue(PUSH_NO_TOKEN);
    await service.check(T0);
    expect(mail.sendAlert).not.toHaveBeenCalled();
    const calls = undelivered(logs);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ emailStatus: 'NO_RECIPIENT', pushStatus: 'NO_TOKEN', attempt: 1 });
    expect(logs.log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'WG_ALERT_ACCEPTED' }));
    expect(registry.snapshot(T0)).toMatchObject({ wgNoProviderAccepted: 1, wgNoRecipient: 1, wgNoPushToken: 1 });
    // staleAlertedAt reste posé (pas de relance en rafale) : aucune remise à null.
    expect(prisma.remotePeer.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { staleAlertedAt: null } }));
  });

  it('SMTP non configuré + push sans token : non livrée (NOT_CONFIGURED ≠ livraison)', async () => {
    const { service, mail, notifications, registry } = setup([peer()], {});
    mail.sendAlert.mockResolvedValue({ status: 'NOT_CONFIGURED' });
    notifications.sendPushToTenant.mockResolvedValue(PUSH_NO_TOKEN);
    await service.check(T0);
    expect(registry.snapshot(T0).wgNoProviderAccepted).toBe(1);
  });

  it('e-mail OK, push KO : livrée, défaut push mesuré', async () => {
    const { service, notifications, registry, logs } = setup([peer()], {});
    notifications.sendPushToTenant.mockResolvedValue({ status: 'FAILED', tokensFound: 1, accepted: 0, invalid: 0, failureCode: 'HTTP_500' });
    await service.check(T0);
    expect(registry.snapshot(T0)).toMatchObject({ wgNoProviderAccepted: 0, wgEmailProviderAccepted: 1, wgProviderFailures: 1 });
    expect(logs.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'WG_ALERT_CHANNEL_DEGRADED', failureCodes: ['HTTP_500'] }));
    expect(undelivered(logs)).toHaveLength(0);
  });

  it('push OK, e-mail KO : livrée, défaut e-mail mesuré', async () => {
    const { service, mail, registry } = setup([peer()], {});
    mail.sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'TIMEOUT' });
    await service.check(T0);
    expect(registry.snapshot(T0)).toMatchObject({ wgNoProviderAccepted: 0, wgPushProviderAccepted: 1, wgProviderFailures: 1 });
  });

  it('les deux échouent : non livrée, Sentry error WG_ALERT_UNDELIVERED sans donnée sensible', async () => {
    const Sentry = jest.requireMock('@sentry/node') as { captureMessage: jest.Mock };
    Sentry.captureMessage.mockClear();
    const { service, mail, notifications, registry, logs } = setup([peer()], {});
    mail.sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
    notifications.sendPushToTenant.mockResolvedValue({ status: 'FAILED', tokensFound: 1, accepted: 0, invalid: 0, failureCode: 'TIMEOUT' });
    await service.check(T0);
    expect(registry.snapshot(T0)).toMatchObject({ wgNoProviderAccepted: 1, wgProviderFailures: 2 });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const undeliveredSentry = Sentry.captureMessage.mock.calls.find(([m]) => m === 'WG_ALERT_UNDELIVERED');
    expect(undeliveredSentry).toBeDefined();
    const serialized = JSON.stringify([undeliveredSentry, undelivered(logs)]);
    expect(serialized).not.toMatch(/@|ExponentPushToken|FREEDOM|freedom-id|pk-/);
    expect(serialized).not.toMatch(/"(t1|p1|r1)"/);
  });

  it('exception du canal push : capturée, non livrée si e-mail absent aussi', async () => {
    const { service, notifications, registry } = setup([peer()], {}, true, '', []);
    notifications.sendPushToTenant.mockRejectedValue(new Error('boom'));
    await service.check(T0);
    expect(registry.snapshot(T0).wgNoProviderAccepted).toBe(1);
  });

  it('staleAlertedAt seul ne produit jamais le libellé « alerte envoyée / délivrée »', async () => {
    const { service, logs, mail, notifications } = setup([peer({ staleAlertedAt: new Date(T0 - H) })], {});
    await service.check(T0);
    expect(mail.sendAlert).not.toHaveBeenCalled();
    expect(notifications.sendPushToTenant).not.toHaveBeenCalled();
    const text = JSON.stringify([...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls]);
    expect(text).not.toMatch(/WG_ALERT_ACCEPTED|alerte envoy|alert sent/i);
  });

  it('résolution du tunnel : l incident non livré n est plus ouvert', async () => {
    const fresh = Math.floor((T0 - 60_000) / 1000);
    const { service, registry } = setup([peer({ staleAlertedAt: new Date(T0 - 5 * H) })], { [KEY]: { latestHandshake: fresh } }, true, '', []);
    registry.record('p1', { email: 'NO_RECIPIENT', push: 'NO_TOKEN', providerAccepted: false, attemptedAt: new Date(T0 - 5 * H), failureCodes: [] }, T0 - 5 * H);
    await service.check(T0);
    expect(registry.snapshot(T0).wgOpenNoProviderAcceptedOver1h).toBe(0);
  });
});

describe('WgStaleAlertService — un seul envoi par destinataire et par token', () => {
  const sentry = () => jest.requireMock('@sentry/node') as { captureMessage: jest.Mock; addBreadcrumb: jest.Mock };
  beforeEach(() => {
    sentry().captureMessage.mockClear();
    sentry().addBreadcrumb.mockClear();
  });

  it('ALERT_EMAIL défini : sendAlert appelé exactement une fois, SUPER_ADMIN non lus', async () => {
    const { service, mail, prisma } = setup([peer()], {}, true, 'ops@example.test', [{ email: 'root@example.test' }]);
    await service.check(T0);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('ALERT_EMAIL identique à un SUPER_ADMIN : exactement une fois', async () => {
    const { service, mail } = setup([peer()], {}, true, 'Root@Example.test', [{ email: 'root@example.test' }]);
    await service.check(T0);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(mail.sendAlert).toHaveBeenCalledWith('Root@Example.test', expect.anything(), expect.anything());
  });

  it('ALERT_EMAIL absent, deux SUPER_ADMIN même adresse (casse différente) : exactement une fois', async () => {
    const { service, mail } = setup([peer()], {}, true, '', [{ email: 'Root@Example.test' }, { email: 'root@example.test' }]);
    await service.check(T0);
    expect(mail.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('plusieurs SUPER_ADMIN distincts : une fois par adresse', async () => {
    const { service, mail } = setup([peer()], {}, true, '', [{ email: 'a@example.test' }, { email: 'b@example.test' }, { email: 'c@example.test' }]);
    await service.check(T0);
    expect(mail.sendAlert.mock.calls.map((c) => c[0]).sort()).toEqual(['a@example.test', 'b@example.test', 'c@example.test']);
  });

  it('aucun destinataire : aucune tentative SMTP, NO_RECIPIENT', async () => {
    const { service, mail, registry } = setup([peer()], {}, true, '', []);
    await service.check(T0);
    expect(mail.sendAlert).not.toHaveBeenCalled();
    expect(registry.snapshot(T0).wgNoRecipient).toBe(1);
  });

  it('push : un seul appel, rôles exactement OWNER et ADMIN (TICKET_VERIFIER jamais ciblé)', async () => {
    const { service, notifications } = setup([peer()], {});
    await service.check(T0);
    expect(notifications.sendPushToTenant).toHaveBeenCalledTimes(1);
    const roles = notifications.sendPushToTenant.mock.calls[0][5] as string[];
    expect([...roles].sort()).toEqual(['ADMIN', 'OWNER']);
    expect(roles).not.toContain('TICKET_VERIFIER');
  });

  it('e-mail accepté : 0 captureMessage, un breadcrumb sans donnée sensible', async () => {
    const { service, notifications } = setup([peer()], {});
    notifications.sendPushToTenant.mockResolvedValue(PUSH_NO_TOKEN);
    await service.check(T0);
    expect(sentry().captureMessage).not.toHaveBeenCalled();
    expect(sentry().addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sentry().addBreadcrumb.mock.calls)).not.toMatch(/@|"(t1|p1|r1)"|FREEDOM/);
  });

  it('push accepté, e-mail KO : 0 captureMessage, canal dégradé = exactement 1 warn, 0 erreur globale', async () => {
    const { service, mail, logs } = setup([peer()], {});
    mail.sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
    await service.check(T0);
    expect(sentry().captureMessage).not.toHaveBeenCalled();
    const degraded = logs.warn.mock.calls.filter(([m]) => (m as { event?: string }).event === 'WG_ALERT_CHANNEL_DEGRADED');
    expect(degraded).toHaveLength(1);
    expect(logs.error).not.toHaveBeenCalled();
  });

  it('les deux échouent : exactement 1 captureMessage et 1 log error', async () => {
    const { service, mail, notifications, logs } = setup([peer()], {});
    mail.sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
    notifications.sendPushToTenant.mockResolvedValue({ status: 'FAILED', tokensFound: 1, accepted: 0, invalid: 0, failureCode: 'HTTP_500' });
    await service.check(T0);
    expect(sentry().captureMessage).toHaveBeenCalledTimes(1);
    expect(logs.error).toHaveBeenCalledTimes(1);
  });

  it('aucun événement Sentry générique avant le résultat des canaux (ordre)', async () => {
    const { service, mail } = setup([peer()], {});
    const order: string[] = [];
    mail.sendAlert.mockImplementation(async () => {
      order.push(`mail(sentry=${sentry().captureMessage.mock.calls.length + sentry().addBreadcrumb.mock.calls.length})`);
      return { status: 'SENT' };
    });
    await service.check(T0);
    expect(order).toEqual(['mail(sentry=0)']);
  });

  it('logs : références pseudonymisées, aucun identifiant brut', async () => {
    const { service, mail, notifications, logs } = setup([peer()], {});
    mail.sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
    notifications.sendPushToTenant.mockResolvedValue(PUSH_NO_TOKEN);
    await service.check(T0);
    const all = JSON.stringify([...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls]);
    expect(all).not.toMatch(/"(t1|p1|r1)"|tenantId|peerId|routerId/);
    expect(all).toContain(deliveryEntityRef('t1'));
    expect(all).toContain(deliveryEntityRef('p1'));
  });

  it('redémarrage simulé : peer déjà marqué staleAlertedAt, aucun nouvel envoi, Ops Health ORANGE livraison inconnue', async () => {
    const { service, mail, notifications, registry } = setup([peer({ staleAlertedAt: new Date(T0 - H) })], {});
    await service.check(T0);
    expect(mail.sendAlert).not.toHaveBeenCalled();
    expect(notifications.sendPushToTenant).not.toHaveBeenCalled();
    expect(registry.snapshot(T0)).toMatchObject({ level: 'ORANGE', wgUnknownDeliveryAfterRestart: 1, wgNoProviderAccepted: 0 });
  });
});

describe('WgStaleAlertService — contrat Sentry WG_ALERT_UNDELIVERED', () => {
  it('tags et extra limités au contrat, aucun identifiant brut ni texte utilisateur', async () => {
    const Sentry = jest.requireMock('@sentry/node') as { captureMessage: jest.Mock };
    Sentry.captureMessage.mockClear();
    const raw = peer({ id: 'RAW-PEER-ID', tenantId: 'RAW-TENANT-ID', routerId: 'RAW-ROUTER-ID', wgPublicKey: 'RAW-WG-KEY', router: { alias: 'ALIAS-SECRET', identity: 'IDENTITY-SECRET' } });
    const { service, mail, notifications } = setup([raw], { 'RAW-WG-KEY': { latestHandshake: 0 } }, true, 'boss@example.test');
    mail.sendAlert.mockResolvedValue({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
    notifications.sendPushToTenant.mockResolvedValue({ status: 'FAILED', tokensFound: 1, accepted: 0, invalid: 0, failureCode: 'HTTP_500' });
    await service.check(T0);

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, ctx] = Sentry.captureMessage.mock.calls[0] as [string, { level: string; tags: Record<string, unknown>; extra: Record<string, unknown> }];
    expect(message).toBe('WG_ALERT_UNDELIVERED');
    expect(ctx.level).toBe('error');
    expect(Object.keys(ctx.tags).sort()).toEqual(['alertType', 'domain', 'emailStatus', 'errorCode', 'pushStatus']);
    expect(Object.keys(ctx.extra).sort()).toEqual(['attempt', 'failureCodes', 'peerRef', 'tenantRef']);
    expect(ctx.extra.peerRef).toBe(deliveryEntityRef('RAW-PEER-ID'));
    expect(ctx.extra.tenantRef).toBe(deliveryEntityRef('RAW-TENANT-ID'));
    const json = JSON.stringify([message, ctx]);
    for (const secret of ['RAW-PEER-ID', 'RAW-TENANT-ID', 'RAW-ROUTER-ID', 'RAW-WG-KEY', 'ALIAS-SECRET', 'IDENTITY-SECRET', 'boss@example.test', 'ExponentPushToken', 'injoignable']) {
      expect(json).not.toContain(secret);
    }
  });
});

describe('WgStaleAlertService — cycle d épisode (incident, redémarrage, résolution, nouvel épisode)', () => {
  it('non livré -> redémarrage = UNKNOWN_DELIVERY -> handshake sain = résolu -> 24 h d inactivité = nouvelle alerte unique, sans pollution', async () => {
    const DAY = 24 * H;
    // 1. Incident non livré.
    const first = setup([peer()], {}, true, '', []);
    first.notifications.sendPushToTenant.mockResolvedValue(PUSH_NO_TOKEN);
    expect((await first.service.check(T0)).alerted).toBe(1);
    expect(first.registry.snapshot(T0)).toMatchObject({ wgNoProviderAccepted: 1, wgAlertsCreated: 1 });

    // 2-3. Redémarrage : registre neuf, le peer porte staleAlertedAt -> livraison inconnue, aucun envoi.
    const stale = peer({ staleAlertedAt: new Date(T0) });
    const restarted = setup([stale], {}, true, '', []);
    await restarted.service.check(T0 + 2 * H);
    expect(restarted.mail.sendAlert).not.toHaveBeenCalled();
    expect(restarted.notifications.sendPushToTenant).not.toHaveBeenCalled();
    expect(restarted.registry.snapshot(T0 + 2 * H)).toMatchObject({ level: 'ORANGE', wgUnknownDeliveryAfterRestart: 1, wgAlertsCreated: 0 });

    // 4-5. Handshake sain : staleAlertedAt remis à null, registre résolu (plus d'inconnu).
    const fresh = Math.floor((T0 + 3 * H) / 1000);
    const healthy = setup([stale], { [KEY]: { latestHandshake: fresh } }, true, '', [], restarted.registry);
    expect(await healthy.service.check(T0 + 3 * H)).toEqual({ alerted: 0, resolved: 1 });
    expect(healthy.prisma.remotePeer.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { staleAlertedAt: null } });
    expect(healthy.registry.snapshot(T0 + 3 * H)).toMatchObject({ level: 'GREEN', wgUnknownDeliveryAfterRestart: 0, wgOpenNoProviderAcceptedOver1h: 0 });

    // 6-7. Nouvelle inactivité de 24 h (staleAlertedAt nul) : une seule nouvelle tentative, comptée comme nouvelle alerte.
    const relapse = setup([peer({ staleAlertedAt: null, lastHandshakeAt: new Date(T0 + 3 * H) })], {}, true, 'ops@example.test', [], restarted.registry);
    expect((await relapse.service.check(T0 + 3 * H + DAY + H)).alerted).toBe(1);
    expect(relapse.mail.sendAlert).toHaveBeenCalledTimes(1);
    expect(relapse.notifications.sendPushToTenant).toHaveBeenCalledTimes(1);
    const snap = relapse.registry.snapshot(T0 + 3 * H + DAY + H);
    expect(snap).toMatchObject({ wgAlertsCreated: 1, wgNoProviderAccepted: 0, wgEmailProviderAccepted: 1, wgUnknownDeliveryAfterRestart: 0 });
  });
});
