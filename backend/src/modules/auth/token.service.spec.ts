import { createHash } from 'node:crypto';
import { TokenService } from './token.service';
import type { AuthEventsService } from './auth-events.service';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const NOW = Date.now();
const FAMILY = 'fam-1';

function record(over: Record<string, unknown> = {}) {
  return {
    id: 'rt-1',
    userId: 'u1',
    family: FAMILY,
    tokenHash: sha('RAW-A'),
    revoked: false,
    rotatedAt: null,
    graceExpiresAt: null,
    createdAt: new Date(NOW - 15 * 60_000),
    expiresAt: new Date(NOW + 29 * 86_400_000),
    user: { id: 'u1', tenantId: 't1', role: 'OWNER', status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
    ...over,
  };
}

interface Opts {
  claimCount?: number;
  successor?: { createdAt: Date; revoked?: boolean } | null;
  fresh?: unknown;
  grace?: number;
}

function setup(found: unknown, opts: Opts = {}) {
  const findUnique = jest.fn();
  findUnique.mockResolvedValue(found);
  if (opts.fresh !== undefined) findUnique.mockResolvedValueOnce(found).mockResolvedValueOnce(opts.fresh);
  const prisma = {
    refreshToken: {
      findUnique,
      findFirst: jest.fn().mockResolvedValue(opts.successor ?? null),
      updateMany: jest.fn().mockImplementation(({ where }: { where: { id?: string; family?: string } }) =>
        Promise.resolve({ count: where.id ? (opts.claimCount ?? 1) : 2 }),
      ),
      create: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ tenantId: 't1' }) },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-access') };
  const grace = opts.grace ?? 120;
  const config = {
    get: jest.fn().mockImplementation((k: string) =>
      k === 'JWT_ACCESS_TTL' ? 900 : k === 'JWT_REFRESH_TTL' ? 2592000 : k === 'AUTH_REFRESH_GRACE_SECONDS' ? grace : 'secret',
    ),
  };
  const events = { record: jest.fn() };
  const service = new TokenService(prisma as never, jwt as never, config as never, events as unknown as AuthEventsService);
  return { service, prisma, events };
}

const names = (events: { record: jest.Mock }) => events.record.mock.calls.map((c) => c[0] as string);

