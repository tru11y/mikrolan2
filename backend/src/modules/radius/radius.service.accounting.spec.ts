import { VoucherStatus, SessionStatus } from '@prisma/client';
import { RadiusService } from './radius.service';
import type { AccountingDto } from './dto/radius.schemas';

const NAS = { routerId: 'router-1', tenantId: 'tenant-1' };

const mockPrisma: Record<string, any> = {
  voucher: { findFirst: jest.fn(), updateMany: jest.fn() },
  notification: { create: jest.fn() },
  session: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    aggregate: jest.fn(),
    updateMany: jest.fn(),
  },
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

const voucher = (over: Record<string, any> = {}) => ({
  id: 'voucher-1',
  code: 'ABC123',
  tenantId: 'tenant-1',
  routerId: 'router-1',
  linkId: null,
  status: VoucherStatus.GENERATED,
  mikrotikId: 'mt-1',
  usedAt: null,
  plan: { priceXof: 500, durationMinutes: 60, dataLimitMb: 10, uploadKbps: 1000, downloadKbps: 2000 },
  link: null,
  ...over,
});

const acct = (over: Partial<Record<string, unknown>> = {}): AccountingDto =>
  ({
    'Acct-Status-Type': 'Start',
    'User-Name': 'ABC123',
    'NAS-IP-Address': '10.20.0.2',
    'NAS-Identifier': 'nas-1',
    'Acct-Session-Id': 'sess-1',
    'Acct-Unique-Session-Id': 'uniq-1',
    'Acct-Input-Octets': 0n,
    'Acct-Output-Octets': 0n,
    'Acct-Input-Gigawords': 0n,
    'Acct-Output-Gigawords': 0n,
    'Acct-Session-Time': 0n,
    'Framed-IP-Address': '10.5.50.3',
    'Calling-Station-Id': 'AA:BB:CC',
    ...over,
  }) as AccountingDto;

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.get.mockReturnValue(30);
  mockPrisma.voucher.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.notification.create.mockResolvedValue({ id: 'notif-1' });
  mockPrisma.session.findUnique.mockResolvedValue(null);
  mockPrisma.session.upsert.mockResolvedValue({});
  mockPrisma.session.aggregate.mockResolvedValue({ _sum: { bytesIn: 0n, bytesOut: 0n } });
});

describe('RadiusService.accounting — Accounting-On/Off', () => {
  it('termine toutes les sessions ACTIVE du routeur', async () => {
    const service = buildService();
    await service.accounting(acct({ 'Acct-Status-Type': 'Accounting-On', 'User-Name': undefined }));
    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
      where: { routerId: 'router-1', status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.TERMINATED, terminatedAt: expect.any(Date) },
    });
    expect(mockPrisma.voucher.findFirst).not.toHaveBeenCalled();
  });
});

