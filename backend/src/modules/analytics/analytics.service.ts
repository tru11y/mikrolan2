import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../common/context/tenant-context';
import {
  RevenueService,
  type ActivationLine,
  type RevenueDataQuality,
} from '../revenue/revenue.service';
import { resolveTenantTimezone } from '../revenue/timezone.util';
import {
  resolveNamedPeriod,
  previousPeriodOf,
  growthPercent,
  contributionPercent,
  localDayOfWeekAndHour,
  type NamedPeriod,
} from './period.util';

/**
 * Module Analytics/BI — audit/67. Source canonique unique du chiffre
 * d'affaires : RevenueService (jamais de recalcul indépendant depuis
 * Plan.priceXof, jamais Invoice, jamais createdAt — voir revenue.service.ts).
 * Ce service se contente de regrouper/agréger les `ActivationLine[]` déjà
 * classifiées par RevenueService, comme AccountingService le fait déjà.
 */

interface PeriodFilters {
  period: NamedPeriod;
  from?: string;
  to?: string;
  routerId?: string;
  planId?: string;
}

interface Bounds {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
}

export interface QualitySummary {
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
}

export interface RouterSummaryItem {
  routerId: string;
  routerName: string;
  revenueXof: number;
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  salesCount: number;
  averageSaleXof: number;
  contributionPercent: number;
  growthPercent: number | null;
  dataQuality: RevenueDataQuality;
}

export interface PlanPerformanceItem {
  planId: string;
  name: string;
  salesCount: number;
  revenueXof: number;
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  revenueContributionPercent: number;
  salesContributionPercent: number;
  averageSaleXof: number;
  routerCount: number;
  growthPercent: number | null;
  dataQuality: RevenueDataQuality;
}

export interface HeatmapCell {
  dayOfWeek: number; // 0=lundi..6=dimanche
  hour: number; // 0-23
  count: number;
  revenueXof?: number; // uniquement salesHeatmap
}

export interface SessionStatsResult {
  totalSessions: number;
  activeSessions: number;
  terminatedSessions: number;
  averageDurationMinutes: number | null;
  totalBytesIn: string;
  totalBytesOut: string;
  totalBytes: string;
  byRouter: {
    routerId: string;
    routerName: string;
    sessionCount: number;
    activeSessions: number;
    averageDurationMinutes: number | null;
    bytesIn: string;
    bytesOut: string;
  }[];
  byPlan: {
    planId: string;
    planName: string;
    sessionCount: number;
    averageDurationMinutes: number | null;
    bytesIn: string;
    bytesOut: string;
  }[];
}

