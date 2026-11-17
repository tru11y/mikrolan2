import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { PaymentCron } from './payment.cron';

const mockPrisma: Record<string, any> = {
  invoice: {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  subscription: {
    findMany: jest.fn().mockResolvedValue([]),
  },
};

const mockNotifications = {
  createAndPush: jest.fn().mockResolvedValue(undefined),
};

const mockSubscriptions = {
  deactivate: jest.fn().mockResolvedValue(undefined),
};

const mockEventLog = makeEventLogStub();

function buildCron() {
  return new PaymentCron(
    mockPrisma as any,
    mockNotifications as any,
    mockSubscriptions as any,
    mockEventLog as any,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('PaymentCron.expireOverdueSubscriptions', () => {
  it('calls deactivate() for each expired PRO subscription', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', tenant: { name: 'Acme' } },
    ]);

    const cron = buildCron();
    await cron.expireOverdueSubscriptions();

    expect(mockSubscriptions.deactivate).toHaveBeenCalledWith('tenant-1', 'SYSTEM');

    expect(mockNotifications.createAndPush).toHaveBeenCalledWith(
      'tenant-1',
      'SUBSCRIPTION_ACTIVATED',
      'Abonnement expiré',
      expect.stringContaining('expiré'),
    );
  });

  it('downgrades an expired trial with its own wording', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      { tenantId: 'tenant-2', status: 'TRIALING', tenant: { name: 'Beta' } },
    ]);

    await buildCron().expireOverdueSubscriptions();

    expect(mockSubscriptions.deactivate).toHaveBeenCalledWith('tenant-2', 'SYSTEM');
    expect(mockNotifications.createAndPush).toHaveBeenCalledWith(
      'tenant-2',
      'SUBSCRIPTION_ACTIVATED',
      'Essai terminé',
      expect.stringContaining('gestion locale reste gratuite'),
    );
  });

  it('does nothing when no expired subscriptions exist', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([]);

    const cron = buildCron();
    await cron.expireOverdueSubscriptions();

    expect(mockSubscriptions.deactivate).not.toHaveBeenCalled();
    expect(mockNotifications.createAndPush).not.toHaveBeenCalled();
  });
});

describe('PaymentCron.expirePendingInvoices', () => {
  it('marks overdue invoices FAILED and traces one WARNING per invoice on its own tenant', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', tenantId: 'tenant-1' },
      { id: 'inv-2', tenantId: 'tenant-2' },
    ]);

    await buildCron().expirePendingInvoices();

    expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['inv-1', 'inv-2'] }, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    expect(mockEventLog.warning).toHaveBeenCalledTimes(2);
    expect(mockEventLog.warning).toHaveBeenCalledWith(
      expect.anything(), 'Invoice', 'inv-2', expect.objectContaining({ reason: 'expired' }), { tenantId: 'tenant-2' },
    );
  });

  it('does nothing when no invoice is overdue', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    await buildCron().expirePendingInvoices();
    expect(mockPrisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(mockEventLog.warning).not.toHaveBeenCalled();
  });
});

describe('PaymentCron.sendPaymentReminders', () => {
  const tier = { key: 'essentiel', name: 'Essentiel', monthlyXof: 5000, annualDiscount: 20 };
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000 - 60_000);

  it('prepares the renewal the client confirms: same tier, same period, amount in the text', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', currentPeriodEnd: inDays(3), billingPeriod: 'MONTHLY', tier, tenant: { name: 'Acme' } },
    ]);

    await buildCron().sendPaymentReminders();

    expect(mockNotifications.createAndPush).toHaveBeenCalledWith(
      'tenant-1',
      'SUBSCRIPTION_ACTIVATED',
      'Renouvellement dans 3 jours',
      expect.stringMatching(/Essentiel.*5\s000 F/),
      null,
      null,
      { type: 'SUBSCRIPTION_RENEWAL', tierKey: 'essentiel', billingPeriod: 'MONTHLY' },
    );
  });

  it('stays silent outside the reminder days', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', currentPeriodEnd: inDays(5), billingPeriod: 'MONTHLY', tier, tenant: { name: 'Acme' } },
    ]);

    await buildCron().sendPaymentReminders();

    expect(mockNotifications.createAndPush).not.toHaveBeenCalled();
  });
});
