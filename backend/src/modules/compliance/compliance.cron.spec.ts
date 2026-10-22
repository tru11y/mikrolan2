import { ComplianceCron } from './compliance.cron';

const retention = {
  archiveExpiredAuditLogs: jest.fn(),
  purgePaymentProofs: jest.fn(),
  wipeRevokedRouterCredentials: jest.fn(),
  anonymizeDeletedUsers: jest.fn(),
};
const peers = { revokeAllForDeletedTenants: jest.fn() };

function build(enforced: boolean) {
  const config = { get: jest.fn((key: string) => (key === 'COMPLIANCE_ENFORCED' ? enforced : undefined)) };
  return new ComplianceCron(retention as never, peers as never, config as never);
}

beforeEach(() => {
  jest.resetAllMocks();
  Object.values(retention).forEach((fn) => fn.mockResolvedValue(0));
  peers.revokeAllForDeletedTenants.mockResolvedValue(0);
});

describe('ComplianceCron — COMPLIANCE_ENFORCED=true', () => {
  it('runs every retention task', async () => {
    await build(true).dailyRetention();

    Object.values(retention).forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
  });

  it('a failing task does not block the following ones', async () => {
    retention.archiveExpiredAuditLogs.mockRejectedValue(new Error('boom'));

    await build(true).dailyRetention();

    expect(retention.purgePaymentProofs).toHaveBeenCalled();
    expect(retention.wipeRevokedRouterCredentials).toHaveBeenCalled();
    expect(retention.anonymizeDeletedUsers).toHaveBeenCalled();
  });

  it('revokes the peers of deleted tenants', async () => {
    await build(true).revokeDeletedTenantPeers();

    expect(peers.revokeAllForDeletedTenants).toHaveBeenCalledTimes(1);
  });

  it('swallows errors so the scheduler keeps running', async () => {
    peers.revokeAllForDeletedTenants.mockRejectedValue(new Error('boom'));

    await expect(build(true).revokeDeletedTenantPeers()).resolves.toBeUndefined();
  });
});

describe('ComplianceCron — COMPLIANCE_ENFORCED=false', () => {
  it('purges and anonymizes nothing', async () => {
    await build(false).dailyRetention();

    Object.values(retention).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('revokes no peer', async () => {
    await build(false).revokeDeletedTenantPeers();

    expect(peers.revokeAllForDeletedTenants).not.toHaveBeenCalled();
  });
});
