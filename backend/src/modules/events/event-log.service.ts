import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, EventOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../common/context/tenant-context';
import { EventsService } from './events.service';

export interface EventLogEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  outcome: EventOutcome;
  metadata?: Prisma.InputJsonValue;
  tenantId?: string;
  userId?: string;
}

@Injectable()
export class EventLogService {
  private readonly logger = new Logger(EventLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async emit(entry: EventLogEntry): Promise<void> {
    const ctx = getTenantContext();
    const tenantId = entry.tenantId ?? ctx?.tenantId;
    const userId = entry.userId ?? ctx?.userId ?? null;
    const ip = ctx?.ip ?? null;

    if (!tenantId) {
      this.logger.warn(`EventLog sans tenantId: ${entry.action} ${entry.entityType}`);
      return;
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          outcome: entry.outcome,
          metadata: entry.metadata ?? Prisma.DbNull,
          ip,
        },
      });
    } catch (err) {
      this.logger.error(
        `AuditLog write failed [${entry.action} ${entry.entityType}]: ${err instanceof Error ? err.message : err}`,
      );
    }

    const sseType = entry.outcome === EventOutcome.FAILED ? 'ROUTER_OFFLINE' : 'VOUCHER_ACTIVATED';

    try {
      this.events.publish(tenantId, {
        type: sseType as any,
        title: `${entry.entityType}.${entry.action}`,
        body: `[${entry.outcome}] ${entry.entityType} ${entry.entityId ?? ''}`.trim(),
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          outcome: entry.outcome,
          ...(entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
            ? (entry.metadata as Record<string, string | number | null>)
            : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`SSE publish failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async success(
    action: AuditAction,
    entityType: string,
    entityId?: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.emit({ action, entityType, entityId, outcome: EventOutcome.SUCCESS, metadata });
  }

  async warning(
    action: AuditAction,
    entityType: string,
    entityId?: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.emit({ action, entityType, entityId, outcome: EventOutcome.WARNING, metadata });
  }

  async partialSuccess(
    action: AuditAction,
    entityType: string,
    entityId?: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.emit({ action, entityType, entityId, outcome: EventOutcome.PARTIAL_SUCCESS, metadata });
  }

  async failed(
    action: AuditAction,
    entityType: string,
    entityId?: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.emit({ action, entityType, entityId, outcome: EventOutcome.FAILED, metadata });
  }
}
