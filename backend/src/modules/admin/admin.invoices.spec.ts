import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  BillingPeriod,
  SubscriptionPlan,
  SubscriptionStatus,
  TenantStatus,
} from '@prisma/client';
import { AdminService } from './admin.service';

const mockPrisma: Record<string, any> = {
  invoice: { findUnique: jest.fn(), update: jest.fn() },
  subscription: { update: jest.fn() },
  tenant: { update: jest.fn() },
  notification: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};

const actor = { userId: 'admin-1', tenantId: 'platform' };

function buildService() {
  return new AdminService(mockPrisma as any);
}

beforeEach(() => jest.clearAllMocks());

describe('AdminService.validateInvoice', () => {
  it('active la souscription et journalise quand la facture est PENDING', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      periodDays: 30,
      tierId: 'tier-1',
      billingPeriod: BillingPeriod.MONTHLY,
      tenant: { id: 'tenant-1' },
    });

    const service = buildService();
    const result = await service.validateInvoice('inv-1', actor, {});

    expect(result).toEqual({ validated: true });
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({ status: 'PAID', periodDays: 30 }),
      }),
    );
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1' },
        data: expect.objectContaining({
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
        }),
      }),
    );
    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { status: TenantStatus.ACTIVE },
    });
    expect(mockPrisma.notification.create).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'admin-1',
          action: AuditAction.ACTIVATE,
          entityType: 'Invoice',
          entityId: 'inv-1',
        }),
      }),
    );
  });

  it("utilise le périodDays fourni au lieu de celui de la facture s'il est passé", async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      periodDays: 30,
      tierId: 'tier-1',
      billingPeriod: BillingPeriod.MONTHLY,
      tenant: { id: 'tenant-1' },
    });

    const service = buildService();
    await service.validateInvoice('inv-1', actor, { periodDays: 90 });

    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ periodDays: 90 }),
      }),
    );
  });

  it('rejette une facture introuvable avec NotFoundException', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue(null);
    const service = buildService();

    await expect(service.validateInvoice('missing', actor, {})).rejects.toThrow(
      NotFoundException,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejette une facture déjà traitée (non PENDING) avec BadRequestException', async () => {
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      tenantId: 'tenant-1',
      status: 'PAID',
      periodDays: 30,
      tenant: { id: 'tenant-1' },
    });
    const service = buildService();

    await expect(service.validateInvoice('inv-1', actor, {})).rejects.toThrow(
      BadRequestException,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
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
    // Le rejet ne doit jamais toucher subscription/tenant — seule la facture change d'état.
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
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
