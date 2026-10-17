import { HttpStatus } from '@nestjs/common';
import { AdminWireGuardService } from './admin-wireguard.service';
import { makeEventLogStub } from '../../common/testing/event-log.stub';

const NOW_MS = 1_700_000_000_000;
const NOW_S = NOW_MS / 1000;

type PeerFixture = {
  id: string;
  routerId: string;
  tenantId: string;
  wgPublicKey: string;
  wgIp: string;
  allocatedPort: number;
  status: 'PENDING' | 'ACTIVE' | 'REVOKED' | 'ERROR';
  provisionedAt: Date | null;
  revokedAt: Date | null;
  webfigPort: number;
  sshPort: number;
  winboxPort: number;
  router: { id: string; alias: string | null; identity: string; health: string; mode: string; lastHeartbeat: Date | null };
};

function peer(over: Partial<PeerFixture> & { key: string; alias: string }): PeerFixture {
  const { key, alias, ...rest } = over;
  return {
    id: `peer-${key}`,
    routerId: `router-${key}`,
    tenantId: 'tenant-1',
    wgPublicKey: `pk-${key}`,
    wgIp: '10.20.0.2',
    allocatedPort: 20_001,
    status: 'ACTIVE',
    provisionedAt: new Date(NOW_MS - 3 * 86_400_000),
    revokedAt: null,
    webfigPort: 80,
    sshPort: 22,
    winboxPort: 8291,
    router: { id: `router-${key}`, alias, identity: `id-${key}`, health: 'OFFLINE', mode: 'REMOTE', lastHeartbeat: null },
    ...rest,
  };
}

function build(opts: { peers: PeerFixture[]; live?: Record<string, unknown> | Error; enabled?: boolean }) {
  const prisma: any = {
    remotePeer: {
      findMany: jest.fn().mockResolvedValue(opts.peers),
      findFirst: jest.fn(async ({ where }: any) => opts.peers.find((p) => p.routerId === where.routerId) ?? null),
      update: jest.fn(),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'tenant-1', name: 'Jambo NETWORKS' },
        { id: 'tenant-2', name: 'Kouadio' },
      ]),
    },
    router: { update: jest.fn() },
    $transaction: jest.fn((fn: (tx: any) => unknown) => fn(prisma)),
  };
  const wg: any = {
    enabled: opts.enabled ?? true,
    livePeers: jest.fn(async () => {
      if (opts.live instanceof Error) throw opts.live;
      return opts.live ?? {};
    }),
    addPeer: jest.fn().mockResolvedValue(undefined),
    removePeer: jest.fn().mockResolvedValue(undefined),
    addDnat: jest.fn().mockResolvedValue(undefined),
    removeDnat: jest.fn().mockResolvedValue(undefined),
  };
  const eventLog = makeEventLogStub();
  const service = new AdminWireGuardService(prisma, wg, eventLog as any);
  return { service, prisma, wg, eventLog };
}

const actor = { userId: 'admin-1', tenantId: 'platform' };
const query = (over: Record<string, unknown> = {}) => ({ limit: 100, ...over }) as any;

beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW_MS));
afterEach(() => jest.restoreAllMocks());

