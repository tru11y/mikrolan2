import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  ManagementMode,
  PaymentStatus,
  Prisma,
  RemotePeerStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

// No automatic payment: upgrades are validated manually by a platform admin.
export const PRO_MONTHLY_XOF = 15000;

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  getForTenant(tenantId: string) {
    return this.prisma.subscription.findUnique({
      where: { tenantId },
      select: {
        plan: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        updatedAt: true,
      },
    });
  }

  /** True when the tenant may use remote (cloud + WireGuard) management. */
  async isRemoteAllowed(tenantId: string): Promise<boolean> {
    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId },
      select: { plan: true, status: true, currentPeriodEnd: true },
    });
    if (!sub || sub.plan !== SubscriptionPlan.PRO) return false;
    if (sub.status !== SubscriptionStatus.ACTIVE) return false;
    if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < Date.now()) {
      return false;
    }
    return true;
  }

  /** Tenant OWNER requests PRO. Creates (or returns) a PENDING manual invoice. */
  async requestUpgrade(tenantId: string, userId: string, note?: string) {
    const existing = await this.prisma.invoice.findFirst({
      where: { tenantId, status: PaymentStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    const invoice =
      existing ??
      (await this.prisma.invoice.create({
        data: {
          tenantId,
          amount: PRO_MONTHLY_XOF,
          currency: 'XOF',
          idempotencyKey: `upgrade-${tenantId}-${randomUUID()}`,
          status: PaymentStatus.PENDING,
        },
      }));

    await this.audit(tenantId, userId, AuditAction.SUBSCRIBE, 'Invoice', invoice.id, {
      kind: 'upgrade-request',
      note: note ?? null,
    });

    return {
      invoice: {
        id: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        status: invoice.status,
      },
      instructions:
        'Votre demande PRO est enregistrée. Un administrateur activera votre ' +
        'abonnement après validation manuelle du paiement.',
    };
  }

  /** Platform admin activates PRO for a tenant after validating payment. */
  async activate(
    tenantId: string,
    actorId: string,
    periodDays: number,
    invoiceId?: string,
  ) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Subscription not found');

    const now = new Date();
    const end = new Date(now.getTime() + periodDays * 86_400_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { tenantId },
        data: {
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: now,
          currentPeriodEnd: end,
        },
      });
      await tx.invoice.updateMany({
        where: invoiceId
          ? { id: invoiceId, tenantId }
          : { tenantId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.PAID, paidAt: now },
      });
    });

    await this.audit(tenantId, actorId, AuditAction.SUBSCRIBE, 'Subscription', tenantId, {
      kind: 'activate-pro',
      periodDays,
    });

    return this.getForTenant(tenantId);
  }

  /** Downgrade to FREE and revoke any remote access (paywall re-enforced). */
  async deactivate(tenantId: string, actorId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Subscription not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { tenantId },
        data: {
          plan: SubscriptionPlan.FREE,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date(),
        },
      });
      await tx.remotePeer.updateMany({
        where: { tenantId, status: RemotePeerStatus.ACTIVE },
        data: { status: RemotePeerStatus.REVOKED, revokedAt: new Date() },
      });
      await tx.router.updateMany({
        where: { tenantId, mode: ManagementMode.REMOTE },
        data: { mode: ManagementMode.LOCAL },
      });
    });

    await this.audit(tenantId, actorId, AuditAction.SUBSCRIBE, 'Subscription', tenantId, {
      kind: 'deactivate-pro',
    });

    return this.getForTenant(tenantId);
  }

  // Append-only, never throws (audit must not break the operation).
  private async audit(
    tenantId: string,
    userId: string,
    action: AuditAction,
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { tenantId, userId, action, entityType, entityId, metadata },
      });
    } catch {
      // swallow
    }
  }
}
