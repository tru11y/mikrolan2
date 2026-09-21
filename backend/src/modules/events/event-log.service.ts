import { HttpException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, EventOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../common/context/tenant-context';

export type EventCategory =
  | 'TICKETS'
  | 'VAULT'
  | 'ROUTERS'
  | 'DIAGNOSTICS'
  | 'PAYMENTS'
  | 'SUPPORT'
  | 'ACCOUNT';

/** Domaine métier de chaque type d'entité tracé. Source unique pour l'Audit Center. */
export const ENTITY_CATEGORY: Record<string, EventCategory> = {
  Voucher: 'TICKETS',
  VoucherBatch: 'TICKETS',
  Plan: 'TICKETS',
  TicketVault: 'VAULT',
  Router: 'ROUTERS',
  RemotePeer: 'ROUTERS',
  Diagnostic: 'DIAGNOSTICS',
  Invoice: 'PAYMENTS',
  PaymentProof: 'PAYMENTS',
  Subscription: 'PAYMENTS',
  SupportTicket: 'SUPPORT',
  Tenant: 'ACCOUNT',
  PlatformConfig: 'ACCOUNT',
  User: 'ACCOUNT',
};

export function categoryOf(entityType: string): EventCategory | null {
  return ENTITY_CATEGORY[entityType] ?? null;
}

export function entityTypesOf(category: EventCategory): string[] {
  return Object.entries(ENTITY_CATEGORY)
    .filter(([, c]) => c === category)
    .map(([entity]) => entity);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventLogEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  outcome: EventOutcome;
  metadata?: Prisma.InputJsonObject;
  tenantId?: string;
  userId?: string;
}

/** Code d'erreur métier + message lisibles depuis n'importe quelle erreur levée. */
export function describeFailure(err: unknown): { errorCode: string; error: string } {
  if (err instanceof HttpException) {
    const body = err.getResponse();
    const code =
      typeof body === 'object' && body !== null && 'errorCode' in body
        ? String((body as { errorCode: unknown }).errorCode)
        : `HTTP_${err.getStatus()}`;
    return { errorCode: code, error: err.message };
  }
  if (err instanceof Error) {
    const named = err.name && err.name !== 'Error' ? err.name : 'UNEXPECTED_ERROR';
    return { errorCode: named, error: err.message };
  }
  return { errorCode: 'UNEXPECTED_ERROR', error: String(err) };
}

@Injectable()
export class EventLogService {
  private readonly logger = new Logger(EventLogService.name);
  private readonly traced = new WeakSet<object>();

  constructor(private readonly prisma: PrismaService) {}

  /** Ne lève jamais : une trace perdue est loguée, elle ne doit pas casser l'action métier. */
  async emit(entry: EventLogEntry): Promise<void> {
    const ctx = getTenantContext();
    const tenantId = entry.tenantId ?? ctx?.tenantId;
    if (!tenantId) {
      this.logger.warn(
        `EventLog sans tenantId, non tracé : ${entry.action} ${entry.entityType} ${entry.outcome}`,
      );
      return;
    }

    // A non-user actor (e.g. the SYSTEM cron) has no User row to reference.
    const actor = entry.userId ?? ctx?.userId ?? null;
    const isSystemActor = actor !== null && !UUID_RE.test(actor);
    const metadata = isSystemActor ? { ...entry.metadata, actor } : entry.metadata;

    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId: isSystemActor ? null : actor,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          outcome: entry.outcome,
          metadata: metadata ?? Prisma.DbNull,
          ip: ctx?.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `AuditLog write failed [${entry.action} ${entry.entityType} ${entry.outcome}]: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private with(outcome: EventOutcome) {
    return (
      action: AuditAction,
      entityType: string,
      entityId?: string,
      metadata?: Prisma.InputJsonObject,
      actor?: { tenantId?: string; userId?: string },
    ) => this.emit({ action, entityType, entityId, outcome, metadata, ...actor });
  }

  readonly success = this.with(EventOutcome.SUCCESS);
  readonly warning = this.with(EventOutcome.WARNING);
  readonly partialSuccess = this.with(EventOutcome.PARTIAL_SUCCESS);

  /** FAILED avec `errorCode` + `error` extraits de l'exception. */
  failure(
    action: AuditAction,
    entityType: string,
    entityId: string | undefined,
    err: unknown,
    metadata?: Prisma.InputJsonObject,
    actor?: { tenantId?: string; userId?: string },
  ): Promise<void> {
    if (typeof err === 'object' && err !== null) this.traced.add(err);
    return this.emit({
      action,
      entityType,
      entityId,
      outcome: EventOutcome.FAILED,
      metadata: { ...describeFailure(err), ...metadata },
      ...actor,
    });
  }

  /** Trace uniquement l'echec (les succes sont traces par l'action elle-meme). */
  async guard<T>(
    spec: {
      action: AuditAction;
      entityType: string;
      entityId?: string;
      metadata?: Prisma.InputJsonObject;
      actor?: { tenantId?: string; userId?: string };
    },
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && this.traced.has(err))) {
        await this.failure(spec.action, spec.entityType, spec.entityId, err, spec.metadata, spec.actor);
      }
      throw err;
    }
  }

  /**
   * Execute une action metier et la trace : SUCCESS (ou l'issue decrite par
   * `describe`) si elle aboutit, FAILED avec code d'erreur si elle leve.
   */
  async track<T>(
    spec: {
      action: AuditAction;
      entityType: string;
      entityId?: string;
      metadata?: Prisma.InputJsonObject;
      actor?: { tenantId?: string; userId?: string };
    },
    run: () => Promise<T>,
    describe?: (result: T) => {
      entityId?: string;
      outcome?: EventOutcome;
      metadata?: Prisma.InputJsonObject;
    },
  ): Promise<T> {
    let result: T;
    try {
      result = await run();
    } catch (err) {
      if (!(typeof err === 'object' && err !== null && this.traced.has(err))) {
        await this.failure(spec.action, spec.entityType, spec.entityId, err, spec.metadata, spec.actor);
      }
      throw err;
    }
    const d = describe?.(result);
    await this.emit({
      action: spec.action,
      entityType: spec.entityType,
      entityId: d?.entityId ?? spec.entityId,
      outcome: d?.outcome ?? EventOutcome.SUCCESS,
      metadata: { ...spec.metadata, ...d?.metadata },
      ...spec.actor,
    });
    return result;
  }
}
