import { makeEventLogStub } from '../../common/testing/event-log.stub';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ManagementMode, Prisma } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getTenantContext } from '../../common/context/tenant-context';
import { RoutersService } from './routers.service';
import { RoutersController } from './routers.controller';
import { RolesGuard } from '../../common/guards/roles.guard';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'ADMIN',
  })),
}));

function makePrisma() {
  return {
    router: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
    },
    remotePeer: { findFirst: jest.fn().mockResolvedValue(null), deleteMany: jest.fn() },
    plan: { deleteMany: jest.fn() },
    voucher: { deleteMany: jest.fn() },
    session: { deleteMany: jest.fn() },
    auditLog: { create: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<void>) =>
      fn({
        session: { deleteMany: jest.fn() },
        voucher: { deleteMany: jest.fn() },
        plan: { deleteMany: jest.fn() },
        remotePeer: { deleteMany: jest.fn() },
        auditLog: { deleteMany: jest.fn() },
        router: { delete: jest.fn() },
      }),
    ),
  } as unknown;
}

function makeCrypto() {
  return { encrypt: jest.fn(() => 'encrypted'), decrypt: jest.fn() } as unknown;
}

function makeSubs() {
  return {
    isRemoteAllowed: jest.fn().mockResolvedValue(true),
    getEntitlement: jest.fn().mockResolvedValue({ routerLimit: null }),
  } as unknown;
}

function makeWg() {
  return { removePeer: jest.fn(), removeDnat: jest.fn() } as unknown;
}

function makeService() {
  const prisma = makePrisma() as any;
  const crypto = makeCrypto() as any;
  const subs = makeSubs() as any;
  const wg = makeWg() as any;
  const eventLog = makeEventLogStub();
  return {
    service: new RoutersService(prisma, crypto, subs, wg, eventLog as any),
    prisma,
    subs,
    crypto,
    eventLog,
  };
}

