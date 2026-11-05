import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuditAction,
  ManagementMode,
  Prisma,
  RouterHealth,
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
// Après un échec routeur, on ne le retente pas avant ce délai : un routeur hors ligne
// ne doit ni ralentir les autres (timeouts en série) ni monopoliser le lot.
const ROUTER_COOLDOWN_MS = 15 * 60_000;
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
  private readonly cooldowns = new Map<string, number>();

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
    for (const [routerId, until] of this.cooldowns) {
      if (until <= now.getTime()) this.cooldowns.delete(routerId);
    }
    // LOCAL : base seule, toujours traité. REMOTE : seulement si des identifiants existent
    // et que le routeur n'est pas déclaré hors ligne (sinon timeout garanti).
    const reachable: Prisma.RouterWhereInput = {
      deletedAt: null,
      OR: [
        { mode: ManagementMode.LOCAL },
        { mode: ManagementMode.REMOTE, credEncrypted: { not: null }, health: { not: RouterHealth.OFFLINE } },
      ],
    };
    // L'échéance (usedAt + durée du forfait) ne s'exprime pas en SQL via Prisma : on la
    // ramène à un seuil `usedAt <= now - durée` par durée distincte de forfait. Sans cela,
    // `take` s'applique à des tickets pas encore expirés et les expirés plus récents
    // restent bloqués derrière eux (starvation).
    const durations = await this.prisma.plan.findMany({
      distinct: ['durationMinutes'],
      select: { durationMinutes: true },
    });
    const expiredNow: Prisma.VoucherWhereInput[] = durations.map(({ durationMinutes }) => ({
      plan: { durationMinutes },
      usedAt: { lte: new Date(now.getTime() - durationMinutes * 60_000) },
    }));
    if (expiredNow.length === 0) return 0;
    const candidates = await this.prisma.voucher.findMany({
      where: {
        status: VoucherStatus.ACTIVE,
        expiresAt: null,
        usedAt: { not: null },
        OR: expiredNow,
        routerId: { notIn: [...this.cooldowns.keys()] },
        router: reachable,
      },
      orderBy: { usedAt: 'asc' },
      take: BATCH_SIZE,
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
    const failedRouters = new Set<string>();
    for (const v of candidates) {
      if (failedRouters.has(v.routerId)) continue;
      const expiresAt = computeExpiresAt(v.usedAt, v.plan.durationMinutes);
      if (!expiresAt || expiresAt.getTime() > now.getTime()) continue;
      if (v.router.mode === ManagementMode.REMOTE && v.mikrotikId) {
        try {
          await this.removeFromRouter(v.tenantId, v.routerId, v.mikrotikId, v.session?.mikrotikId ?? null);
        } catch (err) {
          failedRouters.add(v.routerId);
          this.cooldowns.set(v.routerId, now.getTime() + ROUTER_COOLDOWN_MS);
          this.logger.warn({
            errorCode: 'VOUCHER_EXPIRY_ROUTER_FAILED',
            voucherId: v.id,
            routerId: v.routerId,
            cooldownMinutes: ROUTER_COOLDOWN_MS / 60_000,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        this.cooldowns.delete(v.routerId);
      }
      try {
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
    if (enforced > 0) this.logger.log(`Expiry enforced on ${enforced} vouchers`);
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
