import { BadRequestException } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, BillingPeriod } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid',
}));

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

const mockPrisma: Record<string, any> = {
  invoice: { findFirst: jest.fn() },
  paymentProof: { create: jest.fn() },
  tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'TestCo' }) },
  subscription: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((fn: (tx: any) => Promise<unknown>) => fn(mockPrisma)),
};

const mockTiers = {
  getByKeyOrThrow: jest.fn(),
  defaultUpgradeTier: jest.fn(),
};

const mockEvents = {
  publish: jest.fn(),
  publishPlatform: jest.fn(),
};

const mockNotifications = {
  sendPushToTenant: jest.fn(),
};

function buildService() {
  return new SubscriptionsService(
    mockPrisma as any,
    mockTiers as any,
    mockEvents as any,
    mockNotifications as any,
  );
}

const file = {
  buffer: JPEG_HEADER,
  originalname: 'proof.jpg',
  mimetype: 'image/jpeg',
};

beforeEach(() => jest.clearAllMocks());

describe('SubscriptionsService.uploadProof', () => {
  it('stores proof and notifies platform on valid upload', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      tenantId: 't-1',
      status: PaymentStatus.PENDING,
    });
    mockPrisma.paymentProof.create.mockResolvedValue({
      id: 'proof-1',
      invoiceId: 'inv-1',
      method: PaymentMethod.WAVE,
      imageUrl: 'proofs-private/test-uuid.jpg',
    });

    const service = buildService();
    const result = await service.uploadProof('t-1', 'inv-1', PaymentMethod.WAVE, file, 'note');

    expect(result.proof.id).toBe('proof-1');
    expect(mockPrisma.paymentProof.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceId: 'inv-1',
          method: PaymentMethod.WAVE,
          note: 'note',
        }),
      }),
    );
    expect(mockEvents.publishPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PAYMENT_PROOF_RECEIVED',
        data: expect.objectContaining({ tenantId: 't-1', invoiceId: 'inv-1' }),
      }),
    );
  });

  it('throws BadRequestException when invoice not found', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    const service = buildService();

    await expect(
      service.uploadProof('t-1', 'missing', PaymentMethod.WAVE, file),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.paymentProof.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for unsupported mimetype', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      tenantId: 't-1',
      status: PaymentStatus.PENDING,
    });
    const service = buildService();

    await expect(
      service.uploadProof('t-1', 'inv-1', PaymentMethod.WAVE, {
        ...file,
        mimetype: 'application/pdf',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.paymentProof.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when file signature does not match mimetype', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      tenantId: 't-1',
      status: PaymentStatus.PENDING,
    });
    const service = buildService();

    await expect(
      service.uploadProof('t-1', 'inv-1', PaymentMethod.WAVE, {
        buffer: Buffer.from('<html>fake</html>'),
        originalname: 'hack.jpg',
        mimetype: 'image/jpeg',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.paymentProof.create).not.toHaveBeenCalled();
  });

  it('sets note to null when not provided', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      tenantId: 't-1',
      status: PaymentStatus.PENDING,
    });
    mockPrisma.paymentProof.create.mockResolvedValue({
      id: 'proof-1',
      invoiceId: 'inv-1',
      method: PaymentMethod.ORANGE_MONEY,
      imageUrl: 'proofs-private/test-uuid.jpg',
    });

    const service = buildService();
    await service.uploadProof('t-1', 'inv-1', PaymentMethod.ORANGE_MONEY, file);

    expect(mockPrisma.paymentProof.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ note: null }),
      }),
    );
  });
});
