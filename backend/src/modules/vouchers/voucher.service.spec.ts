import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { VoucherStatus, SessionStatus, ManagementMode } from '@prisma/client';
import { VoucherService } from './voucher.service';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'ADMIN',
  })),
}));

const now = new Date('2026-08-15T12:00:00Z');

function makePrisma() {
  return {
    voucher: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
      createMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    session: { deleteMany: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<void>) =>
      fn({
        session: { deleteMany: jest.fn() },
        voucher: { delete: jest.fn(), deleteMany: jest.fn() },
        voucherBatch: { delete: jest.fn() },
      }),
    ),
  } as unknown;
}

function makeRemote() {
  return { run: jest.fn() } as unknown;
}

function makeService(prisma?: unknown, remote?: unknown) {
  const p = prisma ?? makePrisma();
  const r = remote ?? makeRemote();
  return { service: new VoucherService(p as any, r as any), prisma: p as any };
}

const VOUCHER_ROW = {
  id: 'v-1',
  code: 'ABCD1234',
  password: 'ABCD1234',
  status: VoucherStatus.GENERATED,
  planId: 'plan-1',
  routerId: 'router-1',
  batchId: 'batch-1',
  expiresAt: null,
  usedAt: null,
  createdAt: now,
  plan: { id: 'plan-1', name: '1h WiFi', priceXof: 500, durationMinutes: 60 },
  router: { id: 'router-1', identity: 'MikroTik-01', alias: 'Routeur Test' },
  session: null,
};

describe('VoucherService', () => {
  describe('verifyVoucherForOperator', () => {
    it('returns correct shape for a found voucher without session', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(VOUCHER_ROW);

      const result = await service.verifyVoucherForOperator({ ticket: 'ABCD1234' });

      expect(result.source).toBe('SAAS');
      expect(result.code).toBe('ABCD1234');
      expect(result.canLogin).toBe(true);
      expect(result.planName).toBe('1h WiFi');
      expect(result.durationMinutes).toBe(60);
      expect(result.priceXof).toBe(500);
      expect(result.routerName).toBe('Routeur Test');
      expect(result.session).toBeNull();
      expect(result.message).toContain('valide');
    });

    it('returns session info when session exists', async () => {
      const sessionStart = new Date('2026-08-15T10:00:00Z');
      const withSession = {
        ...VOUCHER_ROW,
        status: VoucherStatus.ACTIVE,
        session: {
          status: SessionStatus.ACTIVE,
          startedAt: sessionStart,
          lastSeenAt: sessionStart,
          terminatedAt: null,
          bytesIn: BigInt(1024),
          bytesOut: BigInt(2048),
          macAddress: 'AA:BB:CC:DD:EE:FF',
          ipAddress: '192.168.1.100',
        },
      };
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(withSession);

      const result = await service.verifyVoucherForOperator({ ticket: 'ABCD1234' });

      expect(result.session).not.toBeNull();
      expect(result.session!.status).toBe('ACTIVE');
      expect(result.session!.bytesIn).toBe('1024');
      expect(result.session!.bytesOut).toBe('2048');
      expect(result.session!.macAddress).toBe('AA:BB:CC:DD:EE:FF');
      expect(result.canLogin).toBe(true);
    });

    it('throws UnauthorizedException for unknown code', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyVoucherForOperator({ ticket: 'FAKE-CODE' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns canLogin: false for REVOKED voucher', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue({
        ...VOUCHER_ROW,
        status: VoucherStatus.REVOKED,
      });

      const result = await service.verifyVoucherForOperator({ ticket: 'ABCD1234' });

      expect(result.canLogin).toBe(false);
      expect(result.status).toBe('REVOKED');
      expect(result.message).toContain('refusée');
    });
  });

  describe('lookupByCode', () => {
    it('returns voucher with plan for a valid code', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(VOUCHER_ROW);

      const result = await service.lookupByCode('router-1', 'ABCD1234');

      expect(result.code).toBe('ABCD1234');
      expect(result.plan.name).toBe('1h WiFi');
    });

    it('throws NotFoundException for unknown code', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(null);

      await expect(
        service.lookupByCode('router-1', 'UNKNOWN'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('revoke', () => {
    it('throws BadRequestException if already revoked', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue({
        id: 'v-1',
        routerId: 'router-1',
        mikrotikId: null,
        status: VoucherStatus.REVOKED,
        router: { mode: ManagementMode.LOCAL },
      });

      await expect(service.revoke('v-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if voucher does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(null);

      await expect(service.revoke('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('revokes a GENERATED voucher successfully', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue({
        id: 'v-1',
        routerId: 'router-1',
        mikrotikId: null,
        status: VoucherStatus.GENERATED,
        router: { mode: ManagementMode.LOCAL },
      });

      const result = await service.revoke('v-1');

      expect(result).toEqual({ revoked: true });
      expect(prisma.voucher.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'v-1' },
          data: expect.objectContaining({ status: VoucherStatus.REVOKED }),
        }),
      );
    });
  });
});
