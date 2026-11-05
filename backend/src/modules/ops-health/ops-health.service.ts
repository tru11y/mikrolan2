import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type HealthLevel = 'GREEN' | 'ORANGE' | 'RED';

export interface ExpiryHealth {
  level: HealthLevel;
  /** Tickets expirés que le cron peut traiter (routeur joignable). */
  pending: number;
  /** Expirés sur routeur hors ligne / sans identifiants / supprimé : le cron les saute volontairement. */
  blockedOffline: number;
  oldestPendingMinutes: number | null;
  appliedLast24h: number;
  lastExpiredAt: Date | null;
}

/** Le cron d'expiration tourne toutes les 5 min : au-delà, il est considéré bloqué. */
export const PENDING_RED_AFTER_MINUTES = 30;

export function expiryLevel(pending: number, oldestMinutes: number | null): HealthLevel {
  if (pending === 0) return 'GREEN';
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
    const pending = Number(pendingRow[0]?.pending ?? 0n);
    const blockedOffline = Number(pendingRow[0]?.blocked ?? 0n);
    const oldest = pendingRow[0]?.oldest ?? null;
    const oldestPendingMinutes = oldest
      ? Math.floor((now.getTime() - oldest.getTime()) / 60_000)
      : null;
    return {
      level: expiryLevel(pending, oldestPendingMinutes),
      pending,
      blockedOffline,
      oldestPendingMinutes,
      appliedLast24h: applied,
      lastExpiredAt: last._max.expiresAt,
    };
  }
}
