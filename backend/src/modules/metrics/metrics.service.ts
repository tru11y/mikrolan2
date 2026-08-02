import { Injectable } from '@nestjs/common';
import { SessionStatus, VoucherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClientsQueryDto, MetricsQueryDto } from './dto/metrics.schemas';

export interface PlanBreakdown {
  planId: string;
  planName: string;
  priceXof: number;
  sold: number;
  revenueXof: number;
}

export interface RecentClient {
  voucherId: string;
  code: string;
  status: VoucherStatus;
  planName: string;
  priceXof: number;
  routerName: string;
  redeemedAt: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  online: boolean;
}

export interface MetricsSummary {
  period: MetricsQueryDto['period'];
  revenueXof: number;
  ticketsGenerated: number;
  ticketsUsed: number;
  activeSessions: number;
  previousRevenueXof: number;
  trendPct: number | null; // vs période précédente ; null si aucune vente avant
  byPlan: PlanBreakdown[];
}

// A LOCAL router's Session rows only get reconciled when the app polls it
// over the LAN (no server→router push possible on a private network) — a
// client who left can stay `status: ACTIVE` in DB until the next poll. Past
// this window we no longer call it "online", regardless of the DB status.
const ONLINE_FRESHNESS_MS = 3 * 60 * 1000;

function periodStart(period: MetricsQueryDto['period']): Date {
  const now = new Date();
  if (period === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const days = period === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sales dashboard for the current tenant. Revenue is booked per voucher
   * that has actually been redeemed (ACTIVE or USED) in the window — a
   * GENERATED voucher is a printed code that may never sell, so it does not
   * count as revenue until a client connects with it. All reads go through
   * tenant-scoped Prisma actions (findMany/count), never groupBy — the
   * isolation middleware does not scope groupBy.
   */
  async summary(query: MetricsQueryDto): Promise<MetricsSummary> {
    const start = periodStart(query.period);
    const routerFilter = query.routerId ? { routerId: query.routerId } : {};

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        createdAt: { gte: start },
        status: { not: VoucherStatus.REVOKED },
        ...routerFilter,
      },
      select: {
        status: true,
        plan: { select: { id: true, name: true, priceXof: true } },
      },
    });

    const activeSessions = await this.prisma.session.count({
      where: { status: SessionStatus.ACTIVE, ...routerFilter },
    });

    // Previous window of equal length, for the trend badge (« +24% vs … »).
    const windowMs = Date.now() - start.getTime();
    const prevStart = new Date(start.getTime() - windowMs);
    const prevVouchers = await this.prisma.voucher.findMany({
      where: {
        createdAt: { gte: prevStart, lt: start },
        status: { not: VoucherStatus.REVOKED },
        ...routerFilter,
      },
      select: { status: true, plan: { select: { priceXof: true } } },
    });
    const isRedeemed = (status: VoucherStatus) =>
      status === VoucherStatus.USED || status === VoucherStatus.ACTIVE;

    const previousRevenueXof = prevVouchers
      .filter((v) => isRedeemed(v.status))
      .reduce((sum, v) => sum + v.plan.priceXof, 0);

    const byPlanMap = new Map<string, PlanBreakdown>();
    let revenueXof = 0;
    let ticketsUsed = 0;

    for (const v of vouchers) {
      // Only redeemed vouchers are sales — a plan with nothing sold has no
      // place in the breakdown (it would draw an empty bar).
      if (!isRedeemed(v.status)) continue;

      revenueXof += v.plan.priceXof;
      ticketsUsed += 1;

      const entry = byPlanMap.get(v.plan.id) ?? {
        planId: v.plan.id,
        planName: v.plan.name,
        priceXof: v.plan.priceXof,
        sold: 0,
        revenueXof: 0,
      };
      entry.sold += 1;
      entry.revenueXof += v.plan.priceXof;
      byPlanMap.set(v.plan.id, entry);
    }

    return {
      period: query.period,
      revenueXof,
      ticketsGenerated: vouchers.length,
      ticketsUsed,
      activeSessions,
      previousRevenueXof,
      trendPct:
        previousRevenueXof > 0
          ? Math.round(
              ((revenueXof - previousRevenueXof) / previousRevenueXof) * 100,
            )
          : null,
      byPlan: [...byPlanMap.values()].sort((a, b) => b.revenueXof - a.revenueXof),
    };
  }

  /**
   * Recent clients = redeemed vouchers (USED/ACTIVE) with their live session
   * data, derived from existing rows (no customer entity). Tenant-scoped via
   * findMany.
   */
  async recentClients(query: ClientsQueryDto): Promise<RecentClient[]> {
    const vouchers = await this.prisma.voucher.findMany({
      where: {
        status: { in: [VoucherStatus.USED, VoucherStatus.ACTIVE] },
        ...(query.routerId ? { routerId: query.routerId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: query.limit,
      select: {
        id: true,
        code: true,
        status: true,
        usedAt: true,
        plan: { select: { name: true, priceXof: true } },
        router: { select: { identity: true, alias: true } },
        session: {
          select: {
            macAddress: true,
            ipAddress: true,
            status: true,
            lastSeenAt: true,
            startedAt: true,
          },
        },
      },
    });

    const now = Date.now();
    return vouchers.map((v) => {
      const seenAt = v.session?.lastSeenAt ?? v.session?.startedAt ?? null;
      const fresh = !!seenAt && now - seenAt.getTime() <= ONLINE_FRESHNESS_MS;
      return {
        voucherId: v.id,
        code: v.code,
        status: v.status,
        planName: v.plan.name,
        priceXof: v.plan.priceXof,
        routerName: v.router.alias || v.router.identity,
        redeemedAt: v.usedAt ? v.usedAt.toISOString() : null,
        macAddress: v.session?.macAddress ?? null,
        ipAddress: v.session?.ipAddress ?? null,
        online: v.session?.status === SessionStatus.ACTIVE && fresh,
      };
    });
  }
}
