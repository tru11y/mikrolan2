import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { AdminService } from './admin.service';

const mockPrisma: Record<string, any> = {
  subscription: { findUnique: jest.fn(), update: jest.fn() },
  subscriptionTier: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
};

const actor = { userId: 'admin-1' };

function buildService() {
  return new AdminService(
    mockPrisma as any,
    { sendPushToTenant: jest.fn() } as any,
    {} as any,
    { get: jest.fn(), set: jest.fn(), del: jest.fn() } as any,
    {} as any,
    makeEventLogStub() as any,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('AdminService.patchSubscription — PRO exige une formule', () => {
  it('refuse de passer en PRO sans formule (400), rien n’est écrit', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 's1', plan: 'FREE', tierId: null });

    await expect(buildService().patchSubscription('t1', actor, { plan: 'PRO' } as any)).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });

  it('accepte PRO avec une formule fournie', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 's1', plan: 'FREE', tierId: null });
    mockPrisma.subscriptionTier.findUnique.mockResolvedValue({ id: 'tier-1' });
    mockPrisma.subscription.update.mockResolvedValue({ id: 's1' });

    await buildService().patchSubscription('t1', actor, { plan: 'PRO', tierId: 'tier-1' } as any);

    expect(mockPrisma.subscription.update).toHaveBeenCalled();
  });

  it('accepte de modifier un PRO qui a déjà une formule', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 's1', plan: 'PRO', tierId: 'tier-1' });
    mockPrisma.subscription.update.mockResolvedValue({ id: 's1' });

    await buildService().patchSubscription('t1', actor, { billingPeriod: 'ANNUAL' } as any);

    expect(mockPrisma.subscription.update).toHaveBeenCalled();
  });
});
