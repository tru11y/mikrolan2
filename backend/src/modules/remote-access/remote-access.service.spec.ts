import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { RemotePeerStatus } from '@prisma/client';
import { RemoteAccessService } from './remote-access.service';
import { BusinessException } from '../../common/exceptions/business.exception';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({ tenantId: 't1', userId: 'u1', role: 'ADMIN' })),
}));

const PEER_PENDING = {
  id: 'peer-1',
  routerId: 'r1',
  tenantId: 't1',
  wgPublicKey: 'pk1',
  wgIp: '10.20.0.2',
  allocatedPort: 41000,
  status: RemotePeerStatus.PENDING,
  webfigPort: 80,
  sshPort: 22,
  winboxPort: 8291,
  provisionedAt: new Date(),
};

function setup(overrides: { handshakes?: Record<string, number>; tcpReachable?: boolean } = {}) {
  const prisma = {
    remotePeer: {
      findFirst: jest.fn().mockResolvedValue(PEER_PENDING),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    router: {
      findFirst: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<void>) =>
      fn({
        remotePeer: { update: jest.fn(), create: jest.fn() },
        router: { update: jest.fn() },
      }),
    ),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  const wg = {
    latestHandshakes: jest.fn().mockResolvedValue(overrides.handshakes ?? {}),
    addPeer: jest.fn(),
    addDnat: jest.fn(),
    removePeer: jest.fn(),
    removeDnat: jest.fn(),
    syncPeers: jest.fn(),
    syncDnat: jest.fn(),
    serverPublicKey: 'spk',
    endpoint: '1.2.3.4:51820',
    vpsPublicIp: '1.2.3.4',
  };

  const subs = { isRemoteAllowed: jest.fn().mockResolvedValue(true) };
  const config = { get: jest.fn((key: string) => {
    if (key === 'WG_SUBNET_BASE') return '10.20.0.0/24';
    if (key === 'WG_PORT_MIN') return 41000;
    if (key === 'WG_PORT_MAX') return 42000;
    return '';
  }) };
  const eventLog = makeEventLogStub();

  const service = new RemoteAccessService(
    prisma as any,
    subs as any,
    wg as any,
    config as any,
    eventLog as any,
  );

  // Mock tcpProbe
  (service as any).tcpProbe = jest.fn().mockResolvedValue(overrides.tcpReachable ?? false);

  return { service, prisma, wg, eventLog };
}

describe('RemoteAccessService.activate', () => {
  it('succeeds when handshake is fresh and API is reachable', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { service } = setup({ handshakes: { pk1: now - 10 }, tcpReachable: true });
    const result = await service.activate('r1', 'u1');
    expect(result).toEqual({ activated: true });
  });

  it('rejects when no PENDING peer exists', async () => {
    const { service, prisma } = setup();
    prisma.remotePeer.findFirst.mockResolvedValue(null);
    await expect(service.activate('r1', 'u1')).rejects.toThrow(BusinessException);
  });

  it('rejects when peer is ACTIVE (not PENDING)', async () => {
    const { service, prisma } = setup();
    prisma.remotePeer.findFirst.mockResolvedValue({ ...PEER_PENDING, status: RemotePeerStatus.ACTIVE });
    await expect(service.activate('r1', 'u1')).rejects.toThrow(BusinessException);
  });

  it('rejects when handshake is missing', async () => {
    const { service } = setup({ handshakes: {} });
    await expect(service.activate('r1', 'u1')).rejects.toThrow(/tunnel WireGuard/i);
  });

  it('rejects when handshake is stale (> 150s)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { service } = setup({ handshakes: { pk1: now - 200 } });
    await expect(service.activate('r1', 'u1')).rejects.toThrow(/tunnel WireGuard/i);
  });

  it('rejects when API is unreachable despite fresh handshake', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { service } = setup({ handshakes: { pk1: now - 10 }, tcpReachable: false });
    await expect(service.activate('r1', 'u1')).rejects.toThrow(/API RouterOS/i);
  });
});

describe('RemoteAccessService.cancelProvision', () => {
  it('revokes PENDING peer and cleans up WG', async () => {
    const { service, prisma, wg } = setup();
    const result = await service.cancelProvision('r1', 'u1');
    expect(result).toEqual({ cancelled: true });
    expect(wg.removePeer).toHaveBeenCalledWith('pk1');
    expect(prisma.remotePeer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: RemotePeerStatus.REVOKED }) }),
    );
  });

  it('rejects when no PENDING peer', async () => {
    const { service, prisma } = setup();
    prisma.remotePeer.findFirst.mockResolvedValue(null);
    await expect(service.cancelProvision('r1', 'u1')).rejects.toThrow(BusinessException);
  });

  it('rejects when peer is ACTIVE', async () => {
    const { service, prisma } = setup();
    prisma.remotePeer.findFirst.mockResolvedValue({ ...PEER_PENDING, status: RemotePeerStatus.ACTIVE });
    await expect(service.cancelProvision('r1', 'u1')).rejects.toThrow(BusinessException);
  });
});

describe('RemoteAccessService.provision', () => {
  it('creates peer as PENDING and does NOT switch to REMOTE', async () => {
    const { service, prisma } = setup();
    prisma.remotePeer.findFirst.mockResolvedValue(null);
    jest.spyOn(service as any, 'allocate').mockResolvedValue({ wgIp: '10.20.0.3', allocatedPort: 41001 });
    const result = await service.provision('r1', 'u1');
    expect(result.wgIp).toBe('10.20.0.3');
    // Peer created with PENDING, not ACTIVE
    expect(prisma.remotePeer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: RemotePeerStatus.PENDING }) }),
    );
    // No $transaction means no mode switch to REMOTE
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
