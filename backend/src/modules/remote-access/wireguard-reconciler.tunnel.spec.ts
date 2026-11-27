import { AccessMode } from '@prisma/client';
import { WireGuardReconciler } from './wireguard-reconciler.service';

function build() {
  const now = Date.now();
  const directPeer = {
    id: 'p-direct',
    wgPublicKey: 'kd',
    wgIp: '10.20.0.2',
    allocatedPort: 41000,
    routerId: 'r-direct',
    webfigPort: 80,
    sshPort: 22,
    winboxPort: 8291,
    accessOpenUntil: new Date(now + 60_000),
    accessSourceIp: '1.2.3.4',
    accessMode: AccessMode.DIRECT,
  };
  const tunnelPeerOpen = {
    id: 'p-tun-open',
    wgPublicKey: 'kt',
    wgIp: '10.20.0.3',
    allocatedPort: 41001,
    routerId: 'r-tun-open',
    webfigPort: 80,
    sshPort: 22,
    winboxPort: 8291,
    accessOpenUntil: new Date(now + 60_000),
    accessSourceIp: '1.2.3.4',
    accessMode: AccessMode.TUNNEL,
  };
  const tunnelPeerExpired = {
    id: 'p-tun-exp',
    wgPublicKey: 'ke',
    wgIp: '10.20.0.4',
    allocatedPort: 41002,
    routerId: 'r-tun-exp',
    webfigPort: 80,
    sshPort: 22,
    winboxPort: 8291,
    accessOpenUntil: new Date(now - 1000),
    accessSourceIp: '1.2.3.4',
    accessMode: AccessMode.TUNNEL,
  };
  const peers = [directPeer, tunnelPeerOpen, tunnelPeerExpired];

  const prisma = {
    remotePeer: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([]) // expireStalePending (PENDING)
        .mockResolvedValueOnce(peers), // ACTIVE peers
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    router: {
      findUnique: jest.fn().mockResolvedValue({ health: 'OFFLINE', tenantId: 't', identity: 'x', alias: null }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const events = { publish: jest.fn() };
  const wg = {
    syncPeers: jest.fn().mockResolvedValue(undefined),
    syncDnat: jest.fn().mockResolvedValue(undefined),
    latestHandshakes: jest.fn().mockResolvedValue({}),
  };
  const tunnel = { closeExpiredSessions: jest.fn().mockResolvedValue(0) };
  const registry = { closeByPeer: jest.fn() };

  const reconciler = new WireGuardReconciler(
    prisma as never,
    events as never,
    wg as never,
    tunnel as never,
    registry as never,
  );
  return { reconciler, wg, tunnel, registry };
}

describe('WireGuardReconciler — TUNNEL handling', () => {
  it('excludes TUNNEL peers from the DNAT sync (only DIRECT windows)', async () => {
    const { reconciler, wg } = build();
    await reconciler.reconcile();
    const synced = wg.syncDnat.mock.calls[0][0] as { accessMode: AccessMode }[];
    expect(synced).toHaveLength(1);
    expect(synced[0].accessMode).toBe(AccessMode.DIRECT);
  });

  it('closes live sessions of an expired TUNNEL window via the registry', async () => {
    const { reconciler, registry, tunnel } = build();
    await reconciler.reconcile();
    expect(registry.closeByPeer).toHaveBeenCalledWith('p-tun-exp', expect.anything());
    expect(registry.closeByPeer).not.toHaveBeenCalledWith('p-tun-open', expect.anything());
    expect(tunnel.closeExpiredSessions).toHaveBeenCalled();
  });
});
