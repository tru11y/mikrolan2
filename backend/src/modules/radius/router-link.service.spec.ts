import { ManagementMode, RouterLinkAuthMode } from '@prisma/client';
import { RouterLinkService, deriveWgServerIp } from './router-link.service';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/error-codes';
import { BusinessException } from '../../common/exceptions/business.exception';

function makePrisma() {
  return {
    router: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    routerLink: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'link-new' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    routerLinkMember: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
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
function makeConfig(radiusEnabled = true) {
  return {
    get: jest.fn((key: string) => {
      if (key === 'WG_SUBNET_BASE') return '10.20.0.0/24';
      if (key === 'RADIUS_ENABLED') return radiusEnabled;
      return 30;
    }),
  };
}
const config = makeConfig();

const subscriptions = { assertRouterLinking: jest.fn().mockResolvedValue(undefined) };

const clientsSync = { sync: jest.fn().mockResolvedValue(0) };

function build(
  prisma: any,
  remote: any = { run: jest.fn() },
  cfg: any = config,
  subs: any = subscriptions,
) {
  return new RouterLinkService(
    prisma,
    remote as any,
    crypto as any,
    eventLog as any,
    cfg as any,
    subs as any,
    clientsSync as any,
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

describe('createLink', () => {
  it('crée un lien DIRECT avec ses membres (tenantId explicite, audit émis)', async () => {
    const prisma = makePrisma();
    prisma.router.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    prisma.routerLink.findMany.mockResolvedValue([]); // slug libre
    prisma.routerLink.create.mockResolvedValue({ id: 'link-1', authMode: RouterLinkAuthMode.DIRECT });

    await build(prisma).createLink('t1', 'u1', {
      name: 'Hotspot Centre',
      authMode: RouterLinkAuthMode.DIRECT,
      routerIds: ['r1', 'r2'],
    });

    const arg = prisma.routerLink.create.mock.calls[0][0];
    expect(arg.data.tenantId).toBe('t1');
    expect(arg.data.slug).toBe('hotspot-centre');
    expect(arg.data.routers.create).toEqual([
      { tenantId: 't1', routerId: 'r1' },
      { tenantId: 't1', routerId: 'r2' },
    ]);
    expect(eventLog.success).toHaveBeenCalledWith(
      expect.anything(),
      'RouterLink',
      'link-1',
      expect.objectContaining({ authMode: RouterLinkAuthMode.DIRECT }),
      { tenantId: 't1', userId: 'u1' },
    );
  });

  it('option payante : refuse la création si le tenant n\'a pas le droit routerLinking', async () => {
    const prisma = makePrisma();
    const denied = {
      assertRouterLinking: jest.fn().mockRejectedValue(
        new BusinessException(HttpStatus.FORBIDDEN, ErrorCode.ROUTER_LINKING_NOT_ENTITLED, 'x'),
      ),
    };
    await expect(
      build(prisma, undefined, config, denied).createLink('t1', 'u1', {
        name: 'Hotspot Centre',
        authMode: RouterLinkAuthMode.DIRECT,
        routerIds: ['r1'],
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ROUTER_LINKING_NOT_ENTITLED });
    expect(prisma.routerLink.create).not.toHaveBeenCalled();
  });

  it('crée un lien RADIUS en validant chaque routeur (REMOTE ok)', async () => {
    const prisma = makePrisma();
    prisma.router.findMany.mockResolvedValue([{ id: 'r1' }]);
    prisma.router.findFirst.mockResolvedValue({ mode: ManagementMode.REMOTE });
    prisma.routerLink.create.mockResolvedValue({ id: 'link-1' });

    await build(prisma).createLink('t1', 'u1', {
      name: 'L',
      authMode: RouterLinkAuthMode.RADIUS,
      routerIds: ['r1'],
    });
    expect(prisma.router.findFirst).toHaveBeenCalled();
    expect(prisma.routerLink.create).toHaveBeenCalled();
  });

  it('garde-fou : refuse un routeur LOCAL à la création RADIUS', async () => {
    const prisma = makePrisma();
    prisma.router.findMany.mockResolvedValue([{ id: 'r1' }]);
    prisma.router.findFirst.mockResolvedValue({ mode: ManagementMode.LOCAL });

    await expect(
      build(prisma).createLink('t1', 'u1', {
        name: 'L',
        authMode: RouterLinkAuthMode.RADIUS,
        routerIds: ['r1'],
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ROUTER_LINK_LOCAL_NOT_ALLOWED_IN_RADIUS });
    expect(prisma.routerLink.create).not.toHaveBeenCalled();
  });

  it('rejette un routeur hors tenant / inexistant (ROUTER_NOT_FOUND)', async () => {
    const prisma = makePrisma();
    prisma.router.findMany.mockResolvedValue([{ id: 'r1' }]); // r2 absent

    await expect(
      build(prisma).createLink('t1', 'u1', {
        name: 'L',
        authMode: RouterLinkAuthMode.DIRECT,
        routerIds: ['r1', 'r2'],
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ROUTER_NOT_FOUND });
  });
});

describe('addMembers', () => {
  it('garde-fou LOCAL sur un lien RADIUS', async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst.mockResolvedValue({ id: 'link-1', authMode: RouterLinkAuthMode.RADIUS });
    prisma.router.findMany.mockResolvedValue([{ id: 'r9' }]);
    prisma.router.findFirst.mockResolvedValue({ mode: ManagementMode.LOCAL });

    await expect(
      build(prisma).addMembers('t1', 'u1', 'link-1', ['r9']),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ROUTER_LINK_LOCAL_NOT_ALLOWED_IN_RADIUS });
    expect(prisma.routerLinkMember.createMany).not.toHaveBeenCalled();
  });

  it('ajoute les membres avec tenantId (skipDuplicates)', async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst
      .mockResolvedValueOnce({ id: 'link-1', authMode: RouterLinkAuthMode.DIRECT }) // assertOwnLink
      .mockResolvedValueOnce({ id: 'link-1', authMode: RouterLinkAuthMode.DIRECT, routers: [] }); // getLink
    prisma.router.findMany.mockResolvedValue([{ id: 'r1' }]);

    await build(prisma).addMembers('t1', 'u1', 'link-1', ['r1']);
    expect(prisma.routerLinkMember.createMany).toHaveBeenCalledWith({
      data: [{ linkId: 'link-1', tenantId: 't1', routerId: 'r1' }],
      skipDuplicates: true,
    });
  });
});

describe('isolation tenant', () => {
  it('getLink d\'un lien absent pour ce tenant → NOT_FOUND', async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst.mockResolvedValue(null);
    await expect(build(prisma).getLink('t1', 'link-x')).rejects.toMatchObject({
      errorCode: ErrorCode.REMOTE_ACCESS_NOT_FOUND,
    });
    expect(prisma.routerLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'link-x', tenantId: 't1' } }),
    );
  });

  it('activate d\'un lien d\'un autre tenant → NOT_FOUND', async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst.mockResolvedValue(null);
    await expect(build(prisma).activate('t1', 'u1', 'link-x')).rejects.toMatchObject({
      errorCode: ErrorCode.REMOTE_ACCESS_NOT_FOUND,
    });
  });
});