describe('AdminWireGuardService.listPeers', () => {
  const peers = [
    peer({ key: 'ok', alias: 'FreeMpto', wgIp: '10.20.0.4' }),
    peer({ key: 'never', alias: 'FREEDOM HOME', wgIp: '10.20.0.7' }),
    peer({ key: 'stale', alias: 'CARINE', tenantId: 'tenant-2', wgIp: '10.20.0.6' }),
    peer({ key: 'rev', alias: 'Old', status: 'REVOKED', wgIp: '10.20.0.9' }),
  ];
  const live = {
    'pk-ok': { endpoint: '41.1.1.1:5000', latestHandshake: NOW_S - 40, rxBytes: 100, txBytes: 200 },
    'pk-stale': { endpoint: '41.2.2.2:5000', latestHandshake: NOW_S - 3600, rxBytes: 1, txBytes: 2 },
    'pk-ghost': { endpoint: null, latestHandshake: 5, rxBytes: 0, txBytes: 0 },
  };

  it('classe chaque peer, trie les cassés en tête et n’expose jamais la clé publique', async () => {
    const { service } = build({ peers, live });
    const res = await service.listPeers(query());

    expect(res.items.map((i) => [i.router.alias, i.state])).toEqual([
      ['FREEDOM HOME', 'NEVER'],
      ['CARINE', 'STALE'],
      ['FreeMpto', 'HEALTHY'],
      ['Old', 'REVOKED'],
    ]);
    expect(JSON.stringify(res)).not.toContain('pk-');
    expect(res.items.find((i) => i.state === 'HEALTHY')).toMatchObject({
      handshakeAgeS: 40,
      rxBytes: 100,
      txBytes: 200,
      clientEndpoint: '41.1.1.1:5000',
      tenant: { id: 'tenant-1', name: 'Jambo NETWORKS' },
    });
    expect(res.items.find((i) => i.state === 'NEVER')).toMatchObject({
      lastHandshakeAt: null,
      handshakeAgeS: null,
      clientEndpoint: null,
    });
  });

  it('résumé sur tous les peers + dérive wg/base', async () => {
    const { service } = build({ peers, live });
    const { summary } = await service.listPeers(query());
    expect(summary).toMatchObject({
      total: 4,
      healthy: 1,
      stale: 1,
      never: 1,
      revoked: 1,
      wgEnabled: true,
      liveAvailable: true,
      // pk-ghost est dans wg mais pas en base ; pk-never est ACTIVE en base mais absent de wg
      drift: { liveNotInDb: 1, dbActiveNotLive: 1 },
    });
  });

  it('le résumé ignore les filtres, la liste les applique', async () => {
    const { service } = build({ peers, live });
    const res = await service.listPeers(query({ state: 'STALE' }));
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
    expect(res.summary.total).toBe(4);
  });

  it('recherche par alias, identité ou tenant (insensible à la casse)', async () => {
    const { service } = build({ peers, live });
    expect((await service.listPeers(query({ q: 'freedom' }))).items.map((i) => i.router.alias)).toEqual(['FREEDOM HOME']);
    expect((await service.listPeers(query({ q: 'kouadio' }))).items.map((i) => i.router.alias)).toEqual(['CARINE']);
    expect((await service.listPeers(query({ q: 'id-ok' }))).items).toHaveLength(1);
  });

  it('filtre par tenant et respecte limit tout en gardant le total', async () => {
    const { service } = build({ peers, live });
    expect((await service.listPeers(query({ tenantId: 'tenant-2' }))).items).toHaveLength(1);
    const limited = await service.listPeers(query({ limit: 2 }));
    expect(limited.items).toHaveLength(2);
    expect(limited.total).toBe(4);
  });

  it('wg en échec : UNKNOWN pour les ACTIVE (jamais NEVER) et liveAvailable=false', async () => {
    const { service } = build({ peers, live: new Error('wg: not found') });
    const res = await service.listPeers(query());
    const states = Object.fromEntries(res.items.map((i) => [i.router.alias, i.state]));
    expect(states).toMatchObject({ 'FREEDOM HOME': 'UNKNOWN', CARINE: 'UNKNOWN', FreeMpto: 'UNKNOWN', Old: 'REVOKED' });
    expect(res.summary).toMatchObject({ liveAvailable: false, drift: { liveNotInDb: 0, dbActiveNotLive: 0 } });
  });

  it('WG désactivé : liveAvailable=false sans appeler wg', async () => {
    const { service, wg } = build({ peers, enabled: false });
    const res = await service.listPeers(query());
    expect(wg.livePeers).not.toHaveBeenCalled();
    expect(res.summary).toMatchObject({ wgEnabled: false, liveAvailable: false });
  });
});

