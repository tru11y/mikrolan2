import { AuditAction, ManagementMode, RemotePeer, RemotePeerStatus } from '@prisma/client';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { PeerRevocationService } from './peer-revocation.service';

const peer = {
  id: 'peer1',
  routerId: 'r1',
  tenantId: 't1',
  wgPublicKey: 'pub',
  wgIp: '10.8.0.2',
  allocatedPort: 20000,
  accessSourceIp: '41.66.1.2',
  webfigPort: 80,
  sshPort: 22,
  winboxPort: 8291,
  status: RemotePeerStatus.ACTIVE,
} as RemotePeer;

const mockPrisma = {
  remotePeer: { findMany: jest.fn(), update: jest.fn() },
  router: { update: jest.fn() },
  $transaction: jest.fn(),
};
const mockWg = { removePeer: jest.fn(), removeDnat: jest.fn() };

function build() {
  const eventLog = makeEventLogStub();
  const service = new PeerRevocationService(
    mockPrisma as never,
    mockWg as never,
    eventLog as never,
  );
  return { service, eventLog };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockPrisma),
  );
});

describe('PeerRevocationService.revokePeer', () => {
  it('removes the WireGuard peer + DNAT, marks the peer REVOKED and the router LOCAL', async () => {
    const { service, eventLog } = build();

    await service.revokePeer(peer, 'AUTHORIZATION_REVOKED', 'u1');

    expect(mockWg.removePeer).toHaveBeenCalledWith('pub');
    expect(mockWg.removeDnat).toHaveBeenCalledWith('10.8.0.2', 20000, {
      webfigPort: 80,
      sshPort: 22,
      winboxPort: 8291,
    }, '41.66.1.2');
    expect(mockPrisma.remotePeer.update).toHaveBeenCalledWith({
      where: { id: 'peer1' },
      data: {
        status: RemotePeerStatus.REVOKED,
        revokedAt: expect.any(Date),
        accessOpenUntil: null,
        accessSourceIp: null,
      },
    });
    expect(mockPrisma.router.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { mode: ManagementMode.LOCAL },
    });
    expect(eventLog.success).toHaveBeenCalledWith(
      AuditAction.REVOKE,
      'Router',
      'r1',
      { reason: 'AUTHORIZATION_REVOKED' },
      { tenantId: 't1', userId: 'u1' },
    );
  });

  it('still revokes in database and logs a warning when WireGuard removal fails', async () => {
    const { service, eventLog } = build();
    mockWg.removePeer.mockRejectedValue(new Error('wg down'));

    await service.revokePeer(peer, 'TENANT_DELETED');

    expect(mockPrisma.remotePeer.update).toHaveBeenCalled();
    expect(eventLog.warning).toHaveBeenCalled();
    expect(eventLog.success).not.toHaveBeenCalled();
  });
});

describe('PeerRevocationService.revokeAllForTenant', () => {
  it('revokes every active peer even if one fails', async () => {
    const { service } = build();
    mockPrisma.remotePeer.findMany.mockResolvedValue([
      peer,
      { ...peer, id: 'peer2', routerId: 'r2' },
    ]);
    mockPrisma.remotePeer.update.mockRejectedValueOnce(new Error('db')).mockResolvedValue({});

    expect(await service.revokeAllForTenant('t1', 'AUTHORIZATION_REVOKED', 'u1')).toBe(1);
    expect(mockPrisma.remotePeer.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', status: RemotePeerStatus.ACTIVE },
    });
  });
});

describe('PeerRevocationService.revokeAllForDeletedTenants', () => {
  it('targets active peers of DELETED tenants only', async () => {
    const { service } = build();
    mockPrisma.remotePeer.findMany.mockResolvedValue([]);

    await service.revokeAllForDeletedTenants();

    expect(mockPrisma.remotePeer.findMany).toHaveBeenCalledWith({
      where: { status: RemotePeerStatus.ACTIVE, router: { tenant: { status: 'DELETED' } } },
    });
  });
});