describe('activate (gate RADIUS_ENABLED + délégation)', () => {
  it('RADIUS_ENABLED=false → RADIUS_DISABLED (409), aucune délégation', async () => {
    const prisma = makePrisma();
    await expect(
      build(prisma, { run: jest.fn() }, makeConfig(false)).activate('t1', 'u1', 'link-1'),
    ).rejects.toMatchObject({ errorCode: ErrorCode.RADIUS_DISABLED });
    expect(prisma.routerLink.findFirst).not.toHaveBeenCalled();
  });

  it('RADIUS_ENABLED=true → délègue à activateLink et audite', async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst
      .mockResolvedValueOnce({ id: 'link-1', authMode: RouterLinkAuthMode.RADIUS }) // assertOwnLink
      .mockResolvedValueOnce({ id: 'link-1', authMode: RouterLinkAuthMode.RADIUS }); // activateLink
    prisma.routerLinkMember.findMany.mockResolvedValue([]);
    prisma.routerLinkMember.count.mockResolvedValue(0);

    const res = await build(prisma).activate('t1', 'u1', 'link-1');
    expect(res).toEqual({ total: 0, ready: 0 });
    expect(eventLog.success).toHaveBeenCalledWith(
      expect.anything(),
      'RouterLink',
      'link-1',
      expect.objectContaining({ op: 'activate' }),
      { tenantId: 't1', userId: 'u1' },
    );
  });
});

describe('deactivate (tenant-aware)', () => {
  it('asserte le tenant puis délègue à deactivateLink', async () => {
    const prisma = makePrisma();
    prisma.routerLink.findFirst.mockResolvedValue({ id: 'link-1', authMode: RouterLinkAuthMode.RADIUS });
    prisma.routerLinkMember.findMany.mockResolvedValue([]);
    await build(prisma).deactivate('t1', 'u1', 'link-1');
    expect(prisma.voucher.updateMany).toHaveBeenCalledWith({
      where: { linkId: 'link-1' },
      data: { radiusDistributable: false },
    });
    expect(eventLog.success).toHaveBeenCalledWith(
      expect.anything(),
      'RouterLink',
      'link-1',
      expect.objectContaining({ op: 'deactivate' }),
      { tenantId: 't1', userId: 'u1' },
    );
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
