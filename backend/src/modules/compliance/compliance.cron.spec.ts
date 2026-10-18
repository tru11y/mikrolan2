import { ComplianceCron } from './compliance.cron';

const retention = {
  purgeAuditLogs: jest.fn(),
  purgePaymentProofs: jest.fn(),
  wipeRevokedRouterCredentials: jest.fn(),
  anonymizeDeletedUsers: jest.fn(),
};
const peers = { revokeAllForDeletedTenants: jest.fn() };

function build() {
  return new ComplianceCron(retention as never, peers as never);
}

beforeEach(() => {
  jest.resetAllMocks();
  Object.values(retention).forEach((fn) => fn.mockResolvedValue(0));
  peers.revokeAllForDeletedTenants.mockResolvedValue(0);
});

describe('ComplianceCron.dailyRetention', () => {
  it('runs every retention task', async () => {
    await build().dailyRetention();

    Object.values(retention).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
  });

  it('a failing task does not block the following ones', async () => {
    retention.purgeAuditLogs.mockRejectedValue(new Error('boom'));

    await build().dailyRetention();

    expect(retention.purgePaymentProofs).toHaveBeenCalled();
    expect(retention.wipeRevokedRouterCredentials).toHaveBeenCalled();
    expect(retention.anonymizeDeletedUsers).toHaveBeenCalled();
  });
});

describe('ComplianceCron.revokeDeletedTenantPeers', () => {
  it('swallows errors so the scheduler keeps running', async () => {
    peers.revokeAllForDeletedTenants.mockRejectedValue(new Error('boom'));

    await expect(build().revokeDeletedTenantPeers()).resolves.toBeUndefined();
  });
});
