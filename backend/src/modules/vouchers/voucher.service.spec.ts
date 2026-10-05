import { makeEventLogStub } from '../../common/testing/event-log.stub';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, VoucherStatus, SessionStatus, ManagementMode } from '@prisma/client';
import { VoucherService } from './voucher.service';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'ADMIN',
  })),
}));

const now = new Date('2026-08-15T12:00:00Z');

function makeTx() {
  return {
    voucher: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    session: { deleteMany: jest.fn() },
    voucherBatch: { delete: jest.fn() },
  };
}

function makePrisma() {
  const tx = makeTx();
  return {
    voucher: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
      createMany: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: { create: jest.fn() },
    session: { deleteMany: jest.fn() },
    voucherBatch: { findFirst: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  } as unknown;
}

function makeRemote() {
  return { run: jest.fn() } as unknown;
}

function makeSubscriptions() {
  return { assertVoucherLimit: jest.fn().mockResolvedValue(undefined) } as unknown;
}

function makeService(prisma?: unknown, remote?: unknown, subs?: unknown) {
  const p = prisma ?? makePrisma();
  const r = remote ?? makeRemote();
  const s = subs ?? makeSubscriptions();
  const eventLog = makeEventLogStub();
  return {
    service: new VoucherService(p as any, r as any, s as any, eventLog as any),
    prisma: p as any,
    remote: r as any,
    eventLog,
  };
}

function voucherRow(
  id: string,
  status: VoucherStatus,
  opts: { batchId?: string; mikrotikId?: string | null; session?: { status: SessionStatus } | null } = {},
) {
  return {
    id,
    status,
    batchId: opts.batchId ?? 'batch-1',
    mikrotikId: opts.mikrotikId ?? null,
    routerId: 'router-1',
    router: { mode: ManagementMode.LOCAL },
    session: opts.session ?? null,
  };
}

const VOUCHER_ROW = {
  id: 'v-1',
  code: 'ABCD1234',
  password: 'ABCD1234',
  mikrotikId: '*1A', // ticket réellement créé côté RouterOS (règle « provisionné »)
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

    it('unknown code is a business 404 (VOUCHER_NOT_FOUND), never a 401 that would log the operator out', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyVoucherForOperator({ ticket: 'FAKE-CODE' }),
      ).rejects.toMatchObject({ status: 404, errorCode: 'VOUCHER_NOT_FOUND' });
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
      ).rejects.toMatchObject({ status: 404 });
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

      await expect(service.revoke('v-1')).rejects.toMatchObject({ status: 400 });
    });

    it('throws NotFoundException if voucher does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(null);

      await expect(service.revoke('nonexistent')).rejects.toMatchObject({ status: 404 });
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
          where: { id: 'v-1', status: { not: VoucherStatus.ACTIVE } },
          data: expect.objectContaining({ status: VoucherStatus.REVOKED }),
        }),
      );
    });

    it('refuses to revoke a ticket that just became ACTIVE (race with activation)', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue({
        id: 'v-1',
        routerId: 'router-1',
        mikrotikId: null,
        status: VoucherStatus.GENERATED,
        router: { mode: ManagementMode.LOCAL },
      });
      // The conditional UPDATE loses the race: the client connected between
      // the findFirst read and this statement, so it now matches 0 rows.
      prisma.voucher.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revoke('v-1')).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('remove', () => {
    function activeVoucher(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'v-1',
        routerId: 'router-1',
        mikrotikId: 'ros-1',
        router: { mode: ManagementMode.LOCAL },
        ...overrides,
      };
    }

    it('throws NotFoundException if voucher does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toMatchObject({ status: 404 });
    });

    it('deletes an unused (GENERATED) voucher', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(activeVoucher());
      prisma._tx.voucher.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('v-1');

      expect(result).toEqual({ deleted: true });
      expect(prisma._tx.voucher.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'v-1', status: { not: VoucherStatus.ACTIVE } } }),
      );
      expect(prisma._tx.session.deleteMany).toHaveBeenCalledWith({ where: { voucherId: 'v-1' } });
      expect(prisma._tx.voucher.delete).toHaveBeenCalledWith({ where: { id: 'v-1' } });
    });

    it('refuses to delete a ticket currently ACTIVE — even via a direct API call (F)', async () => {
      const { service, prisma } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(activeVoucher());
      // The conditional claim inside the transaction is the real guard: an
      // old mobile client or a manual API call hits this the same way.
      prisma._tx.voucher.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('v-1')).rejects.toMatchObject({ status: 409 });
      expect(prisma._tx.session.deleteMany).not.toHaveBeenCalled();
      expect(prisma._tx.voucher.delete).not.toHaveBeenCalled();
    });

    it('deletes the DB row even if the RouterOS cleanup call fails (D)', async () => {
      const { service, prisma, remote } = makeService();
      prisma.voucher.findFirst.mockResolvedValue(
        activeVoucher({ router: { mode: ManagementMode.REMOTE } }),
      );
      prisma._tx.voucher.updateMany.mockResolvedValue({ count: 1 });
      remote.run.mockRejectedValue(new Error('Routeur injoignable'));

      const result = await service.remove('v-1');

      expect(result).toEqual({ deleted: true });
    });
  });

  describe('previewBatchDeletion / previewRouterCleanup', () => {
    it('throws NotFoundException if batch does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.voucherBatch.findFirst.mockResolvedValue(null);

      await expect(service.previewBatchDeletion('missing')).rejects.toMatchObject({ status: 404 });
    });

    it('splits ACTIVE tickets into connectedNow vs keptForHistory', async () => {
      const { service, prisma } = makeService();
      prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      prisma.voucher.groupBy.mockResolvedValue([
        { status: VoucherStatus.GENERATED, _count: { _all: 30 } },
        { status: VoucherStatus.ACTIVE, _count: { _all: 20 } },
      ]);
      // Of the 20 ACTIVE vouchers, only 6 have a Session currently ACTIVE.
      prisma.voucher.count.mockResolvedValue(6);

      const preview = await service.previewBatchDeletion('batch-1');

      expect(preview).toEqual({
        batchId: 'batch-1',
        total: 50,
        eligible: 30,
        keptForHistory: 14,
        connectedNow: 6,
      });
      expect(prisma.voucher.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            batchId: 'batch-1',
            status: VoucherStatus.ACTIVE,
            session: { status: SessionStatus.ACTIVE },
          }),
        }),
      );
    });
  });

  describe('removeBatch / removeAllEligible (bulk cleanup)', () => {

    it('(A) deletes all 10 vouchers of a batch that were never used', async () => {
      const { service, prisma } = makeService();
      prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      const rows = Array.from({ length: 10 }, (_, i) => voucherRow(`v-${i}`, VoucherStatus.GENERATED));
      prisma.voucher.findMany.mockResolvedValue(rows);
      prisma._tx.voucher.findMany.mockResolvedValue(rows.map((r) => ({ id: r.id })));

      const result = await service.removeBatch('batch-1');

      expect(result).toEqual({ analyzed: 10, deleted: 10, protectedActive: 0, keptForHistory: 0, connectedNow: 0, routerCleanupFailed: 0 });
    });

    it('(B) protects the 2 ACTIVE vouchers out of 10, deletes the other 8', async () => {
      const { service, prisma } = makeService();
      prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      const rows = [
        ...Array.from({ length: 8 }, (_, i) => voucherRow(`v-${i}`, VoucherStatus.GENERATED)),
        voucherRow('v-active-1', VoucherStatus.ACTIVE),
        voucherRow('v-active-2', VoucherStatus.ACTIVE),
      ];
      prisma.voucher.findMany.mockResolvedValue(rows);
      const eligible = rows.filter((r) => r.status !== VoucherStatus.ACTIVE).map((r) => ({ id: r.id }));
      prisma._tx.voucher.findMany.mockResolvedValue(eligible);

      const result = await service.removeBatch('batch-1');

      expect(result).toEqual({ analyzed: 10, deleted: 8, protectedActive: 2, keptForHistory: 2, connectedNow: 0, routerCleanupFailed: 0 });
      // The claim only ever targets non-ACTIVE ids — the two active vouchers
      // are never even sent to the router or DB delete.
      expect(prisma._tx.voucher.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: eligible.map((e) => e.id) }, status: { not: VoucherStatus.ACTIVE } },
        }),
      );
    });

    it('(H) splits protected ACTIVE vouchers: connected now vs already-sold history', async () => {
      const { service, prisma } = makeService();
      prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      const rows = [
        voucherRow('v-1', VoucherStatus.GENERATED),
        voucherRow('v-connected', VoucherStatus.ACTIVE, { session: { status: SessionStatus.ACTIVE } }),
        voucherRow('v-history', VoucherStatus.ACTIVE, { session: { status: SessionStatus.TERMINATED } }),
      ];
      prisma.voucher.findMany.mockResolvedValue(rows);
      prisma._tx.voucher.findMany.mockResolvedValue([{ id: 'v-1' }]);

      const result = await service.removeBatch('batch-1');

      expect(result).toEqual({
        analyzed: 3,
        deleted: 1,
        protectedActive: 2,
        connectedNow: 1,
        keptForHistory: 1,
        routerCleanupFailed: 0,
      });
    });

    it('(C) a voucher activated between the snapshot and the commit is never claimed', async () => {
      const { service, prisma } = makeService();
      prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      // Snapshot sees it as GENERATED (still eligible)...
      const rows = [voucherRow('v-1', VoucherStatus.GENERATED)];
      prisma.voucher.findMany.mockResolvedValue(rows);
      // ...but by the time the transaction runs, the client has connected:
      // the re-read inside the transaction finds nothing left in REVOKED.
      prisma._tx.voucher.findMany.mockResolvedValue([]);

      const result = await service.removeBatch('batch-1');

      expect(result).toEqual({ analyzed: 1, deleted: 0, protectedActive: 1, keptForHistory: 1, connectedNow: 0, routerCleanupFailed: 0 });
      expect(prisma._tx.session.deleteMany).toHaveBeenCalledWith({ where: { voucherId: { in: [] } } });
    });

    it('(D) RouterOS unreachable during bulk cleanup: DB stays consistent, failure is reported', async () => {
      const { service, prisma, remote } = makeService();
      prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      const rows = [voucherRow('v-1', VoucherStatus.GENERATED, { mikrotikId: 'ros-1' })];
      const remoteRows = rows.map((r) => ({ ...r, router: { mode: ManagementMode.REMOTE } }));
      prisma.voucher.findMany.mockResolvedValue(remoteRows);
      prisma._tx.voucher.findMany.mockResolvedValue([{ id: 'v-1' }]);
      remote.run.mockRejectedValue(new Error('Routeur injoignable'));

      const result = await service.removeBatch('batch-1');

      // DB deletion already committed — RouterOS cleanup is best-effort and
      // reported separately, never blocks the DB-level result.
      expect(result).toEqual({ analyzed: 1, deleted: 1, protectedActive: 0, keptForHistory: 0, connectedNow: 0, routerCleanupFailed: 1 });
    });

    it('(E) removeAllEligible spreads across multiple batches, protecting ACTIVE tickets in each', async () => {
      const { service, prisma } = makeService();
      const rows = [
        voucherRow('v-1', VoucherStatus.GENERATED, { batchId: 'batch-1' }),
        voucherRow('v-active-1', VoucherStatus.ACTIVE, { batchId: 'batch-1' }),
        voucherRow('v-2', VoucherStatus.USED, { batchId: 'batch-2' }),
        voucherRow('v-active-2', VoucherStatus.ACTIVE, { batchId: 'batch-2' }),
      ];
      prisma.voucher.findMany.mockResolvedValue(rows);
      prisma._tx.voucher.findMany.mockResolvedValue([{ id: 'v-1' }, { id: 'v-2' }]);

      const result = await service.removeAllEligible('router-1');

      expect(result).toEqual({ analyzed: 4, deleted: 2, protectedActive: 2, keptForHistory: 2, connectedNow: 0, routerCleanupFailed: 0 });
    });
  });

  // Cas exacts demandés dans le livrable P0-2B : 30 GENERATED, 14 ACTIVE sans
  // Session ACTIVE, 6 ACTIVE avec Session ACTIVE.
  describe('mission matrix — 30/14/6 split (letters A-H)', () => {
    function buildMixedRows() {
      return [
        ...Array.from({ length: 30 }, (_, i) =>
          voucherRow(`gen-${i}`, VoucherStatus.GENERATED, { mikrotikId: `ros-gen-${i}` }),
        ),
        ...Array.from({ length: 14 }, (_, i) =>
          voucherRow(`history-${i}`, VoucherStatus.ACTIVE, { mikrotikId: `ros-history-${i}` }),
        ),
        ...Array.from({ length: 6 }, (_, i) =>
          voucherRow(`connected-${i}`, VoucherStatus.ACTIVE, {
            mikrotikId: `ros-connected-${i}`,
            session: { status: SessionStatus.ACTIVE },
          }),
        ),
      ];
    }

    it('(A) preview: total 50, eligible 30, keptForHistory 14, connectedNow 6', async () => {
      const { service, prisma } = makeService();
      prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      prisma.voucher.groupBy.mockResolvedValue([
        { status: VoucherStatus.GENERATED, _count: { _all: 30 } },
        { status: VoucherStatus.ACTIVE, _count: { _all: 20 } },
      ]);
      prisma.voucher.count.mockResolvedValue(6);

      const preview = await service.previewBatchDeletion('batch-1');

      expect(preview).toEqual({ batchId: 'batch-1', total: 50, eligible: 30, keptForHistory: 14, connectedNow: 6 });
    });

    it('(B) bulk cleanup: deleted 30, keptForHistory 14, connectedNow 6', async () => {
      const { service, prisma } = makeService();
      const rows = buildMixedRows();
      prisma.voucher.findMany.mockResolvedValue(rows);
      const eligible = rows.filter((r) => r.status === VoucherStatus.GENERATED).map((r) => ({ id: r.id }));
      prisma._tx.voucher.findMany.mockResolvedValue(eligible);

      const result = await service.removeAllEligible('router-1');

      expect(result).toEqual({
        analyzed: 50,
        deleted: 30,
        protectedActive: 20,
        keptForHistory: 14,
        connectedNow: 6,
        routerCleanupFailed: 0,
      });
    });

    it('(C)+(D) no ACTIVE voucher is ever hard-deleted or sent to removeHotspotUser', async () => {
      const { service, prisma, remote } = makeService();
      const rows = buildMixedRows().map((r) => ({ ...r, router: { mode: ManagementMode.REMOTE } }));
      prisma.voucher.findMany.mockResolvedValue(rows);
      const eligible = rows.filter((r) => r.status === VoucherStatus.GENERATED).map((r) => ({ id: r.id }));
      prisma._tx.voucher.findMany.mockResolvedValue(eligible);

      await service.removeAllEligible('router-1');

      // The claim/delete calls only ever reference the 30 GENERATED ids.
      const claimCall = prisma._tx.voucher.updateMany.mock.calls[0][0];
      expect(claimCall.where.id.in).toHaveLength(30);
      expect(claimCall.where.id.in.every((id: string) => id.startsWith('gen-'))).toBe(true);

      const deleteManyCall = prisma._tx.voucher.deleteMany.mock.calls[0][0];
      expect(deleteManyCall.where.id.in.every((id: string) => id.startsWith('gen-'))).toBe(true);

      // removeHotspotUser (via remote.run) is only ever called for the 30
      // eligible ids — never for the 20 ACTIVE ones (history or connected).
      expect(remote.run).toHaveBeenCalledTimes(30);
    });

    it('(H) RouterOS cleanup failure marks the audit outcome PARTIAL_SUCCESS, never a silent success', async () => {
      const { service, prisma, remote, eventLog } = makeService();
      const rows = [voucherRow('v-1', VoucherStatus.GENERATED, { mikrotikId: 'ros-1' })].map((r) => ({
        ...r,
        router: { mode: ManagementMode.REMOTE },
      }));
      prisma.voucherBatch.findFirst.mockResolvedValue({ id: 'batch-1' });
      prisma.voucher.findMany.mockResolvedValue(rows);
      prisma._tx.voucher.findMany.mockResolvedValue([{ id: 'v-1' }]);
      remote.run.mockRejectedValue(new Error('Routeur injoignable'));

      const result = await service.removeBatch('batch-1');

      expect(result.routerCleanupFailed).toBe(1);
      expect(eventLog.partialSuccess).toHaveBeenCalledWith(
        AuditAction.DELETE,
        'VoucherBatch',
        'batch-1',
        expect.objectContaining({ routerCleanupFailed: 1 }),
      );
      expect(eventLog.success).not.toHaveBeenCalled();
    });
  });
});
