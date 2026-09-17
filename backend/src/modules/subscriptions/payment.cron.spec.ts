import { PaymentCron } from './payment.cron';

const mockPrisma: Record<string, any> = {
  invoice: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
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

function buildCron() {
  return new PaymentCron(
    mockPrisma as any,
    mockNotifications as any,
    mockSubscriptions as any,
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

  it('does nothing when no expired subscriptions exist', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([]);

    const cron = buildCron();
    await cron.expireOverdueSubscriptions();

    expect(mockSubscriptions.deactivate).not.toHaveBeenCalled();
    expect(mockNotifications.createAndPush).not.toHaveBeenCalled();
  });
});
