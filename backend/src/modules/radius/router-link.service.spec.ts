import { ManagementMode, RouterLinkAuthMode } from '@prisma/client';
import { RouterLinkService, deriveWgServerIp } from './router-link.service';
import { ErrorCode } from '../../common/error-codes';

function makePrisma() {
  return {
    router: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    routerLink: { findFirst: jest.fn() },
    routerLinkMember: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    voucher: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

const crypto = {
  encrypt: jest.fn((s: string) => `enc(${s})`),
  decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
};
const eventLog = { warning: jest.fn(), success: jest.fn() };
const config = {
  get: jest.fn((key: string) => (key === 'WG_SUBNET_BASE' ? '10.20.0.0/24' : 30)),
};

function build(prisma: any, remote: any = { run: jest.fn() }) {
  return new RouterLinkService(
    prisma,
    remote as any,
    crypto as any,
    eventLog as any,
    config as any,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('deriveWgServerIp', () => {
  it('= premier host du subnet (gateway .1)', () => {
    expect(deriveWgServerIp('10.20.0.0/24')).toBe('10.20.0.1');
    expect(deriveWgServerIp('10.50.0.0/16')).toBe('10.50.0.1');
  });
});

describe('assertRouterAllowedInRadiusLink', () => {
  it('refuse un routeur LOCAL dans un lien RADIUS', async () => {
    const prisma = makePrisma();
    prisma.router.findFirst.mockResolvedValue({ mode: ManagementMode.LOCAL });
    await expect(build(prisma).assertRouterAllowedInRadiusLink('r1')).rejects.toMatchObject({
      errorCode: ErrorCode.ROUTER_LINK_LOCAL_NOT_ALLOWED_IN_RADIUS,
    });
  });

  it('autorise un routeur REMOTE', async () => {
    const prisma = makePrisma();
    prisma.router.findFirst.mockResolvedValue({ mode: ManagementMode.REMOTE });
    await expect(build(prisma).assertRouterAllowedInRadiusLink('r1')).resolves.toBeUndefined();
  });
});

describe('activateLink', () => {
  const radiusLink = { id: 'link-1', authMode: RouterLinkAuthMode.RADIUS };

  function member(id: string, routerId: string, mode: ManagementMode = ManagementMode.REMOTE) {
    return { id, routerId, router: { mode } };
  }

  it('confirme radiusReadyAt pour chaque membre provisionné et rend les vouchers distribuables', async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst.mockResolvedValue(radiusLink);
    prisma.routerLinkMember.findMany.mockResolvedValue([
      member('m1', 'r1'),
      member('m2', 'r2'),
    ]);
    prisma.router.findFirst.mockResolvedValue({ radiusSecretEncrypted: 'enc(sec)' });
    // tous prêts
    prisma.routerLinkMember.count
      .mockResolvedValueOnce(2) // total
      .mockResolvedValueOnce(2); // ready
    const remote = { run: jest.fn(async (_id: string, fn: any) => fn({})) };
    // hotspotProfileUsesRadius appelé dans le callback → on simule via le client :
    // profileNameForServer puis use-radius. On mock remote.run pour renvoyer true.
    remote.run = jest.fn().mockResolvedValue(true);

    const res = await build(prisma, remote).activateLink('link-1');

    expect(prisma.routerLinkMember.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { radiusReadyAt: expect.any(Date) },
    });
    expect(prisma.routerLinkMember.update).toHaveBeenCalledWith({
      where: { id: 'm2' },
      data: { radiusReadyAt: expect.any(Date) },
    });
    expect(prisma.voucher.updateMany).toHaveBeenCalledWith({
      where: { linkId: 'link-1' },
      data: { radiusDistributable: true },
    });
    expect(res).toEqual({ total: 2, ready: 2 });
  });

  it("l'échec d'un membre n'empêche pas les autres (per-router) et bloque la distribuabilité", async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst.mockResolvedValue(radiusLink);
    prisma.routerLinkMember.findMany.mockResolvedValue([
      member('m1', 'r1'),
      member('m2', 'r2'),
    ]);
    prisma.router.findFirst.mockResolvedValue({ radiusSecretEncrypted: 'enc(sec)' });
    prisma.routerLinkMember.count
      .mockResolvedValueOnce(2) // total
      .mockResolvedValueOnce(1); // only 1 ready
    const remote = {
      run: jest
        .fn()
        .mockRejectedValueOnce(new Error('unreachable')) // m1 échoue
        .mockResolvedValueOnce(true), // m2 ok
    };

    const res = await build(prisma, remote).activateLink('link-1');

    // m1 n'est jamais confirmé, m2 oui
    expect(prisma.routerLinkMember.update).toHaveBeenCalledTimes(1);
    expect(prisma.routerLinkMember.update).toHaveBeenCalledWith({
      where: { id: 'm2' },
      data: { radiusReadyAt: expect.any(Date) },
    });
    expect(eventLog.warning).toHaveBeenCalledWith(
      expect.anything(),
      'RouterLinkMember',
      'm1',
      expect.objectContaining({ errorCode: ErrorCode.RADIUS_PROVISION_FAILED }),
    );
    // pas tous prêts → vouchers non distribuables
    expect(prisma.voucher.updateMany).toHaveBeenCalledWith({
      where: { linkId: 'link-1' },
      data: { radiusDistributable: false },
    });
    expect(res).toEqual({ total: 2, ready: 1 });
  });

  it('génère et persiste un secret chiffré si absent', async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst.mockResolvedValue(radiusLink);
    prisma.routerLinkMember.findMany.mockResolvedValue([member('m1', 'r1')]);
    prisma.router.findFirst.mockResolvedValue({ radiusSecretEncrypted: null });
    prisma.routerLinkMember.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const remote = { run: jest.fn().mockResolvedValue(true) };

    await build(prisma, remote).activateLink('link-1');

    expect(prisma.router.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { radiusSecretEncrypted: expect.stringMatching(/^enc\(/) },
    });
  });

  it('ignore les membres LOCAL (V1 REMOTE only)', async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst.mockResolvedValue(radiusLink);
    prisma.routerLinkMember.findMany.mockResolvedValue([
      member('m1', 'r1', ManagementMode.LOCAL),
    ]);
    prisma.routerLinkMember.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const remote = { run: jest.fn() };

    await build(prisma, remote).activateLink('link-1');

    expect(remote.run).not.toHaveBeenCalled();
    expect(prisma.routerLinkMember.update).not.toHaveBeenCalled();
  });
});

describe('deactivateLink', () => {
  it('retire la délégation, remet radiusReadyAt=null et radiusDistributable=false', async () => {
    const prisma = makePrisma();
    prisma.routerLinkMember.findMany.mockResolvedValue([
      { id: 'm1', routerId: 'r1', router: { mode: ManagementMode.REMOTE } },
    ]);
    const remote = { run: jest.fn().mockResolvedValue(undefined) };

    await build(prisma, remote).deactivateLink('link-1');

    expect(remote.run).toHaveBeenCalled();
    expect(prisma.routerLinkMember.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { radiusReadyAt: null },
    });
    expect(prisma.voucher.updateMany).toHaveBeenCalledWith({
      where: { linkId: 'link-1' },
      data: { radiusDistributable: false },
    });
  });
});
