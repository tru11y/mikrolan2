import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type HealthLevel = 'GREEN' | 'ORANGE' | 'RED';

export interface ExpiryHealth {
  level: HealthLevel;
  pending: number;
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
    // Même prédicat que VoucherExpiryCron.run : tout écart fausserait l'alerte.
    const [pendingRow, applied, last] = await Promise.all([
      this.prisma.$queryRaw<Array<{ pending: bigint; oldest: Date | null }>>`
        SELECT COUNT(*) AS pending,
               MIN(v."usedAt" + p."durationMinutes" * interval '1 minute') AS oldest
        FROM "Voucher" v JOIN "Plan" p ON p.id = v."planId"
        WHERE v.status = 'ACTIVE' AND v."expiresAt" IS NULL AND v."usedAt" IS NOT NULL
          AND v."usedAt" + p."durationMinutes" * interval '1 minute' <= ${now}`,
      this.prisma.voucher.count({ where: { expiresAt: { gte: since, lte: now } } }),
      this.prisma.voucher.aggregate({
        _max: { expiresAt: true },
        where: { expiresAt: { lte: now } },
      }),
    ]);
    const pending = Number(pendingRow[0]?.pending ?? 0n);
    const oldest = pendingRow[0]?.oldest ?? null;
    const oldestPendingMinutes = oldest
      ? Math.floor((now.getTime() - oldest.getTime()) / 60_000)
      : null;
    return {
      level: expiryLevel(pending, oldestPendingMinutes),
      pending,
      oldestPendingMinutes,
      appliedLast24h: applied,
      lastExpiredAt: last._max.expiresAt,
    };
  }
}
