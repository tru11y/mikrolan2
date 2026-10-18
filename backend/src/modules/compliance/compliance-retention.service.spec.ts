import { RemotePeerStatus, TenantStatus, UserStatus } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { ComplianceRetentionService } from './compliance-retention.service';
import { PURGE_BATCH_SIZE, RETENTION } from './compliance.constants';

jest.mock('node:fs/promises', () => ({ unlink: jest.fn() }));

const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-18T12:00:00Z');
const unlinkMock = unlink as jest.Mock;

const mockPrisma = {
  auditLog: { findMany: jest.fn(), deleteMany: jest.fn() },
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

describe('purgeAuditLogs', () => {
  it('deletes only rows older than 12 months', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    mockPrisma.auditLog.deleteMany.mockResolvedValueOnce({ count: 2 });

    const purged = await buildService().purgeAuditLogs(NOW);

    expect(purged).toBe(2);
    const cutoff = cutoffOf(mockPrisma.auditLog.findMany.mock.calls[0][0], 'createdAt');
    expect(cutoff.getTime()).toBe(NOW.getTime() - RETENTION.auditLogDays * DAY_MS);
    expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
    });
  });

  it('keeps going while full batches come back', async () => {
    const fullBatch = Array.from({ length: PURGE_BATCH_SIZE }, (_, i) => ({ id: `r${i}` }));
    mockPrisma.auditLog.findMany
      .mockResolvedValueOnce(fullBatch)
      .mockResolvedValueOnce([{ id: 'last' }]);
    mockPrisma.auditLog.deleteMany
      .mockResolvedValueOnce({ count: PURGE_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 1 });

    expect(await buildService().purgeAuditLogs(NOW)).toBe(PURGE_BATCH_SIZE + 1);
  });

  it('does nothing when nothing is expired', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([]);

    expect(await buildService().purgeAuditLogs(NOW)).toBe(0);
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
  it('nulls credentials of routers whose peer was revoked more than 7 days ago', async () => {
    mockPrisma.router.updateMany.mockResolvedValueOnce({ count: 3 });

    expect(await buildService().wipeRevokedRouterCredentials(NOW)).toBe(3);

    const call = mockPrisma.router.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ credEncrypted: null });
    expect(call.where.credEncrypted).toEqual({ not: null });
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
