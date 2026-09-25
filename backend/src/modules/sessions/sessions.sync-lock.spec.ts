import { Logger } from '@nestjs/common';
import { SessionsService } from './sessions.service';

const mockPrisma = {
  router: { findMany: jest.fn() },
  session: { findMany: jest.fn().mockResolvedValue([]) },
  voucher: { findMany: jest.fn().mockResolvedValue([]) },
};
const mockRemote = { run: jest.fn() };
const mockEvents = { publish: jest.fn() };
const mockNotifications = { sendPushToTenant: jest.fn() };

const build = () =>
  new SessionsService(
    mockPrisma as never,
    mockRemote as never,
    mockEvents as never,
    mockNotifications as never,
  );

const R1 = { id: 'r1', tenantId: 't1' };
const R2 = { id: 'r2', tenantId: 't1' };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

let warn: jest.SpyInstance;
let log: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.router.findMany.mockResolvedValue([R1]);
  mockPrisma.session.findMany.mockResolvedValue([]);
  mockPrisma.voucher.findMany.mockResolvedValue([]);
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const logged = (spy: jest.SpyInstance) => spy.mock.calls.map((c) => String(c[0]));

describe('syncActivations — anti-chevauchement', () => {
  it('deux ticks simultanés : le second est ignoré (une seule lecture RouterOS)', async () => {
    const svc = build();
    const read = deferred<never[]>();
    mockRemote.run.mockReturnValue(read.promise);

    const first = svc.syncActivations();
    await flush();
    await svc.syncActivations(); // second tick, pendant le premier
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    expect(logged(warn).some((m) => m.startsWith('sync tick SKIPPED_ALREADY_RUNNING'))).toBe(true);

    read.resolve([]);
    await first;

    // le verrou est libéré : le tick suivant repart normalement
    mockRemote.run.mockResolvedValue([]);
    await svc.syncActivations();
    expect(mockRemote.run).toHaveBeenCalledTimes(2);
  });

  it('deux traitements simultanés du même routeur : un seul accès RouterOS', async () => {
    const svc = build();
    const read = deferred<never[]>();
    mockRemote.run.mockReturnValue(read.promise);
    const sync = (svc as unknown as {
      syncRouter: (r: typeof R1) => Promise<'ok' | 'failed' | 'skipped'>;
    }).syncRouter.bind(svc);

    const a = sync(R1);
    await flush();
    const b = await sync(R1);
    expect(b).toBe('skipped');
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    expect(logged(warn).some((m) => m.startsWith('sync router SKIPPED_ALREADY_RUNNING'))).toBe(true);

    read.resolve([]);
    expect(await a).toBe('ok');
  });

  it('routeurs distincts : traités l\'un après l\'autre, jamais en parallèle (comportement historique)', async () => {
    mockPrisma.router.findMany.mockResolvedValue([R1, R2]);
    const svc = build();
    const gates = [deferred<never[]>(), deferred<never[]>()];
    mockRemote.run.mockReturnValueOnce(gates[0].promise).mockReturnValueOnce(gates[1].promise);

    const tick = svc.syncActivations();
    await flush();
    expect(mockRemote.run).toHaveBeenCalledTimes(1);
    gates[0].resolve([]);
    await flush();
    expect(mockRemote.run).toHaveBeenCalledTimes(2);
    gates[1].resolve([]);
    await tick;
  });

  it('routeur bloqué : le verrou est libéré après le délai maximal et le tick suivant repart', async () => {
    jest.useFakeTimers();
    const svc = build();
    mockRemote.run.mockReturnValue(new Promise(() => undefined)); // ne répond jamais

    const tick = svc.syncActivations();
    await jest.advanceTimersByTimeAsync(90_000);
    await tick;
    expect(logged(warn).some((m) => m.startsWith('Activation sync failed for router r1'))).toBe(true);
    expect(logged(log).some((m) => /^sync tick END .*failed=1/.test(m))).toBe(true);

    mockRemote.run.mockResolvedValue([]);
    await svc.syncActivations();
    expect(mockRemote.run).toHaveBeenCalledTimes(2);
  });

  it('exception : verrous (tick et routeur) libérés, échec journalisé avec le message historique', async () => {
    const svc = build();
    mockRemote.run.mockRejectedValueOnce(new Error('Routeur injoignable via le tunnel'));

    await svc.syncActivations();
    expect(logged(warn)).toContain(
      'Activation sync failed for router r1: Routeur injoignable via le tunnel',
    );

    mockRemote.run.mockResolvedValue([]);
    await svc.syncActivations();
    expect(mockRemote.run).toHaveBeenCalledTimes(2);
  });

  it('journaux mesurables : tick START/END, routeur START/END avec durée et statut', async () => {
    const svc = build();
    mockRemote.run.mockResolvedValue([]);
    await svc.syncActivations();
    const lines = logged(log);
    expect(lines).toContain('sync tick START routers=1');
    expect(lines.some((m) => /^sync router START routerId=r1$/.test(m))).toBe(true);
    expect(lines.some((m) => /^sync router END routerId=r1 status=ok durationMs=\d+$/.test(m))).toBe(true);
    expect(lines.some((m) => /^sync tick END routers=1 ok=1 failed=0 skipped=0 durationMs=\d+$/.test(m))).toBe(true);
  });

  it('les paramètres de lecture RouterOS sont inchangés (retries: 1)', async () => {
    const svc = build();
    mockRemote.run.mockResolvedValue([]);
    await svc.syncActivations();
    expect(mockRemote.run).toHaveBeenCalledWith('r1', expect.any(Function), { retries: 1 });
  });
});
