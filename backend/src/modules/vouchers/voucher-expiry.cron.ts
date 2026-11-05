import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuditAction,
  ManagementMode,
  SessionStatus,
  UserRole,
  VoucherStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { EventLogService } from '../events/event-log.service';
import { removeActive, removeHotspotUser } from '../../common/routeros/hotspot.ops';
import { setTenantContext, tenantStore } from '../../common/context/tenant-context';
import { computeExpiresAt } from './voucher.service';

const BATCH_SIZE = 200;
const MAX_BATCHES_PER_RUN = 50;
const NOT_FOUND = /no such item/i;

/**
 * Applique l'expiration côté routeur. RouterOS n'impose que `limit-uptime`
 * (temps connecté cumulé) : sans ce job, un ticket entamé mais inactif reste
 * utilisable bien après `usedAt + durée`. Le statut reste ACTIVE (revenu et
 * protections de suppression inchangés) ; `expiresAt` persiste la décision.
 */
@Injectable()
export class VoucherExpiryCron {
  private readonly logger = new Logger(VoucherExpiryCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
    private readonly eventLog: EventLogService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async enforceExpiry(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.run(new Date());
    } finally {
      this.running = false;
    }
  }

  async run(now: Date): Promise<number> {
    // Le filtre « expiré » est appliqué en SQL AVANT le LIMIT (sinon des tickets
    // encore valides en tête de file affament les expirés). Les échecs d'un tour
    // sont exclus des lots suivants du même tour pour ne pas boucler dessus.
    const attempted: string[] = [];
    let enforced = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT v.id FROM "Voucher" v JOIN "Plan" p ON p.id = v."planId"
        WHERE v.status = 'ACTIVE' AND v."expiresAt" IS NULL AND v."usedAt" IS NOT NULL
          AND v."usedAt" + p."durationMinutes" * interval '1 minute' <= ${now}
          AND v.id <> ALL(${attempted}::text[])
        ORDER BY v."usedAt" ASC
        LIMIT ${BATCH_SIZE}`;
      if (rows.length === 0) break;
      attempted.push(...rows.map((r) => r.id));
      enforced += await this.enforceBatch(
        rows.map((r) => r.id),
        now,
      );
    }
    if (enforced > 0) this.logger.log(`Expiry enforced on ${enforced} vouchers`);
    return enforced;
  }

  private async enforceBatch(ids: string[], now: Date): Promise<number> {
    const candidates = await this.prisma.voucher.findMany({
      where: { id: { in: ids } },
      orderBy: { usedAt: 'asc' },
      select: {
        id: true,
        tenantId: true,
        routerId: true,
        mikrotikId: true,
        usedAt: true,
        plan: { select: { durationMinutes: true } },
        router: { select: { mode: true } },
        session: { select: { mikrotikId: true } },
      },
    });

    let enforced = 0;
    for (const v of candidates) {
      const expiresAt = computeExpiresAt(v.usedAt, v.plan.durationMinutes);
      if (!expiresAt || expiresAt.getTime() > now.getTime()) continue;
      try {
        if (v.router.mode === ManagementMode.REMOTE && v.mikrotikId) {
          await this.removeFromRouter(v.tenantId, v.routerId, v.mikrotikId, v.session?.mikrotikId ?? null);
        }
        await this.prisma.voucher.updateMany({
          where: { id: v.id, status: VoucherStatus.ACTIVE, expiresAt: null },
          data: { expiresAt },
        });
        await this.prisma.session.updateMany({
          where: { voucherId: v.id, status: SessionStatus.ACTIVE },
          data: { status: SessionStatus.TERMINATED, terminatedAt: now },
        });
        await this.eventLog.success(AuditAction.UPDATE, 'Voucher', v.id, {
          routerId: v.routerId,
          action: 'EXPIRY_ENFORCED',
          viaRouter: v.router.mode === ManagementMode.REMOTE,
        }, { tenantId: v.tenantId });
        enforced += 1;
      } catch (err) {
        this.logger.warn({
          errorCode: 'VOUCHER_EXPIRY_ENFORCE_FAILED',
          voucherId: v.id,
          routerId: v.routerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return enforced;
  }

  private removeFromRouter(
    tenantId: string,
    routerId: string,
    mikrotikId: string,
    activeId: string | null,
  ): Promise<void> {
    return tenantStore.run({}, async () => {
      setTenantContext({ tenantId, userId: 'system-voucher-expiry', role: UserRole.OWNER });
      await this.remote.run(routerId, async (client) => {
        if (activeId) {
          try {
            await removeActive(client, activeId);
          } catch {
            // session déjà fermée côté routeur
          }
        }
        try {
          await removeHotspotUser(client, mikrotikId);
        } catch (err) {
          if (!NOT_FOUND.test(err instanceof Error ? err.message : String(err))) throw err;
        }
      });
    });
  }
}
