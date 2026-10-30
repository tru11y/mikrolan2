import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingPeriod,
  PaymentIntentStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/error-codes';
import type { AppConfig } from '../../../config/configuration';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { PERIOD_DAYS, periodAmount, TiersService } from '../../subscriptions/tiers.service';
import { SaspayClient } from './saspay.client';
import type { CreateCheckoutDto } from './dto/checkout.dto';
import {
  saspayTransactionDataSchema,
  type SaspayWebhookEvent,
  toIntegerXof,
} from './dto/webhook.dto';

const SASPAY_SYSTEM_ACTOR = 'saspay-webhook';

@Injectable()
export class SaspayService {
  private readonly logger = new Logger(SaspayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly tiers: TiersService,
    private readonly client: SaspayClient,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private assertEnabled(): void {
    if (!this.config.get('SASPAY_ENABLED', { infer: true })) {
      throw new BusinessException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.PAYMENT_PROVIDER_DISABLED,
        'Paiement en ligne non disponible pour le moment.',
      );
    }
  }

  /**
   * Mobile → crée (ou réutilise) une Invoice PENDING pour ce tenant + un
   * PaymentIntent SasPay associé, puis retourne l'URL de checkout.
   *
   * Règles anti-abus :
   *  - Le montant est TOUJOURS recalculé depuis le tier côté serveur ;
   *    `amount` envoyé par le mobile est ignoré par construction (DTO).
   *  - Si une Invoice PENDING existe déjà, on y rattache le nouvel intent
   *    plutôt que d'empiler des factures orphelines.
   *  - Si un intent SasPay PENDING existe déjà sur cette Invoice avec une
   *    `checkoutUrl` encore valide, on le renvoie tel quel (évite les
   *    doubles sessions au moindre double-tap mobile).
   */
  async createCheckout(
    tenantId: string,
    userId: string,
    dto: CreateCheckoutDto,
  ): Promise<{ intentId: string; checkoutUrl: string; invoiceId: string; amount: number }> {
    this.assertEnabled();

    const tier = await this.tiers.getByKeyOrThrow(dto.tierKey);
    const billingPeriod: BillingPeriod = dto.billingPeriod;
    const amount = periodAmount(tier, billingPeriod);
    const periodDays = PERIOD_DAYS[billingPeriod];

    // Reuse ou création de la facture — même règle que requestUpgradeInner.
    const existingInvoice = await this.prisma.invoice.findFirst({
      where: { tenantId, status: PaymentStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });

    const invoice = existingInvoice
      ? await this.prisma.invoice.update({
          where: { id: existingInvoice.id },
          data: {
            amount,
            tierId: tier.id,
            billingPeriod,
            periodDays,
            provider: PaymentProvider.SASPAY,
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
            provider: PaymentProvider.SASPAY,
            idempotencyKey: `saspay-${tenantId}-${randomUUID()}`,
            status: PaymentStatus.PENDING,
          },
        });

    // Debounce : un intent SasPay PENDING existe déjà sur cette facture →
    // on renvoie son checkoutUrl sans recréer une session côté SasPay.
    const existingIntent = await this.prisma.paymentIntent.findFirst({
      where: {
        invoiceId: invoice.id,
        status: PaymentIntentStatus.PENDING,
        provider: PaymentProvider.SASPAY,
        checkoutUrl: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingIntent?.checkoutUrl) {
      return {
        intentId: existingIntent.id,
        checkoutUrl: existingIntent.checkoutUrl,
        invoiceId: invoice.id,
        amount,
      };
    }

    const idempotencyKey = randomUUID();
    const intent = await this.prisma.paymentIntent.create({
      data: {
        tenantId,
        userId,
        invoiceId: invoice.id,
        provider: PaymentProvider.SASPAY,
        idempotencyKey,
        status: PaymentIntentStatus.PENDING,
        amountRequested: amount,
        currency: 'XOF',
      },
    });

    let session: Awaited<ReturnType<SaspayClient['createCheckoutSession']>>;
    try {
      session = await this.client.createCheckoutSession({
        amount,
        currency: 'XOF',
        country: this.config.get('SASPAY_COUNTRY', { infer: true }),
        networks: this.config.get('SASPAY_NETWORKS', { infer: true }),
        feeChargeMode: 'DEDUCTED',
        successUrl: this.config.get('SASPAY_CHECKOUT_SUCCESS_URL', { infer: true }),
        cancelUrl: this.config.get('SASPAY_CHECKOUT_CANCEL_URL', { infer: true }),
        reference: `MKL-${invoice.id}`,
        idempotencyKey,
        metadata: {
          intentId: intent.id,
          invoiceId: invoice.id,
          tenantId,
        },
      });
    } catch (err) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.FAILED },
      });
      throw err;
    }

