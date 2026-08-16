import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  BillingPeriod,
  ManagementMode,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RemotePeerStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PERIOD_DAYS, TiersService, periodAmount } from './tiers.service';

/** Free trial granted at signup. Local management only — remote is PRO. */
export const TRIAL_DAYS = 15;

export type EntitlementTier = 'TRIAL' | 'PRO' | 'LOCKED';

export interface Entitlement {
  tier: EntitlementTier;
  /** Local (LAN) management of routers, tickets, plans, reports. */
  localAllowed: boolean;
  /** Cloud + WireGuard management. PRO only. */
  remoteAllowed: boolean;
  /** End of the trial or of the paid period, whichever applies. */
  endsAt: Date | null;
  /** Whole days remaining, 0 once expired. */
  daysLeft: number;
  /** Formule souscrite, `null` en essai ou après retour au gratuit. */
  tierKey: string | null;
  /** Routeurs autorisés par la formule ; `null` = illimité. */
  routerLimit: number | null;
}

function daysUntil(end: Date | null): number {
  if (!end) return 0;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000));
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tiers: TiersService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  getForTenant(tenantId: string) {
    return this.prisma.subscription.findUnique({
      where: { tenantId },
      select: {
        plan: true,
        status: true,
        billingPeriod: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        updatedAt: true,
        tier: { select: { key: true, name: true, monthlyXof: true } },
      },
    });
  }

  /**
   * What a tenant is allowed to do right now.
   *
   * A new account gets TRIAL_DAYS of full local management. Once that runs out
   * without a paid plan, everything locks until PRO is activated — the padlock
   * shown in the app is only a mirror of this, the API is the authority.
   */
  async getEntitlement(tenantId: string): Promise<Entitlement> {
    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId },
      select: {
        plan: true,
        status: true,
        currentPeriodEnd: true,
        tier: { select: { key: true, routerLimit: true } },
      },
    });

    const expired =
      !sub?.currentPeriodEnd || sub.currentPeriodEnd.getTime() < Date.now();

    if (
      sub?.plan === SubscriptionPlan.PRO &&
      sub.status === SubscriptionStatus.ACTIVE &&
      !expired
    ) {
      return {
        tier: 'PRO',
        localAllowed: true,
        remoteAllowed: true,
        endsAt: sub.currentPeriodEnd,
        daysLeft: daysUntil(sub.currentPeriodEnd),
        tierKey: sub.tier?.key ?? null,
        routerLimit: sub.tier?.routerLimit ?? null,
      };
    }

    if (sub?.status === SubscriptionStatus.TRIALING && !expired) {
      return {
        tier: 'TRIAL',
        localAllowed: true,
        remoteAllowed: false,
        endsAt: sub.currentPeriodEnd,
        daysLeft: daysUntil(sub.currentPeriodEnd),
        tierKey: null,
        routerLimit: null,
      };
    }

    return {
      tier: 'LOCKED',
      localAllowed: false,
      remoteAllowed: false,
      endsAt: sub?.currentPeriodEnd ?? null,
      daysLeft: 0,
      tierKey: null,
      routerLimit: null,
    };
  }

  /** True when the tenant may use remote (cloud + WireGuard) management. */
  async isRemoteAllowed(tenantId: string): Promise<boolean> {
    return (await this.getEntitlement(tenantId)).remoteAllowed;
  }

  /**
   * Tenant OWNER requests PRO. Creates (or returns) a PENDING manual invoice.
   *
   * Le montant est figé ici, à partir de la grille du moment : une révision
   * ultérieure des tarifs ne doit pas changer ce que le client a demandé à
   * payer.
   */
  async requestUpgrade(
    tenantId: string,
    userId: string,
    note?: string,
    tierKey?: string,
    billingPeriod: BillingPeriod = BillingPeriod.MONTHLY,
  ) {
    const tier = tierKey
      ? await this.tiers.getByKeyOrThrow(tierKey)
      : await this.tiers.defaultUpgradeTier();

    // Une demande en attente existe déjà : on la met à jour plutôt que d'en
    // empiler une seconde, sinon la file d'attente de l'administrateur se
    // remplit de doublons au moindre double-appui.
    const existing = await this.prisma.invoice.findFirst({
      where: { tenantId, status: PaymentStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });

    const amount = periodAmount(tier, billingPeriod);
    const periodDays = PERIOD_DAYS[billingPeriod];

    const invoice = existing
      ? await this.prisma.invoice.update({
          where: { id: existing.id },
          data: {
            amount,
            tierId: tier.id,
            billingPeriod,
            periodDays,
            note: note ?? existing.note,
          },
        })
      : await this.prisma.invoice.create({
          data: {
            tenantId,
            amount,
            currency: 'XOF',
            tierId: tier.id,
            billingPeriod,
            periodDays,
            note: note ?? null,
            idempotencyKey: `upgrade-${tenantId}-${randomUUID()}`,
            status: PaymentStatus.PENDING,
          },
        });

    await this.audit(tenantId, userId, AuditAction.SUBSCRIBE, 'Invoice', invoice.id, {
      kind: 'upgrade-request',
      tier: tier.key,
      billingPeriod,
      note: note ?? null,
    });

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    // La plateforme apprend la demande immédiatement : c'est sa file de travail.
    this.events.publishPlatform({
      type: NotificationType.UPGRADE_REQUESTED,
      title: 'Demande d’activation',
      body: `${tenant?.name ?? 'Un compte'} demande la formule ${tier.name}.`,
      data: {
        tenantId,
        invoiceId: invoice.id,
        amount,
        tierKey: tier.key,
        note: note ?? null,
      },
    });

    return {
      invoice: {
        id: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        status: invoice.status,
        tierKey: tier.key,
        tierName: tier.name,
        billingPeriod: invoice.billingPeriod,
      },
      instructions:
        'Votre demande est enregistrée. Un administrateur activera votre ' +
        'abonnement après validation manuelle du paiement.',
    };
  }

  /**
   * Platform admin activates PRO for a tenant after validating payment.
   *
   * `periodDays` et la formule proviennent de la facture réglée quand elle
   * existe : ressaisir la durée à la main était une source d'écart entre ce
   * que le client a payé et ce qu'il obtient.
   */
  async activate(
    tenantId: string,
    actorId: string,
    periodDays?: number,
    invoiceId?: string,
  ) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Abonnement introuvable.');

    const invoice = await this.prisma.invoice.findFirst({
      where: invoiceId
        ? { id: invoiceId, tenantId }
        : { tenantId, status: PaymentStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      include: { tier: true },
    });

    const days = periodDays ?? invoice?.periodDays ?? PERIOD_DAYS.MONTHLY;
    const now = new Date();
    // Renouvellement avant échéance : on prolonge au lieu d'écraser, sinon le
    // client perd les jours qu'il a déjà payés.
    const from =
      sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime()
        ? sub.currentPeriodEnd
        : now;
    const end = new Date(from.getTime() + days * 86_400_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { tenantId },
        data: {
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          tierId: invoice?.tierId ?? sub.tierId,
          billingPeriod: invoice?.billingPeriod ?? sub.billingPeriod,
          currentPeriodStart: now,
          currentPeriodEnd: end,
        },
      });
      await tx.invoice.updateMany({
        where: invoice
          ? { id: invoice.id }
          : { tenantId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.PAID, paidAt: now },
      });
      await tx.notification.create({
        data: {
          tenantId,
          type: NotificationType.SUBSCRIPTION_ACTIVATED,
          title: 'Abonnement activé',
          body: invoice?.tier
            ? `Votre formule ${invoice.tier.name} est active jusqu’au ${end.toLocaleDateString('fr-FR')}.`
            : `Votre abonnement PRO est actif jusqu’au ${end.toLocaleDateString('fr-FR')}.`,
        },
      });
    });

    await this.audit(tenantId, actorId, AuditAction.SUBSCRIBE, 'Subscription', tenantId, {
      kind: 'activate-pro',
      periodDays: days,
      invoiceId: invoice?.id ?? null,
      tier: invoice?.tier?.key ?? null,
    });

    this.events.publish(tenantId, {
      type: NotificationType.SUBSCRIPTION_ACTIVATED,
      title: 'Abonnement activé',
      body: 'Votre paiement a été validé. La gestion à distance est débloquée.',
      data: { endsAt: end.toISOString(), tierKey: invoice?.tier?.key ?? null },
    });
    this.notifications.sendPushToTenant(tenantId, 'Abonnement activé', 'Votre paiement a été validé. La gestion à distance est débloquée.');

    return this.getForTenant(tenantId);
  }

  /** Downgrade to FREE and revoke any remote access (paywall re-enforced). */
  async deactivate(tenantId: string, actorId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Abonnement introuvable.');

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { tenantId },
        data: {
          plan: SubscriptionPlan.FREE,
          status: SubscriptionStatus.ACTIVE,
          tierId: null,
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

  async getPaymentInfo() {
    const rows = await this.prisma.platformConfig.findMany({
      where: { key: { in: ['wave_number', 'om_number', 'payment_instructions'] } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return {
      wave: map['wave_number'] ?? null,
      orangeMoney: map['om_number'] ?? null,
      instructions: map['payment_instructions'] ?? null,
    };
  }

  async uploadProof(
    tenantId: string,
    invoiceId: string,
    method: PaymentMethod,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    note?: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) throw new BadRequestException('Facture introuvable.');

    const dir = join(process.cwd(), 'uploads', 'proofs');
    await mkdir(dir, { recursive: true });
    const ext = file.originalname.split('.').pop() ?? 'jpg';
    const filename = `${invoiceId}-${Date.now()}.${ext}`;
    await writeFile(join(dir, filename), file.buffer);

    const proof = await this.prisma.paymentProof.create({
      data: {
        invoiceId,
        method,
        imageUrl: `/uploads/proofs/${filename}`,
        note: note ?? null,
      },
    });

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    this.events.publishPlatform({
      type: NotificationType.PAYMENT_PROOF_RECEIVED,
      title: 'Preuve de paiement reçue',
      body: `${tenant?.name ?? 'Un client'} a envoyé une preuve de paiement (${method}).`,
      data: { tenantId, invoiceId, proofId: proof.id },
    });

    return { proof, message: 'Preuve envoyée. L\'administrateur validera votre paiement.' };
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
