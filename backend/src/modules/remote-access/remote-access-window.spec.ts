import { HttpStatus } from '@nestjs/common';
import { RemoteAccessService } from './remote-access.service';
import { clientIpv4 } from './remote-access.controller';
import { openAccessWindows } from './wireguard-reconciler.service';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { tenantStore } from '../../common/context/tenant-context';

const NOW = new Date('2026-10-18T12:00:00Z');
const in10min = new Date(NOW.getTime() + 600_000);
const ago = new Date(NOW.getTime() - 1);

describe('openAccessWindows', () => {
  const p = (accessOpenUntil: Date | null, accessSourceIp: string | null) => ({ accessOpenUntil, accessSourceIp });

  it('ne garde que les fenêtres ouvertes avec une IP', () => {
    const kept = openAccessWindows(
      [p(in10min, '1.1.1.1'), p(ago, '2.2.2.2'), p(null, null), p(in10min, null), p(null, '3.3.3.3')],
      NOW,
    );
    expect(kept.map((x) => x.accessSourceIp)).toEqual(['1.1.1.1']);
  });
});

describe('clientIpv4', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8::1', null],
    ['999.0.0.1', null],
    ['', null],
  ])('%s → %s', (input, out) => expect(clientIpv4(input)).toBe(out));
});

describe('RemoteAccessService access window', () => {
  const peer = {
    id: 'p1', routerId: 'r1', status: 'ACTIVE', wgIp: '10.20.0.2', allocatedPort: 41_000,
    webfigPort: 80, sshPort: 22, winboxPort: 8291, accessOpenUntil: null as Date | null, accessSourceIp: null as string | null,
  };

  function build(over: Partial<typeof peer> = {}, allowed = true) {
    const row = { ...peer, ...over };
    const prisma: any = {
      remotePeer: { findFirst: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue(undefined) },
    };
    const wg: any = {
      addDnat: jest.fn().mockResolvedValue(undefined),
      removeDnat: jest.fn().mockResolvedValue(undefined),
      vpsPublicIp: '198.51.100.1',
    };
    const subscriptions: any = { isRemoteAllowed: jest.fn().mockResolvedValue(allowed) };
    const service = new RemoteAccessService(prisma, subscriptions, wg, {} as never, makeEventLogStub() as never);
    const run = <T>(fn: () => Promise<T>) =>
      tenantStore.run({ ctx: { tenantId: 't1', userId: 'u1', role: 'ADMIN' } as never }, fn);
    return { service, prisma, wg, run };
  }

  it('status : pas d’URL publique tant qu’aucune fenêtre n’est ouverte', async () => {
    const { service, run } = build();
    const res = await run(() => service.status('r1'));
    expect(res).toMatchObject({ status: 'ACTIVE', accessUrls: null });
    expect(res).not.toHaveProperty('accessSourceIp');
  });

  it('status : URLs seulement pendant la fenêtre', async () => {
    const open = build({ accessSourceIp: '1.1.1.1', accessOpenUntil: new Date(Date.now() + 60_000) });
    expect((await open.run(() => open.service.status('r1')) as any).accessUrls.webfig.port).toBe(41_000);
    const expired = build({ accessSourceIp: '1.1.1.1', accessOpenUntil: new Date(Date.now() - 1) });
    expect((await expired.run(() => expired.service.status('r1')) as any).accessUrls).toBeNull();
  });

  it('openAccess : DNAT restreint à l’IP, fenêtre persistée avec expiration', async () => {
    const { service, wg, prisma, run } = build();
    const res = await run(() => service.openAccess('r1', 'u1', '203.0.113.7', 15));
    expect(wg.addDnat).toHaveBeenCalledWith('10.20.0.2', 41_000, { webfigPort: 80, sshPort: 22, winboxPort: 8291 }, '203.0.113.7');
    const data = prisma.remotePeer.update.mock.calls[0][0].data;
    expect(data.accessSourceIp).toBe('203.0.113.7');
    expect(data.accessOpenUntil.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect((res as any).accessUrls.ssh.port).toBe(42_000);
  });

  it('openAccess : change d’IP → retire d’abord les règles de l’ancienne IP', async () => {
    const { service, wg, run } = build({ accessSourceIp: '1.1.1.1', accessOpenUntil: new Date(Date.now() + 60_000) });
    await run(() => service.openAccess('r1', 'u1', '2.2.2.2', 5));
    expect(wg.removeDnat).toHaveBeenCalledWith('10.20.0.2', 41_000, expect.anything(), '1.1.1.1');
    expect(wg.removeDnat.mock.invocationCallOrder[0]).toBeLessThan(wg.addDnat.mock.invocationCallOrder[0]);
  });

  it('openAccess : refusé sans abonnement, peer inactif, ou échec iptables (rien en base)', async () => {
    const noSub = build({}, false);
    await expect(noSub.run(() => noSub.service.openAccess('r1', 'u1', '1.1.1.1', 5))).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });

    const revoked = build({ status: 'REVOKED' });
    await expect(revoked.run(() => revoked.service.openAccess('r1', 'u1', '1.1.1.1', 5))).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });

    const boom = build();
    boom.wg.addDnat.mockRejectedValue(new Error('iptables'));
    await expect(boom.run(() => boom.service.openAccess('r1', 'u1', '1.1.1.1', 5))).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    expect(boom.prisma.remotePeer.update).not.toHaveBeenCalled();
  });

  it('closeAccess : supprime les règles et efface la fenêtre', async () => {
    const { service, wg, prisma, run } = build({ accessSourceIp: '1.1.1.1', accessOpenUntil: new Date(Date.now() + 60_000) });
    await expect(run(() => service.closeAccess('r1', 'u1'))).resolves.toEqual({ closed: true });
    expect(wg.removeDnat).toHaveBeenCalledWith('10.20.0.2', 41_000, expect.anything(), '1.1.1.1');
    expect(prisma.remotePeer.update.mock.calls[0][0].data).toEqual({ accessOpenUntil: null, accessSourceIp: null });
  });
});
