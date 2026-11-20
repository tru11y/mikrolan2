import { VoucherStatus, RouterLinkAuthMode } from '@prisma/client';
import { RadiusService } from './radius.service';
import type { AuthorizeDto } from './dto/radius.schemas';

const NAS = { routerId: 'router-1', tenantId: 'tenant-1' };

const mockPrisma: Record<string, any> = {
  voucher: { findFirst: jest.fn() },
  session: { aggregate: jest.fn() },
};
const mockEvents = { publish: jest.fn() };
const mockNotifications = { sendPushToTenant: jest.fn() };
const mockConfig = { get: jest.fn().mockReturnValue(30) };
const mockCoa = { disconnectVoucherEverywhere: jest.fn() };
const mockEventLog = { warning: jest.fn() };

function buildService(): RadiusService {
  const service = new RadiusService(
    mockPrisma as any,
    mockEvents as any,
    mockNotifications as any,
    mockConfig as any,
    mockCoa as any,
    mockEventLog as any,
  );
  jest.spyOn(service, 'resolveNas').mockResolvedValue(NAS);
  return service;
}

// 10 Mo de quota = 10 485 760 octets.
const baseVoucher = (overrides: Record<string, any> = {}) => ({
  id: 'voucher-1',
  code: 'ABC123',
  tenantId: 'tenant-1',
  routerId: 'router-1',
  linkId: null,
  status: VoucherStatus.GENERATED,
  mikrotikId: 'mt-1',
  usedAt: null,
  plan: {
    priceXof: 500,
    durationMinutes: 60,
    dataLimitMb: 10,
    uploadKbps: 1000,
    downloadKbps: 2000,
  },
  link: null,
  ...overrides,
});

const authDto = (over: Partial<AuthorizeDto> = {}): AuthorizeDto =>
  ({ 'User-Name': 'ABC123', 'NAS-IP-Address': '10.20.0.2', ...over }) as AuthorizeDto;

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.get.mockReturnValue(30);
  mockPrisma.session.aggregate.mockResolvedValue({ _sum: { bytesIn: 0n, bytesOut: 0n } });
});

describe('RadiusService.authorize', () => {
  it('Accept : Total-Limit = quota - usedBytes, Session-Timeout, Rate-Limit, Interim', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(baseVoucher());
    // Déjà 1 Mo consommé sur une autre session.
    mockPrisma.session.aggregate.mockResolvedValue({
      _sum: { bytesIn: 500_000n, bytesOut: 548_576n },
    });

    const reply = await service.authorize(authDto());

    expect(reply['control:Auth-Type']).toBe('Accept');
    expect(reply).toMatchObject({
      'reply:Session-Timeout': 60 * 60,
      'reply:Mikrotik-Total-Limit': (10n * 1024n * 1024n - 1_048_576n).toString(),
      'reply:Mikrotik-Rate-Limit': '1000k/2000k',
      'reply:Acct-Interim-Interval': 30,
    });
  });

  it('Accept illimité : pas de Total-Limit quand dataLimitMb est null', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(
      baseVoucher({ plan: { priceXof: 500, durationMinutes: 60, dataLimitMb: null, uploadKbps: null, downloadKbps: null } }),
    );

    const reply = await service.authorize(authDto());

    expect(reply['control:Auth-Type']).toBe('Accept');
    expect(reply).not.toHaveProperty('reply:Mikrotik-Total-Limit');
    expect(reply).not.toHaveProperty('reply:Mikrotik-Rate-Limit');
  });

  it('Accept en mode lien RADIUS : NAS membre du lien, quota partagé plan', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(
      baseVoucher({
        routerId: 'router-other',
        linkId: 'link-1',
        link: { authMode: RouterLinkAuthMode.RADIUS, routers: [{ routerId: 'router-1' }, { routerId: 'router-2' }] },
      }),
    );

    const reply = await service.authorize(authDto());
    expect(reply['control:Auth-Type']).toBe('Accept');
  });

  it('Reject : quota épuisé via agrégat multi-session', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(baseVoucher());
    mockPrisma.session.aggregate.mockResolvedValue({
      _sum: { bytesIn: 6n * 1024n * 1024n, bytesOut: 5n * 1024n * 1024n }, // 11 Mo > 10 Mo
    });

    const reply = await service.authorize(authDto());
    expect(reply['control:Auth-Type']).toBe('Reject');
    expect(mockEventLog.warning).toHaveBeenCalled();
  });

  it.each([VoucherStatus.REVOKED, VoucherStatus.EXPIRED, VoucherStatus.USED])(
    'Reject : statut %s',
    async (status) => {
      const service = buildService();
      mockPrisma.voucher.findFirst.mockResolvedValue(baseVoucher({ status }));
      const reply = await service.authorize(authDto());
      expect(reply['control:Auth-Type']).toBe('Reject');
    },
  );

  it('Reject : voucher non provisionné (mikrotikId absent)', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(baseVoucher({ mikrotikId: null }));
    const reply = await service.authorize(authDto());
    expect(reply['control:Auth-Type']).toBe('Reject');
  });

  it('Reject cross-tenant : voucher d’un autre tenant ET NAS hors lien + audit', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(
      baseVoucher({ tenantId: 'tenant-2', routerId: 'router-foreign' }),
    );

    const reply = await service.authorize(authDto());

    expect(reply['control:Auth-Type']).toBe('Reject');
    expect(mockEventLog.warning).toHaveBeenCalledWith(
      expect.anything(),
      'Voucher',
      undefined,
      expect.objectContaining({ reason: 'CROSS_TENANT' }),
      expect.objectContaining({ tenantId: 'tenant-1' }),
    );
  });

  it('Reject : NAS inconnu (resolveNas null)', async () => {
    const service = buildService();
    (service.resolveNas as jest.Mock).mockResolvedValue(null);
    const reply = await service.authorize(authDto());
    expect(reply['control:Auth-Type']).toBe('Reject');
    expect(mockPrisma.voucher.findFirst).not.toHaveBeenCalled();
  });
});
