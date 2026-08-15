import { NotFoundException } from '@nestjs/common';
import {
  BillingPeriod,
  ManagementMode,
  PaymentStatus,
  RemotePeerStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';

const mockPrisma: Record<string, any> = {
  subscription: { findUnique: jest.fn(), update: jest.fn() },
  invoice: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'TestCo' }) },
  notification: { create: jest.fn() },
  remotePeer: { updateMany: jest.fn() },
  router: { updateMany: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((fn: (tx: any) => Promise<unknown>) => fn(mockPrisma)),
};

const mockTiers = {
  getByKeyOrThrow: jest.fn().mockResolvedValue({
    id: 'tier1',
    key: 'starter',
    name: 'Starter',
    monthlyXof: 5000,
    routerLimit: 3,
  }),
  defaultUpgradeTier: jest.fn().mockResolvedValue({
    id: 'tier1',
    key: 'starter',
    name: 'Starter',
    monthlyXof: 5000,
    routerLimit: 3,
  }),
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

beforeEach(() => jest.clearAllMocks());

describe('SubscriptionsService', () => {
  describe('getEntitlement', () => {
    it('PRO active + not expired → tier PRO', async () => {
      const service = buildService();
      const future = new Date(Date.now() + 30 * 86_400_000);
      mockPrisma.subscription.findUnique.mockResolvedValue({
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: future,
        tier: { key: 'starter', routerLimit: 3 },
      });

      const e = await service.getEntitlement('t1');
      expect(e.tier).toBe('PRO');
      expect(e.remoteAllowed).toBe(true);
      expect(e.routerLimit).toBe(3);
    });

    it('TRIALING + not expired → tier TRIAL', async () => {
      const service = buildService();
      const future = new Date(Date.now() + 10 * 86_400_000);
      mockPrisma.subscription.findUnique.mockResolvedValue({
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.TRIALING,
        currentPeriodEnd: future,
        tier: null,
      });

      const e = await service.getEntitlement('t1');
      expect(e.tier).toBe('TRIAL');
      expect(e.localAllowed).toBe(true);
      expect(e.remoteAllowed).toBe(false);
    });

    it('expired → tier LOCKED', async () => {
      const service = buildService();
      const past = new Date(Date.now() - 86_400_000);
      mockPrisma.subscription.findUnique.mockResolvedValue({
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: past,
        tier: null,
      });

      const e = await service.getEntitlement('t1');
      expect(e.tier).toBe('LOCKED');
      expect(e.localAllowed).toBe(false);
    });

    it('no subscription → tier LOCKED', async () => {
      const service = buildService();
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      const e = await service.getEntitlement('t1');
      expect(e.tier).toBe('LOCKED');
    });
  });

  describe('requestUpgrade', () => {
    it('creates invoice when none pending', async () => {
      const service = buildService();
      mockPrisma.invoice.findFirst.mockResolvedValue(null);
      mockPrisma.invoice.create.mockResolvedValue({
        id: 'inv1',
        amount: 5000,
        currency: 'XOF',
        status: PaymentStatus.PENDING,
        billingPeriod: BillingPeriod.MONTHLY,
      });

      const result = await service.requestUpgrade('t1', 'u1', 'test note');
      expect(result.invoice.status).toBe(PaymentStatus.PENDING);
      expect(mockPrisma.invoice.create).toHaveBeenCalled();
      expect(mockEvents.publishPlatform).toHaveBeenCalled();
    });

    it('reuses existing PENDING invoice', async () => {
      const service = buildService();
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-existing',
        note: 'old note',
      });
      mockPrisma.invoice.update.mockResolvedValue({
        id: 'inv-existing',
        amount: 5000,
        currency: 'XOF',
        status: PaymentStatus.PENDING,
        billingPeriod: BillingPeriod.MONTHLY,
      });

      const result = await service.requestUpgrade('t1', 'u1');
      expect(result.invoice.id).toBe('inv-existing');
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.update).toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('sets PRO, pays invoice, creates notification', async () => {
      const service = buildService();
      mockPrisma.subscription.findUnique
        .mockResolvedValueOnce({ tenantId: 't1', currentPeriodEnd: null, tierId: null, billingPeriod: null })
        .mockResolvedValueOnce({ plan: 'PRO', status: 'ACTIVE' }); // getForTenant
      mockPrisma.invoice.findFirst.mockResolvedValue({
        id: 'inv1',
        tierId: 'tier1',
        billingPeriod: BillingPeriod.MONTHLY,
        periodDays: 30,
        tier: { key: 'starter', name: 'Starter' },
      });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.invoice.updateMany.mockResolvedValue({});
      mockPrisma.notification.create.mockResolvedValue({});

      await service.activate('t1', 'admin1', undefined, 'inv1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            plan: SubscriptionPlan.PRO,
            status: SubscriptionStatus.ACTIVE,
          }),
        }),
      );
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PaymentStatus.PAID }),
        }),
      );
    });
  });

  describe('deactivate', () => {
    it('sets FREE and revokes remote peers', async () => {
      const service = buildService();
      mockPrisma.subscription.findUnique
        .mockResolvedValueOnce({ tenantId: 't1' })
        .mockResolvedValueOnce({ plan: 'FREE', status: 'ACTIVE' });
      mockPrisma.subscription.update.mockResolvedValue({});
      mockPrisma.remotePeer.updateMany.mockResolvedValue({});
      mockPrisma.router.updateMany.mockResolvedValue({});

      await service.deactivate('t1', 'admin1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ plan: SubscriptionPlan.FREE }),
        }),
      );
      expect(mockPrisma.remotePeer.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', status: RemotePeerStatus.ACTIVE },
        data: expect.objectContaining({ status: RemotePeerStatus.REVOKED }),
      });
    });
  });
});
