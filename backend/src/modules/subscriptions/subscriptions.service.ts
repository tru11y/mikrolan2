import {
  Injectable,
  BadRequestException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
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
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import type { TenantContext } from '../../common/context/tenant-context';
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

    const notification = await this.prisma.$transaction(async (tx) => {
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
      return tx.notification.create({
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
      data: { notificationId: notification.id, endsAt: end.toISOString(), tierKey: invoice?.tier?.key ?? null },
    });
    this.notifications.sendPushToTenant(
      tenantId,
      'Abonnement activé',
      'Votre paiement a été validé. La gestion à distance est débloquée.',
      null,
      { notificationId: notification.id, type: NotificationType.SUBSCRIPTION_ACTIVATED },
    );

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

    // FIND-005: the stored extension is derived exclusively from the
    // server-validated mimetype — never from the client-supplied filename,
    // which cannot be trusted (originalname/mimetype are independently
    // controlled by the caller and were previously never cross-checked).
    const ext = extensionForMimetype(file.mimetype);
    if (!ext) throw new BadRequestException('Type de fichier non supporté.');
    if (!hasValidImageSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException('Fichier image invalide.');
    }

    const dir = join(process.cwd(), PROOFS_PRIVATE_DIR);
    await mkdir(dir, { recursive: true });
    // Server-generated name — the client's original filename is never used
    // to build a filesystem path (FIND-005 / path traversal hardening).
    const filename = `${randomUUID()}.${ext}`;
    await writeFile(join(dir, filename), file.buffer);

    const proof = await this.prisma.paymentProof.create({
      data: {
        invoiceId,
        method,
        // New uploads are tagged with the private-storage prefix so the
        // resolver (resolveProofFile) can tell them apart from legacy
        // records that still point at the old, formerly-public directory.
        imageUrl: `${PROOFS_PRIVATE_URL_PREFIX}/${filename}`,
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

  /**
   * FIND-004 fix: the only way to retrieve a payment proof's file content.
   * `PaymentProof` has no tenantId column (only a relation through
   * `Invoice`), so it is not — and cannot be — auto-scoped by the Prisma
   * tenant middleware (same structural constraint as `TicketMessage` for
   * FIND-003). Authorization is therefore explicit here: SUPER_ADMIN may
   * read any proof (validation workflow); any other role may only read a
   * proof belonging to an invoice of their own tenant. A non-owning tenant
   * gets the same 404 as a nonexistent proof, never a distinguishing 403 —
   * this avoids confirming to an attacker that a given proofId exists.
   */
  async getProofFile(actor: TenantContext, proofId: string): Promise<StreamableFile> {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id: proofId },
      include: { invoice: { select: { tenantId: true } } },
    });
    if (!proof) throw new NotFoundException('Preuve introuvable.');

    const isOwner = proof.invoice.tenantId === actor.tenantId;
    if (actor.role !== UserRole.SUPER_ADMIN && !isOwner) {
      throw new NotFoundException('Preuve introuvable.');
    }

    const { path, ext } = resolveProofFile(proof.imageUrl);
    let buffer: Buffer;
    try {
      buffer = await readFile(path);
    } catch {
      throw new NotFoundException('Fichier de preuve introuvable.');
    }

    const stream = new StreamableFile(buffer, {
      type: MIME_FOR_EXTENSION[ext],
      disposition: `inline; filename="proof.${ext}"`,
    });
    return stream;
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

// ─── Payment proof storage/validation (FIND-004 / FIND-005) ────────────────
//
// These are free functions (not class members) so they can be unit-tested
// directly without instantiating SubscriptionsService or mocking Prisma.

/** New uploads are written here — never registered as a static/public route. */
const PROOFS_PRIVATE_DIR = join('private-uploads', 'proofs');
/** Prefix stored in `imageUrl` for new uploads, to distinguish them from the
 *  legacy `/uploads/proofs/...` records at resolution time. */
const PROOFS_PRIVATE_URL_PREFIX = '/private-uploads/proofs';
/** Where the formerly-public directory used to live — old records still
 *  physically live here and are NOT moved by this fix. */
const PROOFS_LEGACY_DIR = join('uploads', 'proofs');
const PROOFS_LEGACY_URL_PREFIX = '/uploads/proofs';

/** Server-side whitelist: the only extensions this system will ever write
 *  or serve for a payment proof. Never derived from client input. */
const MIME_FOR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
};
const EXTENSION_FOR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Returns the server-controlled extension for an accepted mimetype, or
 *  `undefined` if the mimetype is not in the whitelist. Never touches
 *  `originalname` — that value is not trusted anywhere in this module. */
export function extensionForMimetype(mimetype: string): string | undefined {
  return EXTENSION_FOR_MIME[mimetype];
}

/**
 * Minimal, deterministic magic-byte check — deliberately not a general
 * parser. Confirms the buffer actually starts with the signature expected
 * for the *claimed* mimetype, so a client cannot pair `Content-Type:
 * image/png` with an HTML/script payload and have it accepted (FIND-005
 * Scenario D — MIME spoofing).
 */
export function hasValidImageSignature(buffer: Buffer, mimetype: string): boolean {
  if (buffer.length < 8) return false;
  if (mimetype === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return PNG_SIGNATURE.every((byte, i) => buffer[i] === byte);
  }
  return false;
}

const FILENAME_PATTERN = /^[A-Za-z0-9._-]+\.(jpg|jpeg|png)$/i;

/**
 * Resolves a `PaymentProof.imageUrl` DB value to an absolute, contained
 * filesystem path — for both new (`/private-uploads/proofs/...`) and
 * legacy (`/uploads/proofs/...`) records.
 *
 * Security properties, in order:
 *  1. `basename()` discards every directory component of the stored value
 *     — a `..`, an absolute path, or an unexpected separator can only ever
 *     survive as (invalid) characters in the final segment, never as an
 *     actual path traversal, regardless of what the DB value contains.
 *  2. The resulting basename is checked against a strict whitelist regex
 *     (alphanumeric/`.`/`_`/`-` only, one of the three accepted image
 *     extensions) — rejects anything else outright.
 *  3. The final joined path is re-verified to be contained within the
 *     selected root directory (defense in depth; steps 1-2 already make
 *     escaping the root structurally impossible, but this makes the
 *     invariant explicit and independently testable).
 *
 * Throws NotFoundException — not a lower-level error — so a malformed or
 * tampered `imageUrl` never leaks filesystem information to the caller.
 */
export function resolveProofFile(imageUrl: string): { path: string; ext: string } {
  const isLegacy =
    imageUrl.startsWith(PROOFS_LEGACY_URL_PREFIX + '/') ||
    imageUrl.startsWith(PROOFS_LEGACY_URL_PREFIX.slice(1) + '/');
  const root = resolve(process.cwd(), isLegacy ? PROOFS_LEGACY_DIR : PROOFS_PRIVATE_DIR);

  const safeName = basename(imageUrl);
  if (!FILENAME_PATTERN.test(safeName)) {
    throw new NotFoundException('Preuve introuvable.');
  }

  const fullPath = resolve(root, safeName);
  if (fullPath !== join(root, safeName) || !fullPath.startsWith(root + sep)) {
    throw new NotFoundException('Preuve introuvable.');
  }

  const ext = safeName.split('.').pop()!.toLowerCase();
  const normalizedExt = ext === 'jpeg' ? 'jpg' : ext;
  return { path: fullPath, ext: normalizedExt };
}
