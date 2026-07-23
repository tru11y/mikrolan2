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
  byPlan: PlanBreakdown[];
}

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
   * Sales dashboard for the current tenant. Revenue is booked per non-revoked
   * voucher generated in the window (the operator prints and sells prepaid
   * codes). All reads go through tenant-scoped Prisma actions (findMany/count),
   * never groupBy — the isolation middleware does not scope groupBy.
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

    const byPlanMap = new Map<string, PlanBreakdown>();
    let revenueXof = 0;
    let ticketsUsed = 0;

    for (const v of vouchers) {
      revenueXof += v.plan.priceXof;
      if (v.status === VoucherStatus.USED || v.status === VoucherStatus.ACTIVE) {
        ticketsUsed += 1;
      }
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
          select: { macAddress: true, ipAddress: true, status: true },
        },
      },
    });

    return vouchers.map((v) => ({
      voucherId: v.id,
      code: v.code,
      status: v.status,
      planName: v.plan.name,
      priceXof: v.plan.priceXof,
      routerName: v.router.alias || v.router.identity,
      redeemedAt: v.usedAt ? v.usedAt.toISOString() : null,
      macAddress: v.session?.macAddress ?? null,
      ipAddress: v.session?.ipAddress ?? null,
      online: v.session?.status === SessionStatus.ACTIVE,
    }));
  }
}
