import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from './subscriptions.service';

const SYSTEM_ACTOR = 'SYSTEM';

@Injectable()
export class PaymentCron {
  private readonly logger = new Logger(PaymentCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expirePendingInvoices(): Promise<void> {
    const result = await this.prisma.invoice.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { not: null, lt: new Date() },
      },
      data: { status: 'FAILED' },
    });
    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} pending invoices`);
    }
  }

  @Cron('0 9 * * *') // 9h chaque jour
  async sendPaymentReminders(): Promise<void> {
    const now = new Date();
    const d7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        plan: 'PRO',
        currentPeriodEnd: { gte: now, lte: d7 },
      },
      select: {
        tenantId: true,
        currentPeriodEnd: true,
        tenant: { select: { name: true } },
      },
    });

    for (const sub of subscriptions) {
      if (!sub.currentPeriodEnd) continue;
      const daysLeft = Math.ceil(
        (sub.currentPeriodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );

      if (daysLeft === 7 || daysLeft === 1) {
        await this.notifications.createAndPush(
          sub.tenantId,
          'SUBSCRIPTION_ACTIVATED',
          `Renouvellement dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`,
          `Votre abonnement PRO expire le ${sub.currentPeriodEnd.toLocaleDateString('fr-FR')}. Pensez à renouveler.`,
        );
        this.logger.log(`Reminder J-${daysLeft} sent to ${sub.tenant.name}`);
      }
    }
  }

  @Cron('0 2 * * *')
  async expireOverdueSubscriptions(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.subscription.findMany({
      where: {
        plan: 'PRO',
        status: 'ACTIVE',
        currentPeriodEnd: { lt: now },
      },
      select: { tenantId: true, tenant: { select: { name: true } } },
    });

    for (const sub of expired) {
      try {
        await this.subscriptions.deactivate(sub.tenantId, SYSTEM_ACTOR);
        await this.notifications.createAndPush(
          sub.tenantId,
          'SUBSCRIPTION_ACTIVATED',
          'Abonnement expiré',
          'Votre abonnement PRO a expiré. Renouvelez pour conserver l\'accès distant.',
        );
        this.logger.log(`Downgraded expired PRO → FREE (via deactivate): ${sub.tenant.name}`);
      } catch (e) {
        this.logger.error(`Failed to deactivate ${sub.tenant.name}: ${e}`);
      }
    }
    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} overdue PRO subscriptions`);
    }
  }
}