describe('AdminWireGuardService.resync', () => {
  const active = peer({ key: 'a', alias: 'AZ_OPEN', webfigPort: 8080 });

  it('ré-applique le peer avec la clé et les ports stockés, sans doublonner le DNAT', async () => {
    const { service, wg, eventLog } = build({ peers: [active] });
    await expect(service.resync('router-a', actor)).resolves.toEqual({ resynced: true });

    expect(wg.addPeer).toHaveBeenCalledWith('pk-a', '10.20.0.2');
    const ports = { webfigPort: 8080, sshPort: 22, winboxPort: 8291 };
    expect(wg.removeDnat).toHaveBeenCalledWith('10.20.0.2', 20_001, ports);
    expect(wg.addDnat).toHaveBeenCalledWith('10.20.0.2', 20_001, ports);
    expect(wg.removeDnat.mock.invocationCallOrder[0]).toBeLessThan(wg.addDnat.mock.invocationCallOrder[0]);
    expect(eventLog.success).toHaveBeenCalledWith(
      'UPDATE',
      'RemotePeer',
      'router-a',
      expect.objectContaining({ kind: 'wg-resync', targetTenantId: 'tenant-1' }),
      { tenantId: 'platform', userId: 'admin-1' },
    );
  });

  it('404 sans peer, 409 si le peer n’est pas ACTIVE', async () => {
    const { service } = build({ peers: [peer({ key: 'r', alias: 'R', status: 'REVOKED' })] });
    await expect(service.resync('inconnu', actor)).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    await expect(service.resync('router-r', actor)).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('503 si WireGuard est désactivé (ne simule pas un succès)', async () => {
    const { service, wg } = build({ peers: [active], enabled: false });
    await expect(service.resync('router-a', actor)).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    expect(wg.addPeer).not.toHaveBeenCalled();
  });

  it('échec wg : 503, échec audité, aucune écriture en base', async () => {
    const { service, wg, eventLog, prisma } = build({ peers: [active] });
    wg.addDnat.mockRejectedValue(new Error('iptables boom'));
    await expect(service.resync('router-a', actor)).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    expect(eventLog.failure).toHaveBeenCalled();
    expect(prisma.remotePeer.update).not.toHaveBeenCalled();
  });
});

describe('AdminWireGuardService.revoke', () => {
  const active = peer({ key: 'a', alias: 'AZ_OPEN' });
  const dto = (confirmName: string) => ({ reason: 'tunnel jamais établi', confirmName });

  it('révoque : retire le peer et le DNAT, REVOKED en base, routeur repassé LOCAL, audité', async () => {
    const { service, wg, prisma, eventLog } = build({ peers: [active] });
    const res = await service.revoke('router-a', dto('az_open'), actor); // casse ignorée

    expect(res).toEqual({ revoked: true, wgRemoved: true });
    expect(wg.removePeer).toHaveBeenCalledWith('pk-a');
    expect(wg.removeDnat).toHaveBeenCalled();
    expect(prisma.remotePeer.update).toHaveBeenCalledWith({
      where: { id: 'peer-a' },
      data: expect.objectContaining({ status: 'REVOKED', revokedAt: expect.any(Date) }),
    });
    expect(prisma.router.update).toHaveBeenCalledWith({ where: { id: 'router-a' }, data: { mode: 'LOCAL' } });
    expect(eventLog.success).toHaveBeenCalledWith(
      'REVOKE',
      'RemotePeer',
      'router-a',
      expect.objectContaining({ reason: 'tunnel jamais établi', targetTenantId: 'tenant-1' }),
      { tenantId: 'platform', userId: 'admin-1' },
    );
  });

  it('mauvais nom : 400, rien n’est touché', async () => {
    const { service, wg, prisma } = build({ peers: [active] });
    await expect(service.revoke('router-a', dto('autre'), actor)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(wg.removePeer).not.toHaveBeenCalled();
    expect(prisma.remotePeer.update).not.toHaveBeenCalled();
  });

  it('confirmation par identité quand le routeur n’a pas d’alias', async () => {
    const noAlias = peer({ key: 'n', alias: 'x' });
    noAlias.router.alias = null;
    const { service } = build({ peers: [noAlias] });
    await expect(service.revoke('router-n', dto('id-n'), actor)).resolves.toMatchObject({ revoked: true });
  });

  it('déjà REVOKED : 409', async () => {
    const { service } = build({ peers: [peer({ key: 'r', alias: 'R', status: 'REVOKED' })] });
    await expect(service.revoke('router-r', dto('r'), actor)).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('retrait wg en échec : la base est quand même révoquée, avertissement audité', async () => {
    const { service, wg, prisma, eventLog } = build({ peers: [active] });
    wg.removePeer.mockRejectedValue(new Error('wg set failed'));
    const res = await service.revoke('router-a', dto('AZ_OPEN'), actor);

    expect(res).toEqual({ revoked: true, wgRemoved: false });
    expect(prisma.remotePeer.update).toHaveBeenCalled();
    expect(eventLog.warning).toHaveBeenCalledWith(
      'REVOKE',
      'RemotePeer',
      'router-a',
      expect.objectContaining({ errorCode: 'WG_PEER_REMOVAL_FAILED' }),
      expect.any(Object),
    );
    expect(eventLog.success).not.toHaveBeenCalled();
  });

  it('peer inexistant : 404', async () => {
    const { service } = build({ peers: [active] });
    await expect(service.revoke('inconnu', dto('x'), actor)).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });
});
