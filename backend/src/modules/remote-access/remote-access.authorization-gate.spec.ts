import { UserRole } from '@prisma/client';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { tenantStore } from '../../common/context/tenant-context';
import { LEGAL_VERSIONS } from '../legal/legal.versions';
import { RemoteAccessService } from './remote-access.service';

const mockPrisma = {
  tenant: { findUnique: jest.fn() },
  router: { findFirst: jest.fn() },
  remotePeer: { findFirst: jest.fn() },
};
const mockSubscriptions = { isRemoteAllowed: jest.fn() };

function build(enforced = true) {
  const config = { get: jest.fn((key: string) => (key === 'COMPLIANCE_ENFORCED' ? enforced : undefined)) };
  return new RemoteAccessService(
    mockPrisma as never,
    mockSubscriptions as never,
    {} as never,
    config as never,
    makeEventLogStub() as never,
  );
}

function asTenant<T>(run: () => Promise<T>): Promise<T> {
  return tenantStore.run(
    { ctx: { tenantId: 't1', userId: 'u1', role: UserRole.OWNER } },
    run,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSubscriptions.isRemoteAllowed.mockResolvedValue(true);
});

describe('RemoteAccessService.provision — authorization gate', () => {
  it.each([
    ['never accepted', { remoteAccessVersion: null }],
    ['outdated version', { remoteAccessVersion: '2020-01-01' }],
  ])('refuses with 403 when the authorization is %s', async (_label, tenant) => {
    mockPrisma.tenant.findUnique.mockResolvedValue(tenant);

    await expect(asTenant(() => build().provision('r1', 'u1'))).rejects.toMatchObject({
      status: 403,
    });
    expect(mockPrisma.router.findFirst).not.toHaveBeenCalled();
  });

  it('COMPLIANCE_ENFORCED=false : no authorization needed, the tenant is not even read', async () => {
    mockPrisma.router.findFirst.mockResolvedValue(null);

    await expect(asTenant(() => build(false).provision('r1', 'u1'))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.router.findFirst).toHaveBeenCalled();
  });

  it('proceeds past the gate once the current version is accepted', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      remoteAccessVersion: LEGAL_VERSIONS.remoteAccess,
    });
    mockPrisma.router.findFirst.mockResolvedValue(null);

    await expect(asTenant(() => build().provision('r1', 'u1'))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockPrisma.router.findFirst).toHaveBeenCalled();
  });
});
