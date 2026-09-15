import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PaymentCron {
  private readonly logger = new Logger(PaymentCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
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
    const d1 = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

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
}
