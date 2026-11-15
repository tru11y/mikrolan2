import { Logger } from '@nestjs/common';
import { AuthEventsService, authRef } from './auth-events.service';

const USER = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const T0 = new Date('2026-11-15T10:00:00.000Z');

function setup(createImpl?: () => Promise<unknown>) {
  const prisma = {
    auditLog: {
      create: jest.fn().mockImplementation(createImpl ?? (() => Promise.resolve({}))),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new AuthEventsService(prisma as never);
  const lines: string[] = [];
  jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void lines.push(String(m)));
  jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void lines.push(String(m)));
  return { prisma, service, lines };
}

afterEach(() => jest.restoreAllMocks());

describe('AuthEventsService.record', () => {
  it('ne journalise ni identifiant brut utilisateur/tenant ni secret : seulement des références', () => {
    const { service, lines } = setup();
    service.record('REFRESH_SUCCESS', { userId: USER, tenantId: TENANT, familyId: FAMILY, cause: 'rotation', extra: { tokenAgeMs: 900000 } }, T0);
    const out = lines.join('\n');
    expect(out).not.toContain(USER);
    expect(out).not.toContain(TENANT);
    expect(out).toContain(authRef(USER));
    expect(out).toContain(authRef(TENANT));
    expect(out).toContain(FAMILY);
    expect(out).toContain('"event":"REFRESH_SUCCESS"');
    expect(out).not.toMatch(/token":|password|email|authorization|bearer/i);
  });

  it('les événements critiques sont persistés avec un niveau WARNING ; les autres non', async () => {
    const { service, prisma } = setup();
    service.record('REFRESH_REUSE_DETECTED', { userId: USER, tenantId: TENANT, familyId: FAMILY, cause: 'replay_of_revoked_token', extra: { replayDelayMs: 4200 } }, T0);
    service.record('REFRESH_SUCCESS', { userId: USER, tenantId: TENANT, familyId: FAMILY, cause: 'rotation' }, T0);
    service.record('LOGOUT_USER', { userId: USER, tenantId: TENANT, familyId: FAMILY, cause: 'user_logout' }, T0);
    await new Promise((r) => setImmediate(r));
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const data = prisma.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: TENANT, entityType: 'AuthSession', entityId: FAMILY, outcome: 'WARNING', action: 'REVOKE' });
    expect(data.metadata).toMatchObject({ event: 'REFRESH_REUSE_DETECTED', replayDelayMs: 4200 });
    // La colonne `userId` (clé étrangère interne) reste brute ; le JSON `metadata` n'expose que des références.
    expect(JSON.stringify(data.metadata)).not.toContain(USER);
    expect(JSON.stringify(data.metadata)).not.toContain(TENANT);
  });

  it('sans tenant connu : journalisé mais pas persisté', async () => {
    const { service, prisma } = setup();
    service.record('PASSWORD_CHANGED', { cause: 'reset_password' }, T0);
    await new Promise((r) => setImmediate(r));
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('un échec d’écriture ou de journalisation ne casse jamais l’authentification', async () => {
    const { service } = setup(() => Promise.reject(new Error('db down')));
    expect(() => service.record('REFRESH_FAMILY_REVOKED', { userId: USER, tenantId: TENANT, cause: 'reuse' }, T0)).not.toThrow();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
      throw new Error('logger down');
    });
    expect(() => service.record('REFRESH_FAMILY_REVOKED', { userId: USER, tenantId: TENANT, cause: 'reuse' }, T0)).not.toThrow();
  });
});

describe('AuthEventsService.metrics', () => {
  it('compteurs 24 h : fenêtre glissante, les événements plus vieux que 24 h sont écartés', async () => {
    const { service } = setup();
    service.record('REFRESH_SUCCESS', { cause: 'rotation' }, new Date(T0.getTime() - 25 * 3_600_000));
    service.record('REFRESH_SUCCESS', { cause: 'rotation' }, new Date(T0.getTime() - 3_600_000));
    service.record('REFRESH_SUCCESS', { cause: 'rotation' }, T0);
    service.record('REFRESH_INVALID', { cause: 'unknown_token' }, T0);
    const m = await service.metrics(T0);
    expect(m.refreshSuccess24h).toBe(2);
    expect(m.refreshInvalid24h).toBe(1);
    expect(m.windowHours).toBe(24);
  });

  it('compteurs persistants lus dans le journal d’audit, par événement', async () => {
    const { service, prisma } = setup();
    prisma.auditLog.count.mockImplementation(({ where }: { where: { metadata: { equals: string } } }) =>
      Promise.resolve(where.metadata.equals === 'REFRESH_REUSE_DETECTED' ? 3 : where.metadata.equals === 'LOGOUT_ALL_SESSIONS' ? 5 : 0),
    );
    const m = await service.metrics(T0);
    expect(m.refreshReuseDetected24h).toBe(3);
    expect(m.logoutAllSessions24h).toBe(5);
    expect(m.refreshFamilyRevoked24h).toBe(0);
    expect(prisma.auditLog.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityType: 'AuthSession', metadata: { path: ['event'], equals: 'REFRESH_REUSE_DETECTED' } }) }),
    );
  });
});