    const updated = await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        providerSessionId: session.id,
        checkoutUrl: session.checkoutUrl,
        expiresAt: session.expiresAt,
      },
    });

    return {
      intentId: updated.id,
      checkoutUrl: session.checkoutUrl,
      invoiceId: invoice.id,
      amount,
    };
  }

  /** Statut d'un intent, pour polling mobile post-checkout. */
  async getIntentStatus(tenantId: string, intentId: string) {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { id: intentId, tenantId },
      select: {
        id: true,
        status: true,
        activatedAt: true,
        amountRequested: true,
        amountCharged: true,
        amountNet: true,
        currency: true,
        createdAt: true,
      },
    });
    if (!intent) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        ErrorCode.PAYMENT_INTENT_NOT_FOUND,
        'Paiement introuvable.',
      );
    }
    return intent;
  }

  /**
   * Traitement d'un event webhook SasPay dont la signature a DÉJÀ été
   * vérifiée en amont (contrôleur). Idempotent : plusieurs re-livraisons
   * du même event n'activeront jamais l'abonnement deux fois, grâce à :
   *  - la contrainte UNIQUE sur `WebhookEventLog.eventHash` (dédup par livraison)
   *  - la contrainte UNIQUE sur `PaymentIntent.providerReference` (dédup transaction)
   *  - la transaction atomique dans `SubscriptionsService.activate`
   */
  async handleWebhookEvent(
    event: SaspayWebhookEvent,
    eventHash: string,
  ): Promise<{ handled: boolean; reason?: string }> {
    // Dédup au niveau livraison : si on a déjà vu CET event (même ts+sig),
    // on acquitte sans rien faire. Insert d'abord, traitement ensuite —
    // ainsi une collision concurrente est rejetée au niveau Postgres.
    try {
      await this.prisma.webhookEventLog.create({
        data: {
          provider: 'saspay',
          eventType: event.event,
          eventHash,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.log(`SasPay webhook duplicate delivery ignored (hash=${eventHash.slice(0, 8)}...)`);
        return { handled: true, reason: 'duplicate_delivery' };
      }
      throw err;
    }

    // Les events settlement.* ont un payload non stabilisé par SasPay →
    // on les acquitte sans les parser (dédup déjà faite).
    if (!event.event.startsWith('transaction.')) {
      return { handled: true, reason: 'non_transaction_event' };
    }

    const parsed = saspayTransactionDataSchema.safeParse(event.data);
    if (!parsed.success) {
      this.logger.warn(`SasPay webhook ${event.event} payload invalid: ${parsed.error.message}`);
      return { handled: true, reason: 'invalid_payload' };
    }
    const data = parsed.data;

    const sessionId = data.id ?? null;
    const reference = data.reference ?? null;
    const metadataIntentId = data.metadata?.intentId ?? null;

    const intent = await this.prisma.paymentIntent.findFirst({
      where: {
        OR: [
          metadataIntentId ? { id: metadataIntentId } : undefined,
          sessionId ? { providerSessionId: sessionId } : undefined,
          reference ? { providerReference: reference } : undefined,
        ].filter((x): x is NonNullable<typeof x> => x != null),
      },
    });

    if (!intent) {
      this.logger.warn(
        `SasPay webhook ${event.event}: no matching PaymentIntent (sessionId=${sessionId}, ref=${reference})`,
      );
      return { handled: true, reason: 'intent_not_found' };
    }

    const amountCharged = toIntegerXof(data.charged);
    const amountNet = toIntegerXof(data.net_amount);
    const fee = toIntegerXof(data.fee);

    if (event.event === 'transaction.success') {
      // On n'exécute l'activation QU'UNE SEULE FOIS. On tente d'abord
      // d'épingler providerReference en exclusivité : si quelqu'un d'autre
      // (re-livraison concurrente) y est arrivé avant nous, on sort.
      if (!reference) {
        this.logger.warn(`SasPay transaction.success without reference (intentId=${intent.id})`);
        return { handled: true, reason: 'missing_reference' };
      }

      try {
        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: {
            providerReference: reference,
            status: PaymentIntentStatus.SUCCESS,
            amountCharged,
            amountNet,
            fee,
            feeChargeMode: data.fee_charge_mode ?? null,
            countryCode: data.country ?? null,
            network: data.network ?? null,
            rawLastEvent: event as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          this.logger.log(
            `SasPay transaction.success for already-processed reference ${reference} ignored`,
          );
          return { handled: true, reason: 'already_processed' };
        }
        throw err;
      }

      // Activation : réutilise le flux éprouvé (transactionnel, idempotent
      // via `updateMany where status: PENDING`).
      await this.subscriptions.activate(intent.tenantId, SASPAY_SYSTEM_ACTOR, undefined, intent.invoiceId);

      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { activatedAt: new Date() },
      });

      return { handled: true, reason: 'activated' };
    }

    if (event.event === 'transaction.failed' || event.event === 'transaction.cancelled') {
      const nextStatus =
        event.event === 'transaction.failed'
          ? PaymentIntentStatus.FAILED
          : PaymentIntentStatus.CANCELLED;
      await this.prisma.paymentIntent.updateMany({
        where: { id: intent.id, status: PaymentIntentStatus.PENDING },
        data: {
          status: nextStatus,
          rawLastEvent: event as unknown as Prisma.InputJsonValue,
        },
      });
      return { handled: true, reason: nextStatus };
    }

    // transaction.created et autres : on stocke juste le dernier event.
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { rawLastEvent: event as unknown as Prisma.InputJsonValue },
    });
    return { handled: true, reason: 'noted' };
  }
}
