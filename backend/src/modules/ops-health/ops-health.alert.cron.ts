import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { MailService } from '../mail/mail.service';
import type { AppConfig } from '../../config/configuration';
import { OpsHealthService } from './ops-health.service';

const REALERT_AFTER_MS = 6 * 3_600_000;

@Injectable()
export class OpsHealthAlertCron {
  private readonly logger = new Logger(OpsHealthAlertCron.name);
  private lastAlertAt = 0;

  constructor(
    private readonly health: OpsHealthService,
    private readonly mail: MailService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkExpiry(): Promise<void> {
    try {
      const h = await this.health.getExpiryHealth();
      if (h.level !== 'RED') {
        this.lastAlertAt = 0;
        return;
      }
      const now = Date.now();
      if (now - this.lastAlertAt < REALERT_AFTER_MS) return;
      this.lastAlertAt = now;
      const msg = `${h.pendingOnline} tickets expirés non appliqués sur le routeur (plus ancien : ${h.oldestPendingMinutes} min)`;
      this.logger.error({ errorCode: 'EXPIRY_PENDING_STUCK', pendingOnline: h.pendingOnline, pendingOffline: h.pendingOffline });
      Sentry.captureMessage(`EXPIRY_PENDING_STUCK: ${msg}`, {
        level: 'fatal',
        tags: { errorCode: 'EXPIRY_PENDING_STUCK', domain: 'voucher-expiry' },
        extra: {
          pendingOnline: h.pendingOnline,
          pendingOffline: h.pendingOffline,
          oldestPendingMinutes: h.oldestPendingMinutes,
          appliedLast24h: h.appliedLast24h,
          lastExpiredAt: h.lastExpiredAt,
        },
      });
      const to = this.config.get('ALERT_EMAIL', { infer: true });
      if (to) await this.mail.sendAlert(to, 'Tickets expirés bloqués', msg);
    } catch (err) {
      this.logger.error('Expiry health check failed', err instanceof Error ? err.stack : String(err));
      Sentry.captureException(err);
    }
  }
}
