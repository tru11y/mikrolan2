import { NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PlansService } from './plans.service';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'ADMIN',
  })),
}));

function makePrisma() {
  return {
    plan: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    router: {
      findFirst: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  } as unknown;
}

function makeService(prisma?: unknown) {
  const p = prisma ?? makePrisma();
  return { service: new PlansService(p as any), prisma: p as any };
}

describe('PlansService', () => {
  describe('create', () => {
    it('creates a plan with slugified name', async () => {
      const { service, prisma } = makeService();
      prisma.router.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.plan.findMany.mockResolvedValue([]);
      prisma.plan.create.mockResolvedValue({
        id: 'p1',
        name: '1h WiFi',
        slug: '1h-wifi',
        priceXof: 500,
        durationMinutes: 60,
        createdAt: new Date(),
      });

      const result = await service.create('r1', {
        name: '1h WiFi',
        durationMinutes: 60,
        priceXof: 500,
      });

      expect(result.name).toBe('1h WiFi');
      expect(prisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            routerId: 'r1',
            name: '1h WiFi',
            priceXof: 500,
          }),
        }),
      );
    });

    it('throws 404 if router does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.router.findFirst.mockResolvedValue(null);

      await expect(
        service.create('bad-router', { name: 'Plan', durationMinutes: 60, priceXof: 100 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('returns plans for a router', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findMany.mockResolvedValue([
        { id: 'p1', name: 'Plan A' },
        { id: 'p2', name: 'Plan B' },
      ]);

      const result = await service.findAll('r1');

      expect(result).toHaveLength(2);
      expect(prisma.plan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { routerId: 'r1', deletedAt: null },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns a plan', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findFirst.mockResolvedValue({ id: 'p1', name: 'Plan A' });

      const result = await service.findOne('r1', 'p1');
      expect(result.id).toBe('p1');
    });

    it('throws 404 if not found', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findFirst.mockResolvedValue(null);

      await expect(service.findOne('r1', 'bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('soft-deletes a plan', async () => {
      const { service, prisma } = makeService();
      prisma.plan.findFirst
        .mockResolvedValueOnce({ id: 'p1', name: 'Plan A' })
        .mockResolvedValueOnce({ id: 'p1', name: 'Plan A' });
      prisma.plan.update.mockResolvedValue({});

      const result = await service.remove('r1', 'p1');

      expect(result).toEqual({ deleted: true });
      expect(prisma.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });
});
