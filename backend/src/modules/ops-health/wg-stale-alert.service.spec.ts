import { WgStaleAlertService } from './wg-stale-alert.service';

jest.mock('@sentry/node', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

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

function setup(peers: unknown[], live: Record<string, { latestHandshake: number }> | Error, enabled = true) {
  const prisma = {
    remotePeer: {
      findMany: jest.fn().mockResolvedValue(peers),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const wg = {
    enabled,
    livePeers: jest.fn().mockImplementation(async () => {
      if (live instanceof Error) throw live;
      return live;
    }),
  };
  const mail = { sendAlert: jest.fn().mockResolvedValue(undefined) };
  const notifications = { sendPushToTenant: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue('ops@example.test') };
  const service = new WgStaleAlertService(prisma as never, wg as never, mail as never, notifications as never, config as never);
  return { service, prisma, wg, mail, notifications };
}

describe('WgStaleAlertService.check', () => {
  it('peer sans handshake depuis 30 h : alerte e-mail + push, épisode marqué', async () => {
    const { service, prisma, mail, notifications } = setup([peer()], {});
    expect(await service.check(T0)).toEqual({ alerted: 1, resolved: 0 });
    expect(prisma.remotePeer.updateMany).toHaveBeenCalledTimes(1);
    expect(mail.sendAlert).toHaveBeenCalledWith('ops@example.test', 'Tunnel WireGuard injoignable', expect.stringContaining('FREEDOM'));
    expect(notifications.sendPushToTenant).toHaveBeenCalledWith('t1', 'Routeur injoignable', expect.stringContaining('30 h'), 'r1');
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
