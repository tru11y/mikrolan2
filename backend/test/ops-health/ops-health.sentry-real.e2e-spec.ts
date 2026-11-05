/** Sentry SDK réel + transport en mémoire : prouve niveau, tags, extra de l'événement émis. */
import * as Sentry from '@sentry/node';
import { OpsHealthAlertCron } from '../../src/modules/ops-health/ops-health.alert.cron';

describe('ops-health — événement Sentry réel', () => {
  it('émet un événement fatal avec tags et contexte', async () => {
    const envelopes: unknown[] = [];
    Sentry.init({
      dsn: 'https://k@o0.ingest.sentry.io/1',
      transport: () => ({
        send: async (env: unknown) => {
          envelopes.push(env);
          return {};
        },
        flush: async () => true,
      }),
    });
    const health = {
      getExpiryHealth: async () => ({
        level: 'RED', pendingOnline: 7, pendingOffline: 2, oldestPendingMinutes: 45, appliedLast24h: 3, lastExpiredAt: null,
      }),
    };
    await new OpsHealthAlertCron(health as never, { sendAlert: jest.fn() } as never, { get: () => '' } as never).checkExpiry();
    await Sentry.flush(2000);
    const event = JSON.stringify(envelopes);
    expect(event).toContain('"level":"fatal"');
    expect(event).toContain('EXPIRY_PENDING_STUCK');
    expect(event).toContain('"pendingOnline":7');
    expect(event).toContain('"domain":"voucher-expiry"');
  });
});