describe('TokenService.rotate — événements', () => {
  it('rotation normale : REFRESH_ROTATED puis REFRESH_SUCCESS, sans révocation de famille', async () => {
    const { service, events, prisma } = setup(record());
    await service.rotate('RAW-A');
    expect(names(events)).toEqual(['REFRESH_ROTATED', 'REFRESH_SUCCESS']);
    expect(events.record.mock.calls[0][1].extra.tokenAgeMs).toBeGreaterThan(14 * 60_000);
    // La consommation ouvre la fenêtre de grâce (rotatedAt + graceExpiresAt).
    const claim = prisma.refreshToken.updateMany.mock.calls[0][0];
    expect(claim.data.revoked).toBe(true);
    expect(claim.data.graceExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  // Cas 1 (réponse perdue) : l'ancien jeton rejoué dans la grâce, successeur non consommé → toléré.
  it('rejeu dans la fenêtre de grâce, successeur non utilisé : REFRESH_GRACE_REPLAY, famille préservée, nouveaux jetons', async () => {
    const { service, events, prisma } = setup(
      record({ revoked: true, graceExpiresAt: new Date(NOW + 90_000) }),
      { successor: { createdAt: new Date(NOW - 4_000), revoked: false } },
    );
    const next = await service.rotate('RAW-A');
    expect(next.accessToken).toBe('signed-access');
    expect(names(events)).toEqual(['REFRESH_GRACE_REPLAY', 'REFRESH_SUCCESS']);
    expect(events.record.mock.calls[0][1].extra.replayDelayMs).toBeGreaterThanOrEqual(4_000);
    // Aucune révocation de famille.
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { family: FAMILY, revoked: false } }),
    );
  });

  it('rejeu dans la grâce mais successeur déjà utilisé (révoqué) : vol → famille révoquée', async () => {
    const { service, events } = setup(
      record({ revoked: true, graceExpiresAt: new Date(NOW + 90_000) }),
      { successor: { createdAt: new Date(NOW - 4_000), revoked: true } },
    );
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    expect(names(events)).toEqual(['REFRESH_REUSE_DETECTED', 'REFRESH_FAMILY_REVOKED']);
    expect(events.record.mock.calls[0][1].cause).toBe('replay_of_revoked_token');
  });

  it('rejeu hors fenêtre de grâce (vol probable) : famille révoquée, replayDelayMs de plusieurs jours', async () => {
    const { service, events } = setup(
      record({ revoked: true, graceExpiresAt: new Date(NOW - 86_400_000) }),
      { successor: { createdAt: new Date(NOW - 3 * 86_400_000), revoked: false } },
    );
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    expect(names(events)).toEqual(['REFRESH_REUSE_DETECTED', 'REFRESH_FAMILY_REVOKED']);
    expect(events.record.mock.calls[0][1].extra.replayDelayMs).toBeGreaterThan(2 * 86_400_000);
  });

  it('grâce désactivée (AUTH_REFRESH_GRACE_SECONDS=0) : tout rejeu révoque la famille (comportement strict)', async () => {
    const { service, events } = setup(
      record({ revoked: true, graceExpiresAt: new Date(NOW + 90_000) }),
      { successor: { createdAt: new Date(NOW - 4_000), revoked: false }, grace: 0 },
    );
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    expect(names(events)).toEqual(['REFRESH_REUSE_DETECTED', 'REFRESH_FAMILY_REVOKED']);
  });

  // Cas 4 (deux refresh simultanés dans la grâce) : le perdant obtient de nouveaux jetons, pas une révocation.
  it('deux rafraîchissements simultanés dans la grâce : le perdant déclenche REFRESH_GRACE_REPLAY, famille préservée', async () => {
    const fresh = record({ revoked: true, graceExpiresAt: new Date(NOW + 90_000) });
    const { service, events, prisma } = setup(record(), {
      claimCount: 0,
      fresh,
      successor: { createdAt: new Date(NOW - 500), revoked: false },
    });
    const next = await service.rotate('RAW-A');
    expect(next.accessToken).toBe('signed-access');
    expect(names(events)).toEqual(['REFRESH_GRACE_REPLAY', 'REFRESH_SUCCESS']);
    expect(events.record.mock.calls[0][1].cause).toBe('concurrent_refresh');
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { family: FAMILY, revoked: false } }),
    );
  });

  it('refresh expiré : REFRESH_EXPIRED, famille non révoquée', async () => {
    const { service, events } = setup(record({ expiresAt: new Date(NOW - 1000), createdAt: new Date(NOW - 31 * 86_400_000) }));
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    expect(names(events)).toEqual(['REFRESH_EXPIRED']);
    expect(events.record.mock.calls[0][1].extra.tokenAgeMs).toBeGreaterThan(30 * 86_400_000);
  });

  it('jeton inconnu : REFRESH_INVALID sans identifiant', async () => {
    const { service, events } = setup(null);
    await expect(service.rotate('RAW-ZZ')).rejects.toBeDefined();
    expect(events.record).toHaveBeenCalledWith('REFRESH_INVALID', { cause: 'unknown_token' });
  });

  it('compte désactivé : famille révoquée avec la cause account_disabled', async () => {
    const { service, events } = setup(record({ user: { id: 'u1', tenantId: 't1', role: 'OWNER', status: 'SUSPENDED', tenant: { status: 'ACTIVE' } } }));
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    expect(names(events)).toEqual(['REFRESH_FAMILY_REVOKED']);
    expect(events.record.mock.calls[0][1].cause).toBe('account_disabled');
  });

  it('aucun événement ne contient le jeton brut ni son empreinte', async () => {
    const { service, events } = setup(record({ revoked: true, graceExpiresAt: new Date(NOW - 1000) }), {
      successor: { createdAt: new Date(NOW - 1000), revoked: false },
    });
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    const dump = JSON.stringify(events.record.mock.calls);
    expect(dump).not.toContain('RAW-A');
    expect(dump).not.toContain(sha('RAW-A'));
  });
});

describe('TokenService.revoke / recordSessionEvent', () => {
  it('déconnexion utilisateur : LOGOUT_USER', async () => {
    const { service, events } = setup({ userId: 'u1', family: FAMILY, user: { tenantId: 't1' } });
    await service.revoke('RAW-A');
    expect(events.record).toHaveBeenCalledWith('LOGOUT_USER', expect.objectContaining({ userId: 'u1', tenantId: 't1', familyId: FAMILY, cause: 'user_logout' }));
  });

  it('événement de révocation globale : tenant retrouvé puis journalisé', async () => {
    const { service, events } = setup(null);
    service.recordSessionEvent('LOGOUT_ALL_SESSIONS', 'u1', 'user_logout_all');
    await new Promise((r) => setImmediate(r));
    expect(events.record).toHaveBeenCalledWith('LOGOUT_ALL_SESSIONS', { userId: 'u1', tenantId: 't1', cause: 'user_logout_all', extra: undefined });
  });
});
