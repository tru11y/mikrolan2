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
    createdAt: new Date(NOW - 15 * 60_000),
    expiresAt: new Date(NOW + 29 * 86_400_000),
    user: { id: 'u1', tenantId: 't1', role: 'OWNER', status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
    ...over,
  };
}

function setup(
  found: unknown,
  opts: {
    claimCount?: number;
    successorCreatedAt?: Date | null;
    successorRevoked?: boolean;
  } = {},
) {
  const rows: Array<{ id: string; revoked: boolean }> = [];
  const successor =
    opts.successorCreatedAt === undefined || opts.successorCreatedAt === null
      ? null
      : { id: 'rt-succ', createdAt: opts.successorCreatedAt, revoked: opts.successorRevoked ?? false };
  const prisma = {
    refreshToken: {
      findUnique: jest.fn().mockResolvedValue(found),
      findFirst: jest.fn().mockResolvedValue(successor),
      updateMany: jest.fn().mockImplementation(({ where }: { where: { id?: string; family?: string } }) =>
        Promise.resolve({ count: where.id ? (opts.claimCount ?? 1) : 2 }),
      ),
      create: jest.fn().mockImplementation(({ data }: { data: { id?: string } }) => {
        rows.push({ id: data.id ?? 'new', revoked: false });
        return Promise.resolve({});
      }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ tenantId: 't1' }) },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed-access') };
  const config = { get: jest.fn().mockImplementation((k: string) => (k === 'JWT_ACCESS_TTL' ? 900 : k === 'JWT_REFRESH_TTL' ? 2592000 : 'secret')) };
  const events = { record: jest.fn() };
  const service = new TokenService(prisma as never, jwt as never, config as never, events as unknown as AuthEventsService);
  return { service, prisma, events };
}

const names = (events: { record: jest.Mock }) => events.record.mock.calls.map((c) => c[0] as string);

describe('TokenService.rotate — événements', () => {
  it('rotation normale : REFRESH_ROTATED puis REFRESH_SUCCESS, sans révocation de famille', async () => {
    const { service, events } = setup(record());
    await service.rotate('RAW-A');
    expect(names(events)).toEqual(['REFRESH_ROTATED', 'REFRESH_SUCCESS']);
    expect(events.record.mock.calls[0][1].extra.tokenAgeMs).toBeGreaterThan(14 * 60_000);
  });

  // Cas 1 (réponse perdue) : l'ancien jeton est rejoué quelques secondes après la rotation,
  // le successeur n'a pas servi → RÉCUPÉRATION dans la fenêtre de grâce, sans révocation.
  it('rejeu quelques secondes plus tard, successeur inutilisé : récupération (rotation_recovered), famille non révoquée', async () => {
    const { service, events, prisma } = setup(record({ revoked: true }), { successorCreatedAt: new Date(NOW - 4_000) });
    const pair = await service.rotate('RAW-A');
    expect(pair.accessToken).toBe('signed-access');
    expect(names(events)).toEqual(['REFRESH_ROTATED', 'REFRESH_SUCCESS']);
    expect(events.record.mock.calls[0][1].cause).toBe('rotation_recovered');
    // le successeur est réclamé atomiquement, jamais la famille
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { id: 'rt-succ', revoked: false }, data: { revoked: true } });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalledWith({ where: { family: FAMILY, revoked: false }, data: { revoked: true } });
  });

  it('rejeu dans la grâce mais successeur déjà consommé (vrai vol) : famille révoquée', async () => {
    const { service, events } = setup(record({ revoked: true }), { successorCreatedAt: new Date(NOW - 4_000), successorRevoked: true });
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    expect(names(events)).toEqual(['REFRESH_REUSE_DETECTED', 'REFRESH_FAMILY_REVOKED']);
    expect(events.record.mock.calls[0][1].cause).toBe('replay_of_revoked_token');
  });

  it('rejeu dans la grâce mais claim perdu (rejeu concurrent) : famille révoquée', async () => {
    const { service, events } = setup(record({ revoked: true }), { successorCreatedAt: new Date(NOW - 4_000), claimCount: 0 });
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    expect(names(events)).toEqual(['REFRESH_REUSE_DETECTED', 'REFRESH_FAMILY_REVOKED']);
  });

  it('rejeu bien plus tard (vol probable) : hors fenêtre de grâce → famille révoquée, replayDelayMs de plusieurs jours', async () => {
    const { service, events } = setup(record({ revoked: true }), { successorCreatedAt: new Date(NOW - 3 * 86_400_000) });
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    expect(names(events)).toEqual(['REFRESH_REUSE_DETECTED', 'REFRESH_FAMILY_REVOKED']);
    expect(events.record.mock.calls[0][1].extra.replayDelayMs).toBeGreaterThan(2 * 86_400_000);
  });

  // Cas 4 (deux refresh simultanés) : le perdant de la consommation atomique révoque la famille du gagnant.
  it('deux rafraîchissements simultanés : le perdant déclenche REFRESH_REUSE_DETECTED (concurrent_refresh) et révoque la famille', async () => {
    const { service, events } = setup(record(), { claimCount: 0 });
    await expect(service.rotate('RAW-A')).rejects.toBeDefined();
    expect(names(events)).toEqual(['REFRESH_REUSE_DETECTED', 'REFRESH_FAMILY_REVOKED']);
    expect(events.record.mock.calls[0][1].cause).toBe('concurrent_refresh');
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
    const { service, events } = setup(record({ revoked: true }), { successorCreatedAt: new Date(NOW - 1000), successorRevoked: true });
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