export interface OverviewResult {
  period: { from: string; to: string };
  timezone: string;
  revenueXof: number;
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  salesCount: number;
  averageSaleXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
  previousPeriod: { from: string; to: string };
  revenueGrowthPercent: number | null;
  salesGrowthPercent: number | null;
  routersSummary: RouterSummaryItem[];
  topPlans: PlanPerformanceItem[];
  lastCalculatedAt: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueService,
  ) {}

  private async resolveBounds(filters: PeriodFilters): Promise<{ bounds: Bounds; timezone: string }> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { timezone: true },
    });
    const timezone = resolveTenantTimezone(tenant?.timezone);

    if (filters.period === 'custom') {
      if (!filters.from || !filters.to) {
        throw new BadRequestException('from et to sont requis en period=custom');
      }
      const from = new Date(filters.from);
      const to = new Date(filters.to);
      const { previousFrom, previousTo } = previousPeriodOf(from, to);
      return { bounds: { from, to, previousFrom, previousTo }, timezone };
    }

    return { bounds: resolveNamedPeriod(filters.period, timezone), timezone };
  }

  private async assertRouterInTenant(tenantId: string, routerId: string): Promise<void> {
    const router = await this.prisma.router.findFirst({
      where: { tenantId, id: routerId },
      select: { id: true },
    });
    if (!router) throw new BadRequestException("Routeur introuvable pour ce tenant");
  }

  private async assertPlanInTenant(tenantId: string, planId: string): Promise<void> {
    const plan = await this.prisma.plan.findFirst({
      where: { tenantId, id: planId },
      select: { id: true },
    });
    if (!plan) throw new BadRequestException('Forfait introuvable pour ce tenant');
  }

  private summarize(lines: ActivationLine[]): QualitySummary & { salesCount: number; averageSaleXof: number; revenueXof: number } {
    const q = this.revenue.summarizeQuality(lines);
    const revenueXof = q.exactRevenueXof + q.estimatedRevenueXof;
    const valuedCount = lines.filter((l) => l.xof !== null).length;
    return {
      ...q,
      revenueXof,
      salesCount: lines.length,
      averageSaleXof: valuedCount > 0 ? Math.round(revenueXof / valuedCount) : 0,
    };
  }

  async overview(query: PeriodFilters): Promise<OverviewResult> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    if (query.routerId) await this.assertRouterInTenant(ctx.tenantId, query.routerId);
    if (query.planId) await this.assertPlanInTenant(ctx.tenantId, query.planId);

    const { bounds, timezone } = await this.resolveBounds(query);

    const [currentLines, previousLines, byPlan, routers] = await Promise.all([
      this.revenue.listActivations({
        tenantId: ctx.tenantId,
        from: bounds.from,
        to: bounds.to,
        routerId: query.routerId,
        planId: query.planId,
      }),
      this.revenue.listActivations({
        tenantId: ctx.tenantId,
        from: bounds.previousFrom,
        to: bounds.previousTo,
        routerId: query.routerId,
        planId: query.planId,
      }),
      this.revenue.revenueByPlan({
        tenantId: ctx.tenantId,
        from: bounds.from,
        to: bounds.to,
        routerId: query.routerId,
        planId: query.planId,
      }),
      this.prisma.router.findMany({
        where: { tenantId: ctx.tenantId, ...(query.routerId ? { id: query.routerId } : {}) },
        select: { id: true, identity: true, alias: true },
      }),
    ]);

    const current = this.summarize(currentLines);
    const previous = this.summarize(previousLines);

    const routerNameById = new Map(routers.map((r) => [r.id, r.alias || r.identity]));
    const byRouter = new Map<string, ActivationLine[]>();
    for (const line of currentLines) {
      const arr = byRouter.get(line.routerId) ?? [];
      arr.push(line);
      byRouter.set(line.routerId, arr);
    }
    const byRouterPrev = new Map<string, ActivationLine[]>();
    for (const line of previousLines) {
      const arr = byRouterPrev.get(line.routerId) ?? [];
      arr.push(line);
      byRouterPrev.set(line.routerId, arr);
    }

    const routersSummary: RouterSummaryItem[] = [...byRouter.entries()]
      .map(([routerId, lines]) => {
        const s = this.summarize(lines);
        const prevRevenue = byRouterPrev.has(routerId)
          ? this.summarize(byRouterPrev.get(routerId)!).revenueXof
          : null;
        return {
          routerId,
          routerName: routerNameById.get(routerId) ?? routerId,
          revenueXof: s.revenueXof,
          exactRevenueXof: s.exactRevenueXof,
          estimatedRevenueXof: s.estimatedRevenueXof,
          salesCount: s.salesCount,
          averageSaleXof: s.averageSaleXof,
          contributionPercent: contributionPercent(s.revenueXof, current.revenueXof),
          growthPercent: growthPercent(s.revenueXof, prevRevenue),
          dataQuality: s.dataQuality,
        };
      })
      .sort((a, b) => b.revenueXof - a.revenueXof);

    const topPlans: PlanPerformanceItem[] = byPlan.slice(0, 5).map((p) => ({
      planId: p.planId,
      name: p.planName,
      salesCount: p.sold,
      revenueXof: p.revenueXof,
      exactRevenueXof: p.exactRevenueXof,
      estimatedRevenueXof: p.estimatedRevenueXof,
      revenueContributionPercent: contributionPercent(p.revenueXof, current.revenueXof),
      salesContributionPercent: contributionPercent(p.sold, current.salesCount),
      averageSaleXof: p.sold > 0 ? Math.round(p.revenueXof / p.sold) : 0,
      routerCount: 1,
      growthPercent: null,
      dataQuality: p.dataQuality,
    }));

    return {
      period: { from: bounds.from.toISOString(), to: bounds.to.toISOString() },
      timezone,
      revenueXof: current.revenueXof,
      exactRevenueXof: current.exactRevenueXof,
      estimatedRevenueXof: current.estimatedRevenueXof,
      salesCount: current.salesCount,
      averageSaleXof: current.averageSaleXof,
      unknownSalesCount: current.unknownSalesCount,
      invalidSourceCount: current.invalidSourceCount,
      dataQuality: current.dataQuality,
      previousPeriod: { from: bounds.previousFrom.toISOString(), to: bounds.previousTo.toISOString() },
      revenueGrowthPercent: growthPercent(current.revenueXof, previous.revenueXof),
      salesGrowthPercent: growthPercent(current.salesCount, previous.salesCount),
      routersSummary,
      topPlans,
      lastCalculatedAt: new Date().toISOString(),
    };
  }

  async routers(query: PeriodFilters): Promise<RouterSummaryItem[]> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    const { bounds } = await this.resolveBounds(query);

    const [currentLines, previousLines, routers] = await Promise.all([
      this.revenue.listActivations({ tenantId: ctx.tenantId, from: bounds.from, to: bounds.to }),
      this.revenue.listActivations({
        tenantId: ctx.tenantId,
        from: bounds.previousFrom,
        to: bounds.previousTo,
      }),
      this.prisma.router.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, identity: true, alias: true } }),
    ]);

    const totalRevenue = this.summarize(currentLines).revenueXof;
    const routerNameById = new Map(routers.map((r) => [r.id, r.alias || r.identity]));

    const byRouter = new Map<string, ActivationLine[]>();
    for (const line of currentLines) {
      const arr = byRouter.get(line.routerId) ?? [];
      arr.push(line);
      byRouter.set(line.routerId, arr);
    }
    const byRouterPrev = new Map<string, ActivationLine[]>();
    for (const line of previousLines) {
      const arr = byRouterPrev.get(line.routerId) ?? [];
      arr.push(line);
      byRouterPrev.set(line.routerId, arr);
    }

    return routers
      .map((r) => {
        const lines = byRouter.get(r.id) ?? [];
        const s = this.summarize(lines);
        const prevRevenue = byRouterPrev.has(r.id) ? this.summarize(byRouterPrev.get(r.id)!).revenueXof : null;
        return {
          routerId: r.id,
          routerName: r.alias || r.identity,
          revenueXof: s.revenueXof,
          exactRevenueXof: s.exactRevenueXof,
          estimatedRevenueXof: s.estimatedRevenueXof,
          salesCount: s.salesCount,
          averageSaleXof: s.averageSaleXof,
          contributionPercent: contributionPercent(s.revenueXof, totalRevenue),
          growthPercent: growthPercent(s.revenueXof, prevRevenue),
          dataQuality: s.dataQuality,
        };
      })
      .sort((a, b) => b.revenueXof - a.revenueXof);
  }

  async routerDetail(routerId: string, query: PeriodFilters) {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    await this.assertRouterInTenant(ctx.tenantId, routerId);

    const { bounds, timezone } = await this.resolveBounds(query);

    const [router, currentLines, previousLines, byPlan, allRouterLines, sessions] = await Promise.all([
      this.prisma.router.findFirst({
        where: { tenantId: ctx.tenantId, id: routerId },
        select: { id: true, identity: true, alias: true, health: true },
      }),
      this.revenue.listActivations({ tenantId: ctx.tenantId, from: bounds.from, to: bounds.to, routerId }),
      this.revenue.listActivations({
        tenantId: ctx.tenantId,
        from: bounds.previousFrom,
        to: bounds.previousTo,
        routerId,
      }),
      this.revenue.revenueByPlan({ tenantId: ctx.tenantId, from: bounds.from, to: bounds.to, routerId }),
      this.revenue.listActivations({ tenantId: ctx.tenantId, from: bounds.from, to: bounds.to }),
      this.prisma.session.findMany({
        where: { tenantId: ctx.tenantId, routerId, startedAt: { gte: bounds.from, lt: bounds.to } },
        select: { startedAt: true },
      }),
    ]);
    if (!router) throw new BadRequestException('Routeur introuvable pour ce tenant');

    const current = this.summarize(currentLines);
    const previous = this.summarize(previousLines);

    // Comparaison à la moyenne des routeurs du tenant sur la même période.
    const byRouter = new Map<string, ActivationLine[]>();
    for (const line of allRouterLines) {
      const arr = byRouter.get(line.routerId) ?? [];
      arr.push(line);
      byRouter.set(line.routerId, arr);
    }
    const routerCount = byRouter.size || 1;
    const totalRevenueAll = allRouterLines.reduce((s, l) => s + (l.xof ?? 0), 0);
    const averageRouterRevenueXof = Math.round(totalRevenueAll / routerCount);

    // Série temporelle quotidienne (jour local du tenant).
    const dailyMap = new Map<string, { revenueXof: number; salesCount: number }>();
    for (const line of currentLines) {
      const { dayOfWeek } = localDayOfWeekAndHour(line.usedAt, timezone);
      const dateKey = line.usedAt.toISOString().slice(0, 10);
      const entry = dailyMap.get(dateKey) ?? { revenueXof: 0, salesCount: 0 };
      entry.revenueXof += line.xof ?? 0;
      entry.salesCount += 1;
      dailyMap.set(dateKey, entry);
      void dayOfWeek;
    }
    const timeSeries = [...dailyMap.entries()]
      .map(([date, v]) => ({ date, revenueXof: v.revenueXof, salesCount: v.salesCount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Affluence commerciale (ventes) et affluence sessions, séparées.
    const salesHeatmap = buildHeatmap(currentLines.map((l) => ({ at: l.usedAt, xof: l.xof ?? 0 })), timezone, true);
    const sessionsHeatmap = buildHeatmap(sessions.map((s) => ({ at: s.startedAt, xof: 0 })), timezone, false);

    return {
      routerId: router.id,
      routerName: router.alias || router.identity,
      health: router.health,
      period: { from: bounds.from.toISOString(), to: bounds.to.toISOString() },
      timezone,
      revenueXof: current.revenueXof,
      exactRevenueXof: current.exactRevenueXof,
      estimatedRevenueXof: current.estimatedRevenueXof,
      salesCount: current.salesCount,
      averageSaleXof: current.averageSaleXof,
      unknownSalesCount: current.unknownSalesCount,
      invalidSourceCount: current.invalidSourceCount,
      dataQuality: current.dataQuality,
      contributionPercent: contributionPercent(current.revenueXof, totalRevenueAll),
      growthPercent: growthPercent(current.revenueXof, previous.revenueXof),
      plans: byPlan.map((p) => ({
        planId: p.planId,
        name: p.planName,
        salesCount: p.sold,
        revenueXof: p.revenueXof,
        exactRevenueXof: p.exactRevenueXof,
        estimatedRevenueXof: p.estimatedRevenueXof,
        dataQuality: p.dataQuality,
      })),
      timeSeries,
      salesHeatmap,
      sessionsHeatmap,
      sessionsCount: sessions.length,
      comparisonToTenantAverage: {
        averageRouterRevenueXof,
        deltaPercent: growthPercent(current.revenueXof, averageRouterRevenueXof),
      },
      lastCalculatedAt: new Date().toISOString(),
    };
  }

  async plans(query: PeriodFilters): Promise<PlanPerformanceItem[]> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    if (query.routerId) await this.assertRouterInTenant(ctx.tenantId, query.routerId);
    const { bounds } = await this.resolveBounds(query);

    const [byPlan, prevByPlan] = await Promise.all([
      this.revenue.revenueByPlan({
        tenantId: ctx.tenantId,
        from: bounds.from,
        to: bounds.to,
        routerId: query.routerId,
      }),
      this.revenue.revenueByPlan({
        tenantId: ctx.tenantId,
        from: bounds.previousFrom,
        to: bounds.previousTo,
        routerId: query.routerId,
      }),
    ]);

    const totalRevenue = byPlan.reduce((s, p) => s + p.revenueXof, 0);
    const totalSales = byPlan.reduce((s, p) => s + p.sold, 0);
    const prevByPlanId = new Map(prevByPlan.map((p) => [p.planId, p.sold]));

    return byPlan
      .map((p) => ({
        planId: p.planId,
        name: p.planName,
        salesCount: p.sold,
        revenueXof: p.revenueXof,
        exactRevenueXof: p.exactRevenueXof,
        estimatedRevenueXof: p.estimatedRevenueXof,
        revenueContributionPercent: contributionPercent(p.revenueXof, totalRevenue),
        salesContributionPercent: contributionPercent(p.sold, totalSales),
        averageSaleXof: p.sold > 0 ? Math.round(p.revenueXof / p.sold) : 0,
        routerCount: 1,
        growthPercent: growthPercent(p.sold, prevByPlanId.get(p.planId) ?? null),
        dataQuality: p.dataQuality,
      }))
      .sort((a, b) => b.revenueXof - a.revenueXof);
  }

  async sessionStats(query: PeriodFilters): Promise<SessionStatsResult> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    if (query.routerId) await this.assertRouterInTenant(ctx.tenantId, query.routerId);

    const { bounds } = await this.resolveBounds(query);

    const sessions = await this.prisma.session.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(query.routerId ? { routerId: query.routerId } : {}),
        startedAt: { gte: bounds.from, lt: bounds.to },
      },
      select: {
        routerId: true,
        status: true,
        bytesIn: true,
        bytesOut: true,
        startedAt: true,
        terminatedAt: true,
        voucher: { select: { planId: true, plan: { select: { name: true } } } },
        router: { select: { identity: true, alias: true } },
      },
    });

    let totalBytesIn = BigInt(0);
    let totalBytesOut = BigInt(0);
    let activeSessions = 0;
    let terminatedSessions = 0;
    let totalDurationMs = 0;
    let durationCount = 0;

    const routerMap = new Map<string, { name: string; count: number; active: number; durationMs: number; durationCount: number; bytesIn: bigint; bytesOut: bigint }>();
    const planMap = new Map<string, { name: string; count: number; durationMs: number; durationCount: number; bytesIn: bigint; bytesOut: bigint }>();

    for (const s of sessions) {
      totalBytesIn += s.bytesIn;
      totalBytesOut += s.bytesOut;

      if (s.status === 'ACTIVE') activeSessions++;
      else terminatedSessions++;

      if (s.terminatedAt) {
        const dur = s.terminatedAt.getTime() - s.startedAt.getTime();
        totalDurationMs += dur;
        durationCount++;
      }

      // Router aggregation
      const re = routerMap.get(s.routerId) ?? { name: s.router.alias || s.router.identity, count: 0, active: 0, durationMs: 0, durationCount: 0, bytesIn: BigInt(0), bytesOut: BigInt(0) };
      re.count++;
      if (s.status === 'ACTIVE') re.active++;
      if (s.terminatedAt) { re.durationMs += s.terminatedAt.getTime() - s.startedAt.getTime(); re.durationCount++; }
      re.bytesIn += s.bytesIn;
      re.bytesOut += s.bytesOut;
      routerMap.set(s.routerId, re);

      // Plan aggregation
      if (s.voucher?.planId) {
        const pe = planMap.get(s.voucher.planId) ?? { name: s.voucher.plan?.name ?? '', count: 0, durationMs: 0, durationCount: 0, bytesIn: BigInt(0), bytesOut: BigInt(0) };
        pe.count++;
        if (s.terminatedAt) { pe.durationMs += s.terminatedAt.getTime() - s.startedAt.getTime(); pe.durationCount++; }
        pe.bytesIn += s.bytesIn;
        pe.bytesOut += s.bytesOut;
        planMap.set(s.voucher.planId, pe);
      }
    }

    return {
      totalSessions: sessions.length,
      activeSessions,
      terminatedSessions,
      averageDurationMinutes: durationCount > 0 ? Math.round(totalDurationMs / durationCount / 60000) : null,
      totalBytesIn: totalBytesIn.toString(),
      totalBytesOut: totalBytesOut.toString(),
      totalBytes: (totalBytesIn + totalBytesOut).toString(),
      byRouter: [...routerMap.entries()]
        .map(([routerId, r]) => ({
          routerId,
          routerName: r.name,
          sessionCount: r.count,
          activeSessions: r.active,
          averageDurationMinutes: r.durationCount > 0 ? Math.round(r.durationMs / r.durationCount / 60000) : null,
          bytesIn: r.bytesIn.toString(),
          bytesOut: r.bytesOut.toString(),
        }))
        .sort((a, b) => b.sessionCount - a.sessionCount),
      byPlan: [...planMap.entries()]
        .map(([planId, p]) => ({
          planId,
          planName: p.name,
          sessionCount: p.count,
          averageDurationMinutes: p.durationCount > 0 ? Math.round(p.durationMs / p.durationCount / 60000) : null,
          bytesIn: p.bytesIn.toString(),
          bytesOut: p.bytesOut.toString(),
        }))
        .sort((a, b) => b.sessionCount - a.sessionCount),
    };
  }

  async traffic(query: PeriodFilters) {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    if (query.routerId) await this.assertRouterInTenant(ctx.tenantId, query.routerId);
    const { bounds, timezone } = await this.resolveBounds(query);

    const [lines, sessions] = await Promise.all([
      this.revenue.listActivations({
        tenantId: ctx.tenantId,
        from: bounds.from,
        to: bounds.to,
        routerId: query.routerId,
      }),
      this.prisma.session.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(query.routerId ? { routerId: query.routerId } : {}),
          startedAt: { gte: bounds.from, lt: bounds.to },
        },
        select: { startedAt: true },
      }),
    ]);

    return {
      period: { from: bounds.from.toISOString(), to: bounds.to.toISOString() },
      timezone,
      salesHeatmap: buildHeatmap(lines.map((l) => ({ at: l.usedAt, xof: l.xof ?? 0 })), timezone, true),
      sessionsHeatmap: buildHeatmap(sessions.map((s) => ({ at: s.startedAt, xof: 0 })), timezone, false),
    };
  }
}

function buildHeatmap(
  points: { at: Date; xof: number }[],
  timezone: string,
  includeRevenue: boolean,
): HeatmapCell[] {
  const grid = new Map<string, { count: number; revenueXof: number }>();
  for (const p of points) {
    const { dayOfWeek, hour } = localDayOfWeekAndHour(p.at, timezone);
    const key = `${dayOfWeek}-${hour}`;
    const cell = grid.get(key) ?? { count: 0, revenueXof: 0 };
    cell.count += 1;
    cell.revenueXof += p.xof;
    grid.set(key, cell);
  }
  const cells: HeatmapCell[] = [];
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      const cell = grid.get(`${d}-${h}`);
      cells.push({
        dayOfWeek: d,
        hour: h,
        count: cell?.count ?? 0,
        ...(includeRevenue ? { revenueXof: cell?.revenueXof ?? 0 } : {}),
      });
    }
  }
  return cells;
}