describe('RadiusService.accounting — Start', () => {
  it('promotion idempotente + snapshot revenu identique à reconcileActive + VOUCHER_ACTIVATED une fois', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(voucher());

    await service.accounting(acct());

    expect(mockPrisma.voucher.updateMany).toHaveBeenCalledWith({
      where: { id: 'voucher-1', status: VoucherStatus.GENERATED },
      data: expect.objectContaining({
        status: VoucherStatus.ACTIVE,
        priceXofAtActivation: 500,
        priceSnapshotSource: 'EXACT',
        usedAt: expect.any(Date),
      }),
    });
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
    expect(mockEvents.publish).toHaveBeenCalledTimes(1);
    expect(mockNotifications.sendPushToTenant).toHaveBeenCalledTimes(1);
    expect(mockPrisma.session.upsert).toHaveBeenCalledTimes(1);
  });

  it('course perdue (updateMany count 0) → pas de notification', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(voucher());
    mockPrisma.voucher.updateMany.mockResolvedValue({ count: 0 });

    await service.accounting(acct());

    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    // La session est tout de même persistée.
    expect(mockPrisma.session.upsert).toHaveBeenCalledTimes(1);
  });

  it('voucher déjà ACTIVE → aucune promotion ni notification', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(voucher({ status: VoucherStatus.ACTIVE, usedAt: new Date() }));

    await service.accounting(acct());

    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    expect(mockPrisma.session.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('RadiusService.accounting — Interim', () => {
  it('compteurs absolus assemblés avec Gigawords (sans delta) + lastSeenAt', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(voucher({ status: VoucherStatus.ACTIVE, usedAt: new Date() }));

    await service.accounting(
      acct({
        'Acct-Status-Type': 'Interim-Update',
        'Acct-Input-Octets': 5n,
        'Acct-Input-Gigawords': 2n,
        'Acct-Output-Octets': 7n,
        'Acct-Output-Gigawords': 0n,
      }),
    );

    const call = mockPrisma.session.upsert.mock.calls[0][0];
    expect(call.create.bytesIn).toBe(5n + 2n * 4_294_967_296n);
    expect(call.create.bytesOut).toBe(7n);
    expect(call.update.lastSeenAt).toBeInstanceOf(Date);
    expect(call.create.status).toBe(SessionStatus.ACTIVE);
  });

  it('ne recule jamais : max(reçu, stocké) sur un rejeu', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(voucher({ status: VoucherStatus.ACTIVE, usedAt: new Date() }));
    mockPrisma.session.findUnique.mockResolvedValue({ bytesIn: 9_000n, bytesOut: 9_000n });

    await service.accounting(
      acct({ 'Acct-Status-Type': 'Interim-Update', 'Acct-Input-Octets': 10n, 'Acct-Output-Octets': 10n }),
    );

    const call = mockPrisma.session.upsert.mock.calls[0][0];
    expect(call.update.bytesIn).toBe(9_000n); // stocké conservé
    expect(call.update.bytesOut).toBe(9_000n);
  });

  it('CoA déclenché quand le quota partagé est dépassé', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(voucher({ status: VoucherStatus.ACTIVE, usedAt: new Date() }));
    // 2 sessions sur 2 routeurs, somme > 10 Mo.
    mockPrisma.session.aggregate.mockResolvedValue({
      _sum: { bytesIn: 6n * 1024n * 1024n, bytesOut: 6n * 1024n * 1024n },
    });

    await service.accounting(acct({ 'Acct-Status-Type': 'Interim-Update' }));

    expect(mockCoa.disconnectVoucherEverywhere).toHaveBeenCalledWith('voucher-1');
  });
});

describe('RadiusService.accounting — Stop', () => {
  it('termine la session, compteurs finaux, sans recalcul de revenu', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(voucher({ status: VoucherStatus.ACTIVE, usedAt: new Date() }));

    await service.accounting(
      acct({ 'Acct-Status-Type': 'Stop', 'Acct-Output-Octets': 42n }),
    );

    const call = mockPrisma.session.upsert.mock.calls[0][0];
    expect(call.update.status).toBe(SessionStatus.TERMINATED);
    expect(call.update.terminatedAt).toBeInstanceOf(Date);
    expect(call.create.bytesOut).toBe(42n);
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
  });
});

describe('RadiusService.accounting — isolation / garde-fous', () => {
  it('ignore (200) un NAS inconnu sans toucher au voucher', async () => {
    const service = buildService();
    (service.resolveNas as jest.Mock).mockResolvedValue(null);
    await service.accounting(acct());
    expect(mockPrisma.voucher.findFirst).not.toHaveBeenCalled();
  });

  it('ignore un Start sans Acct-Unique-Session-Id', async () => {
    const service = buildService();
    await service.accounting(acct({ 'Acct-Unique-Session-Id': undefined }));
    expect(mockPrisma.voucher.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.session.upsert).not.toHaveBeenCalled();
  });

  it('ignore un voucher dont l’isolation échoue (cross-tenant)', async () => {
    const service = buildService();
    mockPrisma.voucher.findFirst.mockResolvedValue(voucher({ tenantId: 'tenant-2', routerId: 'router-foreign' }));
    await service.accounting(acct());
    expect(mockPrisma.session.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.voucher.updateMany).not.toHaveBeenCalled();
  });
});
