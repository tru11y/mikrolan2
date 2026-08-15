import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ManagementMode, Prisma } from '@prisma/client';
import { RoutersService } from './routers.service';

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
  return {
    service: new RoutersService(prisma, crypto, subs, wg),
    prisma,
    subs,
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

      await expect(service.findOne('bad')).rejects.toThrow(NotFoundException);
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
      ).rejects.toThrow(ConflictException);
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
      ).rejects.toThrow(ForbiddenException);
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
      ).rejects.toThrow(ForbiddenException);
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
