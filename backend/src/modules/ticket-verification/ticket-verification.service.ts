import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditAction, EventOutcome, VoucherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventLogService } from '../events/event-log.service';
import {
  computeExpiresAt,
  isProvisioned,
  ticketState,
  type TicketState,
} from '../vouchers/voucher.service';
import type { TicketVerifierScope } from '../../common/guards/ticket-verifier-scope.guard';

export type VerificationStatus =
  | 'VALID'
  | 'ALREADY_USED'
  | 'EXPIRED'
  | 'NOT_FOUND'
  | 'TEMPORARILY_UNAVAILABLE';

export type RecommendedAction =
  | 'ALLOW_CUSTOMER'
  | 'DO_NOT_REPLACE'
  | 'SELL_NEW_TICKET'
  | 'RETRY_LATER'
  | 'CHECK_ENTERED_CODE';

export interface VerificationResponse {
  status: VerificationStatus;
  message: string;
  recommendedAction: RecommendedAction;
  ticket?: {
    planName: string;
    durationMinutes: number;
    expiresAt: string | null;
    usedAt: string | null;
  };
}

// The NOT_FOUND response is a single constant so every "ticket inexistant"
// case is byte-identical: no local vs. foreign hotspot distinguishable from
// outside, no voucherId, no routerId, no tenantId.
const NOT_FOUND_RESPONSE: VerificationResponse = Object.freeze({
  status: 'NOT_FOUND',
  message: 'Ticket inexistant',
  recommendedAction: 'CHECK_ENTERED_CODE',
});

const UNAVAILABLE_RESPONSE: VerificationResponse = Object.freeze({
  status: 'TEMPORARILY_UNAVAILABLE',
  message: 'Vérification temporairement indisponible',
  recommendedAction: 'RETRY_LATER',
});

