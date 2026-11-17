import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventLogService } from '../events/event-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from './subscriptions.service';
import { periodAmount } from './tiers.service';

const SYSTEM_ACTOR = 'SYSTEM';
/** Jours avant l'échéance où le client est invité à confirmer son renouvellement. */
const RENEWAL_REMINDER_DAYS = [7, 3, 1];

@Injectable()
export class PaymentCron {
  private readonly logger = new Logger(PaymentCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly eventLog: EventLogService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expirePendingInvoices(): Promise<void> {
    const overdue = await this.prisma.invoice.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { not: null, lt: new Date() },
      },
      select: { id: true, tenantId: true },
    });
    if (!overdue.length) return;

    await this.prisma.invoice.updateMany({
      where: { id: { in: overdue.map((i) => i.id) }, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    for (const invoice of overdue) {
      await this.eventLog.warning(
        AuditAction.UPDATE,
        'Invoice',
        invoice.id,
        { reason: 'expired', actor: SYSTEM_ACTOR },
        { tenantId: invoice.tenantId },
      );
    }
    this.logger.log(`Expired ${overdue.length} pending invoices`);
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
        billingPeriod: true,
        tier: true,
        tenant: { select: { name: true } },
      },
    });

    for (const sub of subscriptions) {
      if (!sub.currentPeriodEnd) continue;
      const daysLeft = Math.ceil(
        (sub.currentPeriodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );

      if (!RENEWAL_REMINDER_DAYS.includes(daysLeft)) continue;

      // Le paiement mobile money ne peut pas être prélevé sans le client : on prépare
      // le renouvellement (même formule, même période) et il le confirme d'un appui.
      const expiry = sub.currentPeriodEnd.toLocaleDateString('fr-FR');
      const period = sub.billingPeriod ?? 'MONTHLY';
      const renewal = sub.tier
        ? { type: 'SUBSCRIPTION_RENEWAL', tierKey: sub.tier.key, billingPeriod: period }
        : undefined;
      const body = sub.tier
        ? `Votre formule ${sub.tier.name} expire le ${expiry}. Appuyez pour confirmer le paiement de ${periodAmount(sub.tier, period).toLocaleString('fr-FR')} F.`
        : `Votre abonnement PRO expire le ${expiry}. Pensez à renouveler.`;
      await this.notifications.createAndPush(
        sub.tenantId,
        'SUBSCRIPTION_ACTIVATED',
        `Renouvellement dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`,
        body,
        null,
        null,
        renewal,
      );
      this.logger.log(`Reminder J-${daysLeft} sent to ${sub.tenant.name}`);
    }
  }

  @Cron('0 2 * * *')
  async expireOverdueSubscriptions(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.subscription.findMany({
      where: {
        // Un essai échu suit le même chemin qu'un PRO échu : pairs révoqués, routeurs repassés en LOCAL.
        OR: [{ plan: 'PRO', status: 'ACTIVE' }, { status: 'TRIALING' }],
        currentPeriodEnd: { lt: now },
      },
      select: { tenantId: true, status: true, tenant: { select: { name: true } } },
    });

    for (const sub of expired) {
      try {
        const trial = sub.status === 'TRIALING';
        await this.subscriptions.deactivate(sub.tenantId, SYSTEM_ACTOR);
        await this.notifications.createAndPush(
          sub.tenantId,
          'SUBSCRIPTION_ACTIVATED',
          trial ? 'Essai terminé' : 'Abonnement expiré',
          trial
            ? 'Votre essai est terminé. Activez un forfait pour retrouver l\'accès distant ; la gestion locale reste gratuite.'
            : 'Votre abonnement PRO a expiré. Renouvelez pour conserver l\'accès distant.',
        );
        this.logger.log(`Downgraded expired ${trial ? 'trial' : 'PRO'} → FREE (via deactivate): ${sub.tenant.name}`);
      } catch (e) {
        // deactivate() already traced the failure (FAILED) in the event log.
        this.logger.error(`Failed to deactivate ${sub.tenant.name}: ${e}`);
      }
    }
    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} overdue PRO subscriptions`);
    }
  }
}
