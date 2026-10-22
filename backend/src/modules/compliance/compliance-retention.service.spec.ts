import { PaymentStatus, Prisma, RemotePeerStatus, TenantStatus, UserStatus } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { ComplianceRetentionService } from './compliance-retention.service';
import { PURGE_BATCH_SIZE, RETENTION } from './compliance.constants';

jest.mock('node:fs/promises', () => ({ unlink: jest.fn() }));

const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-18T12:00:00Z');
const unlinkMock = unlink as jest.Mock;

const mockPrisma = {
  auditLog: { findMany: jest.fn(), deleteMany: jest.fn() },
  auditLogArchive: { createMany: jest.fn(), count: jest.fn() },
  paymentProof: { findMany: jest.fn(), deleteMany: jest.fn() },
  router: { updateMany: jest.fn() },
  user: { findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
  tenant: { findUnique: jest.fn(), update: jest.fn() },
  passwordResetCode: { deleteMany: jest.fn() },
  refreshToken: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
};

function buildService() {
  return new ComplianceRetentionService(mockPrisma as never);
}

function cutoffOf(
  call: { where: { createdAt?: { lt: Date }; deletedAt?: { lt: Date } } },
  key: 'createdAt' | 'deletedAt',
): Date {
  return call.where[key]!.lt;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockPrisma),
  );
});

describe('archiveExpiredAuditLogs', () => {
  const row = (id: string, metadata: unknown = null) => ({
    id,
    tenantId: 't1',
    userId: null,
    action: 'CREATE',
    entityType: 'X',
    entityId: null,
    metadata,
    ip: null,
    outcome: 'SUCCESS',
    createdAt: new Date('2025-01-01T00:00:00Z'),
  });

  it('copies rows older than 12 months to the archive, verifies, then deletes them', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([row('a'), row('b', { k: 1 })]);
    mockPrisma.auditLogArchive.createMany.mockResolvedValueOnce({ count: 2 });
    mockPrisma.auditLogArchive.count.mockResolvedValueOnce(2);
    mockPrisma.auditLog.deleteMany.mockResolvedValueOnce({ count: 2 });

    expect(await buildService().archiveExpiredAuditLogs(NOW)).toBe(2);

    const cutoff = cutoffOf(mockPrisma.auditLog.findMany.mock.calls[0][0], 'createdAt');
    expect(cutoff.getTime()).toBe(NOW.getTime() - RETENTION.auditLogDays * DAY_MS);
    const data = mockPrisma.auditLogArchive.createMany.mock.calls[0][0].data;
    expect(data.map((d: { id: string }) => d.id)).toEqual(['a', 'b']);
    expect(data[0].metadata).toBe(Prisma.DbNull);
    expect(data[1].metadata).toEqual({ k: 1 });
    expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } } });
    // la copie précède la suppression
    expect(mockPrisma.auditLogArchive.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.auditLog.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it('deletes NOTHING when the archive copy is incomplete (transaction aborts)', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([row('a'), row('b')]);
    mockPrisma.auditLogArchive.createMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.auditLogArchive.count.mockResolvedValueOnce(1);

    await expect(buildService().archiveExpiredAuditLogs(NOW)).rejects.toThrow(/archive incomplete/);
    expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps going while full batches come back', async () => {
    const fullBatch = Array.from({ length: PURGE_BATCH_SIZE }, (_, i) => row(`r${i}`));
    mockPrisma.auditLog.findMany.mockResolvedValueOnce(fullBatch).mockResolvedValueOnce([row('last')]);
    mockPrisma.auditLogArchive.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLogArchive.count.mockResolvedValueOnce(PURGE_BATCH_SIZE).mockResolvedValueOnce(1);
    mockPrisma.auditLog.deleteMany
      .mockResolvedValueOnce({ count: PURGE_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 1 });

    expect(await buildService().archiveExpiredAuditLogs(NOW)).toBe(PURGE_BATCH_SIZE + 1);
  });

  it('does nothing when nothing is expired', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([]);

    expect(await buildService().archiveExpiredAuditLogs(NOW)).toBe(0);
    expect(mockPrisma.auditLogArchive.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});

