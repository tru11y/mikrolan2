import { Injectable } from '@nestjs/common';
import { SessionStatus, VoucherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RevenueService, type RevenueDataQuality } from '../revenue/revenue.service';
import { getTenantContext } from '../../common/context/tenant-context';
import type { ClientsQueryDto, MetricsQueryDto } from './dto/metrics.schemas';

export interface PlanBreakdown {
  planId: string;
  planName: string;
  priceXof: number;
  sold: number;
  revenueXof: number;
  // Qualité du revenu — ajoutés audit/55 (défaut confirmé audit/54 §7 :
  // ces indicateurs existaient déjà côté RevenueService mais n'étaient
  // jamais exposés). Un ancien client mobile qui ignore ces champs continue
  // de fonctionner (aucun champ existant retiré/renommé).
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
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
  // Qualité du revenu (audit/55, corrige audit/54 §7) — champs additifs,
  // aucun champ ci-dessus n'est retiré ni renommé. Un client mobile qui ne
  // les lit pas encore continue de fonctionner à l'identique.
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueService,
  ) {}

  /**
   * Sales dashboard for the current tenant. Revenue now flows exclusively
   * through RevenueService (audit/51, audit/52) — the canonical rule is
   * usedAt-based, never createdAt. `ticketsGenerated` remains a distinct,
   * createdAt-scoped funnel metric ("how many codes were printed in this
   * window", not a revenue figure) and keeps its own definition.
   */
  async summary(query: MetricsQueryDto): Promise<MetricsSummary> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');

    const start = periodStart(query.period);
    const routerFilter = query.routerId ? { routerId: query.routerId } : {};

    const ticketsGenerated = await this.prisma.voucher.count({
      where: {
        createdAt: { gte: start },
        status: { not: VoucherStatus.REVOKED },
        ...routerFilter,
      },
    });

    const activeSessions = await this.prisma.session.count({
      where: { status: SessionStatus.ACTIVE, ...routerFilter },
    });

    const now = new Date();
    const windowMs = now.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - windowMs);

    const revenueQuery = {
      tenantId: ctx.tenantId,
      from: start,
      to: now,
      routerId: query.routerId,
    };
    const [current, previous, byPlan] = await Promise.all([
      this.revenue.computeRevenue(revenueQuery),
      this.revenue.computeRevenue({ ...revenueQuery, from: prevStart, to: start }),
      this.revenue.revenueByPlan(revenueQuery),
    ]);

    return {
      period: query.period,
      revenueXof: current.revenueXof,
      ticketsGenerated,
      ticketsUsed: current.valuedSalesCount,
      activeSessions,
      previousRevenueXof: previous.revenueXof,
      trendPct:
        previous.revenueXof > 0
          ? Math.round(
              ((current.revenueXof - previous.revenueXof) / previous.revenueXof) * 100,
            )
          : null,
      byPlan: byPlan.map((p) => ({
        planId: p.planId,
        planName: p.planName,
        priceXof: p.sold > 0 ? Math.round(p.revenueXof / p.sold) : 0,
        sold: p.sold,
        revenueXof: p.revenueXof,
        exactRevenueXof: p.exactRevenueXof,
        estimatedRevenueXof: p.estimatedRevenueXof,
        unknownSalesCount: p.unknownSalesCount,
        invalidSourceCount: p.invalidSourceCount,
        dataQuality: p.dataQuality,
      })),
      exactRevenueXof: current.exactRevenueXof,
      estimatedRevenueXof: current.estimatedRevenueXof,
      unknownSalesCount: current.unknownSalesCount,
      invalidSourceCount: current.invalidSourceCount,
      dataQuality: current.dataQuality,
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
