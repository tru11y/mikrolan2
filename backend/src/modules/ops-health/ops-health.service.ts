import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RouterRow, RoutersHealth, summarizeRouters } from './router-health.logic';

export type HealthLevel = 'GREEN' | 'ORANGE' | 'RED';

export interface ExpiryHealth {
  level: HealthLevel;
  /** Tickets expirés que le cron peut traiter (routeur joignable). */
  pendingOnline: number;
  /** Expirés sur routeur hors ligne / sans identifiants / supprimé : le cron les saute volontairement. */
  pendingOffline: number;
  oldestPendingMinutes: number | null;
  appliedLast24h: number;
  lastExpiredAt: Date | null;
}

/** Le cron d'expiration tourne toutes les 5 min : au-delà, il est considéré bloqué. */
export const PENDING_RED_AFTER_MINUTES = 30;

export function expiryLevel(pendingOnline: number, oldestMinutes: number | null): HealthLevel {
  if (pendingOnline === 0) return 'GREEN';
  return (oldestMinutes ?? 0) >= PENDING_RED_AFTER_MINUTES ? 'RED' : 'ORANGE';
}

@Injectable()
export class OpsHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getExpiryHealth(now: Date = new Date()): Promise<ExpiryHealth> {
    const since = new Date(now.getTime() - 24 * 3_600_000);
    // Même notion de « joignable » que VoucherExpiryCron.run : tout écart fausserait l'alerte.
    const [pendingRow, applied, last] = await Promise.all([
      this.prisma.$queryRaw<Array<{ pending: bigint; blocked: bigint; oldest: Date | null }>>`
        SELECT COUNT(*) FILTER (WHERE NOT x.blocked) AS pending,
               COUNT(*) FILTER (WHERE x.blocked) AS blocked,
               MIN(x.due) FILTER (WHERE NOT x.blocked) AS oldest
        FROM (
          SELECT v."usedAt" + p."durationMinutes" * interval '1 minute' AS due,
                 (r."deletedAt" IS NOT NULL
                  OR (r.mode = 'REMOTE' AND (r."credEncrypted" IS NULL OR r.health = 'OFFLINE'))) AS blocked
          FROM "Voucher" v
          JOIN "Plan" p ON p.id = v."planId"
          JOIN "Router" r ON r.id = v."routerId"
          WHERE v.status = 'ACTIVE' AND v."expiresAt" IS NULL AND v."usedAt" IS NOT NULL
            AND v."usedAt" + p."durationMinutes" * interval '1 minute' <= ${now}
        ) x`,
      this.prisma.voucher.count({ where: { expiresAt: { gte: since, lte: now } } }),
      this.prisma.voucher.aggregate({
        _max: { expiresAt: true },
        where: { expiresAt: { lte: now } },
      }),
    ]);
    const pendingOnline = Number(pendingRow[0]?.pending ?? 0n);
    const pendingOffline = Number(pendingRow[0]?.blocked ?? 0n);
    const oldest = pendingRow[0]?.oldest ?? null;
    const oldestPendingMinutes = oldest
      ? Math.floor((now.getTime() - oldest.getTime()) / 60_000)
      : null;
    return {
      level: expiryLevel(pendingOnline, oldestPendingMinutes),
      pendingOnline,
      pendingOffline,
      oldestPendingMinutes,
      appliedLast24h: applied,
      lastExpiredAt: last._max.expiresAt,
    };
  }

  /** Une seule requête bornée aux routeurs non supprimés ; aucun secret n'est lu. */
  /** `tenantIds` restreint le périmètre (tests isolés) ; l'endpoint SUPER_ADMIN ne le passe pas. */
  async getRoutersHealth(now: Date = new Date(), tenantIds?: string[]): Promise<RoutersHealth> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        mode: RouterRow['mode'];
        health: RouterRow['health'];
        has_cred: boolean;
        last_heartbeat: Date | null;
        created_at: Date;
      }>
    >`SELECT r.id, COALESCE(r.alias, r.identity) AS name, r.mode::text AS mode, r.health::text AS health,
             (r."credEncrypted" IS NOT NULL) AS has_cred, r."lastHeartbeat" AS last_heartbeat,
             r."createdAt" AS created_at
      FROM "Router" r WHERE r."deletedAt" IS NULL
      ${tenantIds ? Prisma.sql`AND r."tenantId" = ANY(${tenantIds})` : Prisma.empty}`;
    return summarizeRouters(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        mode: r.mode,
        health: r.health,
        credentialsConfigured: r.has_cred,
        lastHeartbeat: r.last_heartbeat,
        createdAt: r.created_at,
      })),
      now,
    );
  }
}