const ROUTER = {
  id: 'r1',
  identity: 'MikroTik-01',
  alias: 'Café',
  model: 'RB750',
  localAddress: '192.168.88.1',
  mode: ManagementMode.LOCAL,
  health: 'UNKNOWN',
  lastHeartbeat: null,
  ticketTemplate: null,
  pushNotifications: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('RoutersService', () => {
  describe('findAll', () => {
    it('returns all non-deleted routers', async () => {
      const { service, prisma } = makeService();
      prisma.router.findMany.mockResolvedValue([ROUTER]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].identity).toBe('MikroTik-01');
    });
  });

  describe('findOne', () => {
    it('returns a router', async () => {
      const { service, prisma } = makeService();
      prisma.router.findFirst.mockResolvedValue(ROUTER);

      const result = await service.findOne('r1');
      expect(result.alias).toBe('Café');
    });

    it('throws 404 if not found', async () => {
      const { service, prisma } = makeService();
      prisma.router.findFirst.mockResolvedValue(null);

      await expect(service.findOne('bad')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('create', () => {
    it('creates a LOCAL router', async () => {
      const { service, prisma } = makeService();
      prisma.router.findFirst.mockResolvedValue(null);
      prisma.router.create.mockResolvedValue(ROUTER);

      const result = await service.create({
        identity: 'MikroTik-01',
        localAddress: '192.168.88.1',
        mode: ManagementMode.LOCAL,
      });

      expect(result.identity).toBe('MikroTik-01');
    });

    it('throws ConflictException on duplicate identity', async () => {
      const { service, prisma } = makeService();
      prisma.router.findFirst.mockResolvedValue(null);
      const err = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5',
      });
      prisma.router.create.mockRejectedValue(err);

      await expect(
        service.create({
          identity: 'MikroTik-01',
          localAddress: '192.168.88.1',
          mode: ManagementMode.LOCAL,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('enforces router limit', async () => {
      const { service, prisma, subs } = makeService();
      subs.getEntitlement.mockResolvedValue({ routerLimit: 3 });
      prisma.router.count.mockResolvedValue(3);

      await expect(
        service.create({
          identity: 'New',
          localAddress: '192.168.88.2',
          mode: ManagementMode.LOCAL,
        }),
      ).rejects.toThrow(HttpException);
    });

    it('blocks REMOTE mode without PRO subscription', async () => {
      const { service, subs } = makeService();
      subs.isRemoteAllowed.mockResolvedValue(false);

      await expect(
        service.create({
          identity: 'Remote-01',
          localAddress: '10.0.0.1',
          mode: ManagementMode.REMOTE,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('update', () => {
    it('updates alias', async () => {
      const { service, prisma } = makeService();
      prisma.router.findFirst.mockResolvedValue(ROUTER);
      prisma.router.update.mockResolvedValue({});

      const updated = { ...ROUTER, alias: 'New Alias' };
      prisma.router.findFirst
        .mockResolvedValueOnce(ROUTER)
        .mockResolvedValueOnce(updated);

      const result = await service.update('r1', { alias: 'New Alias' });
      expect(prisma.router.update).toHaveBeenCalled();
    });
  });
});

describe('RoutersService — credentials RouterOS côté serveur', () => {
  const CREDS = { username: 'admin', password: 'S3cret-pass!' };

  it('création avec credentials → credEncrypted chiffré, jamais de plaintext en base', async () => {
    const { service, prisma, crypto } = makeService();
    prisma.router.findFirst.mockResolvedValue(null);
    prisma.router.create.mockResolvedValue({ ...ROUTER, credEncrypted: 'encrypted' });

    const result = await service.create({
      identity: 'MikroTik-01',
      localAddress: '192.168.88.1',
      mode: ManagementMode.LOCAL,
      credentials: CREDS,
    });

    expect(crypto.encrypt).toHaveBeenCalledWith(JSON.stringify(CREDS));
    const written = prisma.router.create.mock.calls[0][0];
    expect(written.data.credEncrypted).toBe('encrypted');
    expect(JSON.stringify(written)).not.toContain(CREDS.password);
    expect(result.hasCredentials).toBe(true);
    expect(JSON.stringify(result)).not.toContain(CREDS.password);
    expect('credEncrypted' in result).toBe(false);
  });

  it('routeur sans credentials → hasCredentials=false', async () => {
    const { service, prisma } = makeService();
    prisma.router.findFirst.mockResolvedValue({ ...ROUTER, credEncrypted: null });

    expect((await service.findOne('r1')).hasCredentials).toBe(false);
  });

  it('findAll/findOne ne renvoient jamais credEncrypted', async () => {
    const { service, prisma } = makeService();
    prisma.router.findMany.mockResolvedValue([{ ...ROUTER, credEncrypted: 'blob' }]);
    prisma.router.findFirst.mockResolvedValue({ ...ROUTER, credEncrypted: 'blob' });

    const [listed] = await service.findAll();
    const one = await service.findOne('r1');
    for (const r of [listed, one]) {
      expect('credEncrypted' in r).toBe(false);
      expect(r.hasCredentials).toBe(true);
    }
  });

  it('reconfiguration → credEncrypted remplacé par le nouveau chiffré', async () => {
    const { service, prisma, crypto } = makeService();
    crypto.encrypt.mockReturnValue('encrypted-v2');
    prisma.router.findFirst.mockResolvedValue({ ...ROUTER, credEncrypted: 'encrypted-v2' });
    prisma.router.update.mockResolvedValue({});

    await service.update('r1', { credentials: CREDS });

    const data = prisma.router.update.mock.calls[0][0].data;
    expect(data.credEncrypted).toBe('encrypted-v2');
    expect(JSON.stringify(data)).not.toContain(CREDS.password);
  });

  it('credentials: null → efface credEncrypted', async () => {
    const { service, prisma } = makeService();
    prisma.router.findFirst.mockResolvedValue({ ...ROUTER, credEncrypted: null });
    prisma.router.update.mockResolvedValue({});

    await service.update('r1', { credentials: null });

    expect(prisma.router.update.mock.calls[0][0].data.credEncrypted).toBeNull();
  });

  it('routeur d’un autre tenant (invisible) → 404, aucune écriture ni lecture de secret', async () => {
    const { service, prisma, crypto } = makeService();
    prisma.router.findFirst.mockResolvedValue(null);

    await expect(service.update('other', { credentials: CREDS })).rejects.toMatchObject({ status: 404 });
    await expect(service.getCredentials('other')).rejects.toMatchObject({ status: 404 });
    expect(prisma.router.update).not.toHaveBeenCalled();
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });
});

describe('GET /routers/:id/credentials — restauration LAN (ADMIN)', () => {
  const SECRET = { username: 'admin', password: 'S3cret-pass!' };

  function ctxFor(role: UserRole): ExecutionContext {
    return {
      getHandler: () => RoutersController.prototype.getCredentials,
      getClass: () => RoutersController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role, tenantId: 'tenant-1' } }) }),
    } as unknown as ExecutionContext;
  }

  it('ADMIN du bon tenant → accès autorisé, secret renvoyé, lecture filtrée par tenantId', async () => {
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(ctxFor(UserRole.ADMIN))).toBe(true);
    expect(guard.canActivate(ctxFor(UserRole.OWNER))).toBe(true);

    const { service, prisma, crypto } = makeService();
    crypto.decrypt.mockReturnValue(JSON.stringify(SECRET));
    prisma.router.findFirst.mockResolvedValue({ id: 'r1', credEncrypted: 'blob', localAddress: '192.168.88.1:8728' });

    const res = await service.getCredentials('r1');

    expect(res).toEqual({ ...SECRET, host: '192.168.88.1:8728' });
    expect(prisma.router.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'r1', tenantId: 'tenant-1' });
  });

  it('utilisateur non ADMIN (MEMBER) → refusé', () => {
    const guard = new RolesGuard(new Reflector());
    expect(() => guard.canActivate(ctxFor(UserRole.MEMBER))).toThrow();
  });

  it('ADMIN d’un autre tenant → 404, aucun déchiffrement ni audit', async () => {
    const { service, prisma, crypto, eventLog } = makeService();
    prisma.router.findFirst.mockResolvedValue(null);

    await expect(service.getCredentials('foreign')).rejects.toMatchObject({ status: 404 });
    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(eventLog.emit).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN sans tenant → 404, aucune lecture ni déchiffrement ni audit', async () => {
    (getTenantContext as jest.Mock).mockReturnValueOnce({ tenantId: undefined, userId: 'sa', role: 'SUPER_ADMIN' });
    const { service, prisma, crypto, eventLog } = makeService();
    prisma.router.findFirst.mockResolvedValue({ id: 'r1', credEncrypted: 'blob', localAddress: null });

    await expect(service.getCredentials('r1')).rejects.toMatchObject({ status: 404 });
    expect(prisma.router.findFirst).not.toHaveBeenCalled();
    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(eventLog.emit).not.toHaveBeenCalled();
  });

  it('lecture réussie → audit DOWNLOAD créé', async () => {
    const { service, prisma, crypto, eventLog } = makeService();
    crypto.decrypt.mockReturnValue(JSON.stringify(SECRET));
    prisma.router.findFirst.mockResolvedValue({ id: 'r1', credEncrypted: 'blob', localAddress: null });

    await service.getCredentials('r1');

    expect(eventLog.emit).toHaveBeenCalledTimes(1);
    expect(eventLog.emit.mock.calls[0][0]).toMatchObject({
      action: 'DOWNLOAD',
      entityType: 'Router',
      entityId: 'r1',
      outcome: 'SUCCESS',
    });
  });

  it('l’audit ne contient jamais le password ni le username', async () => {
    const { service, prisma, crypto, eventLog } = makeService();
    crypto.decrypt.mockReturnValue(JSON.stringify(SECRET));
    prisma.router.findFirst.mockResolvedValue({ id: 'r1', credEncrypted: 'blob', localAddress: null });

    await service.getCredentials('r1');

    const logged = JSON.stringify(eventLog.emit.mock.calls);
    expect(logged).not.toContain(SECRET.password);
    expect(logged).not.toContain(SECRET.username);
  });

  it('routeur sans identifiants → null explicite, sans audit', async () => {
    const { service, prisma, crypto, eventLog } = makeService();
    prisma.router.findFirst.mockResolvedValue({ id: 'r1', credEncrypted: null, localAddress: null });

    await expect(service.getCredentials('r1')).resolves.toBeNull();
    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(eventLog.emit).not.toHaveBeenCalled();
  });
});