describe('purgePaymentProofs', () => {
  it('removes the file then the row for proofs older than 24 months', async () => {
    mockPrisma.paymentProof.findMany.mockResolvedValueOnce([
      { id: 'p1', imageUrl: '/private-uploads/proofs/abc.jpg' },
    ]);
    unlinkMock.mockResolvedValue(undefined);
    mockPrisma.paymentProof.deleteMany.mockResolvedValueOnce({ count: 1 });

    const purged = await buildService().purgePaymentProofs(NOW);

    expect(purged).toBe(1);
    expect(unlinkMock).toHaveBeenCalledWith(expect.stringMatching(/abc\.jpg$/));
    const cutoff = cutoffOf(mockPrisma.paymentProof.findMany.mock.calls[0][0], 'createdAt');
    expect(cutoff.getTime()).toBe(NOW.getTime() - RETENTION.paymentProofDays * DAY_MS);
    expect(mockPrisma.paymentProof.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['p1'] } },
    });
  });

  it('never selects a proof linked to a PAID (or REFUNDED) invoice', async () => {
    mockPrisma.paymentProof.findMany.mockResolvedValueOnce([]);

    await buildService().purgePaymentProofs(NOW);

    const where = mockPrisma.paymentProof.findMany.mock.calls[0][0].where;
    expect(where.invoice).toEqual({ status: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] } });
    expect(JSON.stringify(where)).not.toContain(PaymentStatus.PAID);
    expect(JSON.stringify(where)).not.toContain(PaymentStatus.REFUNDED);
  });

  it('still deletes the row when the file is already gone', async () => {
    mockPrisma.paymentProof.findMany.mockResolvedValueOnce([
      { id: 'p1', imageUrl: '/private-uploads/proofs/gone.png' },
    ]);
    unlinkMock.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    mockPrisma.paymentProof.deleteMany.mockResolvedValueOnce({ count: 1 });

    expect(await buildService().purgePaymentProofs(NOW)).toBe(1);
  });

  it('keeps the row when the file cannot be removed, so the next run retries', async () => {
    mockPrisma.paymentProof.findMany.mockResolvedValueOnce([
      { id: 'p1', imageUrl: '/private-uploads/proofs/locked.jpg' },
    ]);
    unlinkMock.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

    expect(await buildService().purgePaymentProofs(NOW)).toBe(0);
    expect(mockPrisma.paymentProof.deleteMany).not.toHaveBeenCalled();
  });

  it('purges the row of a tampered imageUrl without touching the filesystem', async () => {
    mockPrisma.paymentProof.findMany.mockResolvedValueOnce([
      { id: 'p1', imageUrl: '/private-uploads/proofs/not-an-image.txt' },
    ]);
    mockPrisma.paymentProof.deleteMany.mockResolvedValueOnce({ count: 1 });

    expect(await buildService().purgePaymentProofs(NOW)).toBe(1);
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});

describe('wipeRevokedRouterCredentials', () => {
  it('nulls credentials only for routers of a DELETED tenant whose peer was revoked more than 7 days ago', async () => {
    mockPrisma.router.updateMany.mockResolvedValueOnce({ count: 3 });

    expect(await buildService().wipeRevokedRouterCredentials(NOW)).toBe(3);

    const call = mockPrisma.router.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ credEncrypted: null });
    expect(call.where.credEncrypted).toEqual({ not: null });
    expect(call.where.tenant).toEqual({ status: TenantStatus.DELETED });
    expect(call.where.remotePeer.is.status).toBe(RemotePeerStatus.REVOKED);
    expect(call.where.remotePeer.is.revokedAt.lt.getTime()).toBe(
      NOW.getTime() - RETENTION.revokedRouterCredentialsDays * DAY_MS,
    );
  });
});

describe('anonymizeDeletedUsers', () => {
  const user = { id: 'u1', email: 'jean@example.com', tenantId: 't1' };

  it('selects only users deleted more than 30 days ago and not yet anonymized', async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([]);

    await buildService().anonymizeDeletedUsers(NOW);

    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.status).toBe(UserStatus.DELETED);
    expect(where.anonymizedAt).toBeNull();
    expect(where.deletedAt.lt.getTime()).toBe(
      NOW.getTime() - RETENTION.anonymizeDeletedUserDays * DAY_MS,
    );
  });

  it('wipes personal data, tokens and reset codes of the user', async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([user]);
    mockPrisma.tenant.findUnique.mockResolvedValue({ status: TenantStatus.ACTIVE });

    expect(await buildService().anonymizeDeletedUsers(NOW)).toBe(1);

    expect(mockPrisma.passwordResetCode.deleteMany).toHaveBeenCalledWith({
      where: { email: 'jean@example.com' },
    });
    expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.objectContaining({
        email: 'deleted-u1@anonymized.invalid',
        name: null,
        country: null,
        googleId: null,
        appleId: null,
        pushToken: null,
        anonymizedAt: NOW,
      }),
    });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('also anonymizes the tenant and wipes router secrets when it is deleted and this is its last user', async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([user]);
    mockPrisma.tenant.findUnique.mockResolvedValue({ status: TenantStatus.DELETED });
    mockPrisma.user.count.mockResolvedValue(0);

    await buildService().anonymizeDeletedUsers(NOW);

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { name: 'Compte supprimé', slug: 'deleted-t1', country: null },
    });
    expect(mockPrisma.router.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      data: { credEncrypted: null, localAddress: null, alias: null },
    });
  });

  it('leaves the tenant alone while another deleted user of it is still pending', async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([user]);
    mockPrisma.tenant.findUnique.mockResolvedValue({ status: TenantStatus.DELETED });
    mockPrisma.user.count.mockResolvedValue(1);

    await buildService().anonymizeDeletedUsers(NOW);

    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('continues with the next user when one fails', async () => {
    mockPrisma.user.findMany.mockResolvedValueOnce([
      user,
      { ...user, id: 'u2', email: 'b@example.com' },
    ]);
    mockPrisma.tenant.findUnique.mockResolvedValue({ status: TenantStatus.ACTIVE });
    mockPrisma.$transaction
      .mockRejectedValueOnce(new Error('db down'))
      .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma));

    expect(await buildService().anonymizeDeletedUsers(NOW)).toBe(1);
  });
});
