import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  BillingPeriod,
} from '@prisma/client';
import { AdminService } from './admin.service';

const mockPrisma: Record<string, any> = {
  invoice: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  subscription: { update: jest.fn() },
  tenant: { update: jest.fn() },
  notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma) : Promise.all(arg as unknown[]),
  ),
};

const mockNotifications = { sendPushToTenant: jest.fn().mockResolvedValue(undefined) };
const mockSubscriptions = {
  activate: jest.fn().mockResolvedValue({ plan: 'PRO', status: 'ACTIVE' }),
};

const actor = { userId: 'admin-1', tenantId: 'platform' };

function buildService() {
  return new AdminService(mockPrisma as any, mockNotifications as any, mockSubscriptions as any);
}

beforeEach(() => jest.clearAllMocks());

describe('AdminService.validateInvoice', () => {
  it('délègue à SubscriptionsService.activate et active le tenant', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      periodDays: 30,
      tierId: 'tier-1',
      billingPeriod: BillingPeriod.MONTHLY,
    });

    const service = buildService();
    const result = await service.validateInvoice('inv-1', actor, {});

    expect(result).toEqual({ validated: true });
    expect(mockSubscriptions.activate).toHaveBeenCalledWith(
      'tenant-1',
      'admin-1',
      30,
      'inv-1',
    );
    // tenant.status = ACTIVE is now handled atomically inside activate()
  });

  it('utilise le periodDays du DTO quand fourni', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      periodDays: 30,
    });

    const service = buildService();
    await service.validateInvoice('inv-1', actor, { periodDays: 90 });

    expect(mockSubscriptions.activate).toHaveBeenCalledWith(
      'tenant-1',
      'admin-1',
      90,
      'inv-1',
    );
  });

  it('convertit months en periodDays', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      periodDays: 30,
    });

    const service = buildService();
    await service.validateInvoice('inv-1', actor, { months: 3 });

    expect(mockSubscriptions.activate).toHaveBeenCalledWith(
      'tenant-1',
      'admin-1',
      90,
      'inv-1',
    );
  });

  it('rejette une facture introuvable avec NotFoundException', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);
    const service = buildService();

    await expect(service.validateInvoice('missing', actor, {})).rejects.toThrow(
      NotFoundException,
    );
    expect(mockSubscriptions.activate).not.toHaveBeenCalled();
  });

  it('rejette une facture déjà traitée (non PENDING) avec BadRequestException', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      tenantId: 'tenant-1',
      status: 'PAID',
      periodDays: 30,
    });
    const service = buildService();

    await expect(service.validateInvoice('inv-1', actor, {})).rejects.toThrow(
      BadRequestException,
    );
    expect(mockSubscriptions.activate).not.toHaveBeenCalled();
  });
});

describe('AdminService.rejectInvoice', () => {
  it('marque la facture FAILED, notifie le motif et journalise', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
    });

    const service = buildService();
    const result = await service.rejectInvoice('inv-1', actor, {
      reason: 'Preuve illisible',
    });

    expect(result).toEqual({ rejected: true });
    expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          type: 'PAYMENT_REJECTED',
          body: 'Preuve illisible',
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.REJECT,
          entityType: 'Invoice',
          entityId: 'inv-1',
          metadata: { reason: 'Preuve illisible' },
        }),
      }),
    );
    expect(mockNotifications.sendPushToTenant).toHaveBeenCalledWith(
      'tenant-1',
      'Paiement refusé',
      'Preuve illisible',
      null,
      expect.objectContaining({ type: 'PAYMENT_REJECTED' }),
    );
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });

  it('rejette une facture introuvable avec NotFoundException', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);
    const service = buildService();

    await expect(
      service.rejectInvoice('missing', actor, { reason: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejette une facture déjà traitée (non PENDING) avec BadRequestException', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      tenantId: 'tenant-1',
      status: 'FAILED',
    });
    const service = buildService();

    await expect(
      service.rejectInvoice('inv-1', actor, { reason: 'x' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