/** Short hash kept in audit metadata instead of the full code. */
function codeFingerprint(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

@Injectable()
export class TicketVerificationService {
  private readonly logger = new Logger(TicketVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventLogService,
  ) {}

  async verify(
    scope: TicketVerifierScope,
    ticketCode: string,
  ): Promise<VerificationResponse> {
    // Normalisation = trim (déjà fait par Zod .trim()) + match insensible à
    // la casse en base, aligné sur VoucherService.verifyVoucherForOperator /
    // lookupByCode. Ne pas uppercase ici : certains codes historiques peuvent
    // avoir une casse mixte conservée en DB; le mode: 'insensitive' couvre.
    const normalized = ticketCode;
    const fingerprint = codeFingerprint(normalized);

    let voucher: Awaited<ReturnType<typeof this.loadVoucher>> = null;
    try {
      voucher = await this.loadVoucher(scope, normalized);
    } catch (err) {
      // Erreur Prisma / infrastructure : surface publique générique, trace
      // technique côté audit. Ne jamais présenter cela comme NOT_FOUND.
      this.logger.error(
        `verify() DB failure: ${err instanceof Error ? err.message : err}`,
      );
      await this.auditFailure(scope, fingerprint, err);
      return UNAVAILABLE_RESPONSE;
    }

    if (!voucher) {
      // Soit le code n'existe nulle part, soit il existe sur un autre routeur
      // ou chez un autre tenant : réponse strictement identique, et aucune
      // seconde recherche globale.
      await this.auditResult(scope, fingerprint, null, 'NOT_FOUND');
      return NOT_FOUND_RESPONSE;
    }

    const response = this.mapToPublic(voucher);
    // L'état interne REVOKED reste tracé dans l'audit (usage interne) mais
    // n'est jamais exposé : le vendeur voit exactement un « ticket inexistant ».
    await this.auditResult(
      scope,
      fingerprint,
      voucher.id,
      response.status,
      voucher.status === VoucherStatus.REVOKED ? 'REVOKED' : undefined,
    );
    return response;
  }

  private async loadVoucher(scope: TicketVerifierScope, code: string) {
    return this.prisma.voucher.findFirst({
      where: {
        tenantId: scope.tenantId,
        routerId: scope.routerId,
        code: { equals: code, mode: 'insensitive' },
      },
      select: {
        id: true,
        status: true,
        mikrotikId: true,
        expiresAt: true,
        usedAt: true,
        plan: { select: { name: true, durationMinutes: true } },
      },
    });
  }

  private mapToPublic(
    v: NonNullable<Awaited<ReturnType<typeof this.loadVoucher>>>,
  ): VerificationResponse {
    const provisioned = isProvisioned(v);
    const now = new Date();
    const expiresAt = computeExpiresAt(
      v.usedAt,
      v.plan.durationMinutes,
      v.expiresAt,
    );
    const state: TicketState = ticketState({
      status: v.status,
      provisioned,
      expiresAt,
      now,
    });

    const commonTicket = {
      planName: v.plan.name,
      durationMinutes: v.plan.durationMinutes,
      expiresAt: expiresAt?.toISOString() ?? null,
      usedAt: v.usedAt?.toISOString() ?? null,
    };

    switch (state) {
      case 'REVOKED':
        // Décision produit : un ticket révoqué n'est jamais proposé à la vente,
        // son existence ne doit pas être révélée au vendeur. Réponse canonique
        // identique à un code inexistant / d'un autre routeur / d'un autre tenant.
        return NOT_FOUND_RESPONSE;
      case 'EXPIRED':
        return {
          status: 'EXPIRED',
          message: 'Ticket expiré',
          recommendedAction: 'SELL_NEW_TICKET',
          ticket: commonTicket,
        };
      case 'ENDED':
        return {
          status: 'ALREADY_USED',
          message: 'Ticket déjà utilisé',
          recommendedAction: 'DO_NOT_REPLACE',
          ticket: commonTicket,
        };
      case 'IN_USE':
        // Already activated by someone — second person presenting the same
        // code cannot connect in parallel beyond sharedUsers. For the field,
        // treat as "already used" (do not replace, do not resell).
        return {
          status: 'ALREADY_USED',
          message: 'Ticket déjà utilisé',
          recommendedAction: 'DO_NOT_REPLACE',
          ticket: commonTicket,
        };
      case 'UNAVAILABLE':
        // Ticket row exists but not pushed to the router yet — not a vendor
        // decision, surface as a transient technical state, not NOT_FOUND.
        return UNAVAILABLE_RESPONSE;
      case 'AVAILABLE':
      default:
        return {
          status: 'VALID',
          message: 'Ticket valide',
          recommendedAction: 'ALLOW_CUSTOMER',
          ticket: commonTicket,
        };
    }
  }

  // Best-effort audit: EventLogService.emit() swallows write failures by
  // design (see event-log.service.ts). We do not couple the user-facing
  // result to the audit write.
  private auditResult(
    scope: TicketVerifierScope,
    codeFingerprint: string,
    voucherId: string | null,
    result: VerificationStatus,
    internalState?: 'REVOKED',
  ): Promise<void> {
    const outcome =
      result === 'TEMPORARILY_UNAVAILABLE'
        ? EventOutcome.WARNING
        : EventOutcome.SUCCESS;
    return this.events.emit({
      action: AuditAction.VERIFY,
      entityType: 'Voucher',
      entityId: voucherId ?? undefined,
      outcome,
      metadata: {
        result,
        source: 'MANUAL',
        routerId: scope.routerId,
        codeFingerprint,
        ...(internalState ? { internalState } : {}),
      },
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
  }

  private auditFailure(
    scope: TicketVerifierScope,
    codeFingerprint: string,
    err: unknown,
  ): Promise<void> {
    return this.events.failure(
      AuditAction.VERIFY,
      'Voucher',
      undefined,
      err,
      {
        result: 'TEMPORARILY_UNAVAILABLE',
        source: 'MANUAL',
        routerId: scope.routerId,
        codeFingerprint,
      },
      { tenantId: scope.tenantId, userId: scope.userId },
    );
  }
}

export { NOT_FOUND_RESPONSE, UNAVAILABLE_RESPONSE };
