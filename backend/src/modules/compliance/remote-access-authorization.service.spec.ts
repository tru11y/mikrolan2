import { AuditAction } from '@prisma/client';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { LEGAL_VERSIONS } from '../legal/legal.versions';
import { RemoteAccessAuthorizationService } from './remote-access-authorization.service';

const mockPrisma = { tenant: { findUnique: jest.fn(), update: jest.fn() } };
const mockPeers = { revokeAllForTenant: jest.fn() };

function build() {
  const eventLog = makeEventLogStub();
  const service = new RemoteAccessAuthorizationService(
    mockPrisma as never,
    eventLog as never,
    mockPeers as never,
  );
  return { service, eventLog };
}

beforeEach(() => jest.resetAllMocks());

describe('status', () => {
  it('is accepted only for the current version', async () => {
    const { service } = build();

    mockPrisma.tenant.findUnique.mockResolvedValue({
      remoteAccessAcceptedAt: new Date(),
      remoteAccessVersion: LEGAL_VERSIONS.remoteAccess,
    });
    expect((await service.status('t1')).accepted).toBe(true);

    mockPrisma.tenant.findUnique.mockResolvedValue({
      remoteAccessAcceptedAt: new Date(),
      remoteAccessVersion: '2020-01-01',
    });
    expect((await service.status('t1')).accepted).toBe(false);

    mockPrisma.tenant.findUnique.mockResolvedValue({
      remoteAccessAcceptedAt: null,
      remoteAccessVersion: null,
    });
    expect((await service.status('t1')).accepted).toBe(false);
  });
});

describe('accept', () => {
  it('stores version, timestamp and acceptor, and audits it', async () => {
    const { service, eventLog } = build();
    mockPrisma.tenant.findUnique.mockResolvedValue({
      remoteAccessAcceptedAt: new Date(),
      remoteAccessVersion: LEGAL_VERSIONS.remoteAccess,
    });

    await service.accept('t1', 'u1', LEGAL_VERSIONS.remoteAccess);

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        remoteAccessAcceptedAt: expect.any(Date),
        remoteAccessVersion: LEGAL_VERSIONS.remoteAccess,
        remoteAccessAcceptedById: 'u1',
      },
    });
    expect(eventLog.success).toHaveBeenCalledWith(
      AuditAction.CONFIRM,
      'Tenant',
      't1',
      { kind: 'REMOTE_ACCESS_AUTHORIZATION', version: LEGAL_VERSIONS.remoteAccess },
      { tenantId: 't1', userId: 'u1' },
    );
  });

  it('rejects an outdated version with 409 and stores nothing', async () => {
    const { service } = build();

    await expect(service.accept('t1', 'u1', '2020-01-01')).rejects.toMatchObject({
      status: 409,
    });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });
});

describe('revoke', () => {
  it('clears the authorization and revokes every active peer of the tenant', async () => {
    const { service } = build();
    mockPeers.revokeAllForTenant.mockResolvedValue(2);

    const result = await service.revoke('t1', 'u1');

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        remoteAccessAcceptedAt: null,
        remoteAccessVersion: null,
        remoteAccessAcceptedById: null,
      },
    });
    expect(mockPeers.revokeAllForTenant).toHaveBeenCalledWith(
      't1',
      'AUTHORIZATION_REVOKED',
      'u1',
    );
    expect(result).toEqual({ revoked: true, revokedPeers: 2 });
  });
});
