import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { AdminService } from './admin.service';

const mockPrisma: Record<string, any> = {
  tenant: { findUnique: jest.fn(), update: jest.fn() },
  refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  auditLog: { create: jest.fn() },
};

const actor = { userId: 'admin-1', tenantId: 'platform' };

function buildService() {
  return new AdminService(
    mockPrisma as any,
    { sendPushToTenant: jest.fn() } as any,
    {} as any,
    { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
    {} as any,
    makeEventLogStub() as any,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('AdminService.setTenantStatus — comptes supprimés', () => {
  it('refuse de réactiver un tenant DELETED (409), rien n’est écrit', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'DELETED', slug: 's' });

    await expect(buildService().setTenantStatus('t1', actor, { status: 'ACTIVE' } as any)).rejects.toMatchObject({
      status: 409,
    });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('refuse aussi de suspendre un tenant DELETED', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'DELETED', slug: 's' });

    await expect(buildService().setTenantStatus('t1', actor, { status: 'SUSPENDED' } as any)).rejects.toMatchObject({
      status: 409,
    });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('continue de suspendre un tenant ACTIVE', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 't1', status: 'ACTIVE', slug: 's' });
    mockPrisma.tenant.update.mockResolvedValue({ id: 't1', name: 'T', status: 'SUSPENDED' });

    await buildService().setTenantStatus('t1', actor, { status: 'SUSPENDED' } as any);

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' }, data: { status: 'SUSPENDED' } }),
    );
  });
});
