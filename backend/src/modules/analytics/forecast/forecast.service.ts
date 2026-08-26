import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getTenantContext } from '../../../common/context/tenant-context';
import { RevenueService, type ActivationLine } from '../../revenue/revenue.service';
import { resolveTenantTimezone, startOfLocalDayUtc } from '../../revenue/timezone.util';
import { localDayOfWeekAndHour } from '../period.util';
import { AnalyticsService } from '../analytics.service';
import { FORECAST_MAX_HISTORY_DAYS, FORECAST_THRESHOLDS, FORECAST_VALIDATION_DAYS } from './forecast.constants';
import { buildDailyRevenueSeries, countActiveDays, localDateKey } from './forecast.series';
import { runModel, clampNonNegative } from './forecast.models';
import { backtestAndSelect } from './forecast.validation';
import { computeConfidence } from './forecast.confidence';
import {
  insightHighRevenueContribution,
  insightHighVolumeContribution,
  insightMostActiveDay,
  insightMostActiveHour,
  insightPlanVolumeVsContributionMismatch,
  insightRouterMajorShare,
  insightTrend,
  insightInsufficientData,
  type Insight,
} from './forecast.insights';
import { DAY_LABELS_FR } from './forecast.labels';
import type {
  DailySeriesPoint,
  ForecastConfidence,
  ForecastPoint,
  ForecastResult,
} from './forecast.types';

export interface ForecastQuery {
  horizonDays: number;
  routerId?: string;
  planId?: string;
}

export interface TrafficForecastResult {
  salesPeakDays: { dayOfWeek: number; averageCount: number }[];
  salesPeakHours: { hour: number; averageCount: number }[];
  sessionsPeakDays: { dayOfWeek: number; averageCount: number }[];
  sessionsPeakHours: { hour: number; averageCount: number }[];
  confidence: ForecastConfidence;
  historyCoverageDays: number;
  insufficientDataReason: string | null;
  calculatedAt: string;
}

export interface RouterForecastItem {
  routerId: string;
  routerName: string;
  currentTrend: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
  expectedDirection: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
  forecastRevenueXof: number | null;
  forecastSalesCount: number | null;
  confidence: ForecastConfidence;
  warning: string | null;
}

export interface PlanForecastItem {
  planId: string;
  name: string;
  salesTrend: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
  revenueTrend: 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN';
  expectedDemand: number | null;
  confidence: ForecastConfidence;
  warning: string | null;
}

@Injectable()
export class ForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Insights métier déterministes — réutilise exclusivement les résultats
   * déjà calculés par AnalyticsService (overview/routers/plans/traffic),
   * jamais un recalcul indépendant du revenu.
   */
  async insights(): Promise<Insight[]> {
    const [overview, routers, plans, traffic] = await Promise.all([
      this.analytics.overview({ period: 'last30days' }),
      this.analytics.routers({ period: 'last30days' }),
      this.analytics.plans({ period: 'last30days' }),
      this.analytics.traffic({ period: 'last30days' }),
    ]);
    const period = overview.period;
    const insights: Insight[] = [];

    if (overview.dataQuality === 'NO_DATA' || overview.salesCount === 0) {
      insights.push(insightInsufficientData('Vue d\'ensemble', "Aucune vente sur les 30 derniers jours — pas assez de données pour produire des insights.", period));
      return insights;
    }

    for (const r of routers) {
      const rev = insightHighRevenueContribution(r.routerName, r.contributionPercent, period);
      if (rev) insights.push(rev);
      const major = insightRouterMajorShare(r.routerName, r.contributionPercent, period);
      if (major && !rev) insights.push(major);
      if (r.growthPercent !== null) {
        const trend = insightTrend(r.routerName, r.growthPercent, period, r.dataQuality === 'EXACT' ? 'HIGH' : 'MEDIUM');
        if (trend) insights.push(trend);
      }
    }

    for (const p of plans) {
      const rev = insightHighRevenueContribution(p.name, p.revenueContributionPercent, period);
      if (rev) insights.push(rev);
      const vol = insightHighVolumeContribution(p.name, p.salesContributionPercent, period);
      if (vol) insights.push(vol);
      const mismatch = insightPlanVolumeVsContributionMismatch(p.name, p.salesContributionPercent, p.revenueContributionPercent, period);
      if (mismatch) insights.push(mismatch);
    }

    const busiestSalesDay = [...traffic.salesHeatmap].sort((a, b) => b.count - a.count)[0];
    if (busiestSalesDay && busiestSalesDay.count > 0) {
      insights.push(insightMostActiveDay(DAY_LABELS_FR[busiestSalesDay.dayOfWeek], busiestSalesDay.count, period, 'MEDIUM'));
    }
    const hourTotals = new Array(24).fill(0);
    for (const cell of traffic.salesHeatmap) hourTotals[cell.hour] += cell.count;
    const busiestHourIndex = hourTotals.reduce((best, v, i) => (v > hourTotals[best] ? i : best), 0);
    if (hourTotals[busiestHourIndex] > 0) {
      insights.push(insightMostActiveHour(busiestHourIndex, hourTotals[busiestHourIndex], period, 'MEDIUM'));
    }

    if (insights.length === 0) {
      insights.push(insightInsufficientData('Insights', 'Aucun signal suffisamment marqué sur la période observée.', period));
    }
    return insights;
  }

  private async resolveHistoryWindow(): Promise<{ from: Date; to: Date; timezone: string }> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } });
    const timezone = resolveTenantTimezone(tenant?.timezone);
    // Exclut le jour en cours (partiel) pour ne jamais entraîner sur une
    // journée incomplète — seul l'historique de jours pleins est utilisé.
    const to = startOfLocalDayUtc(new Date(), timezone);
    const from = new Date(to.getTime() - FORECAST_MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000);
    return { from, to, timezone };
  }

  private forecastMetric(
    series: DailySeriesPoint[],
    metric: 'revenueXof' | 'salesCount',
    horizonDays: number,
    valuedActivationsCount: number,
    to: Date,
    timezone: string,
  ): ForecastResult {
    const calendarDays = series.length;
    const activeDays = countActiveDays(series);
    const meetsThreshold =
      calendarDays >= FORECAST_THRESHOLDS.daily.minCalendarDays &&
      activeDays >= FORECAST_THRESHOLDS.daily.minActiveDays &&
      valuedActivationsCount >= FORECAST_THRESHOLDS.daily.minValuedActivations;

    const warnings: string[] = [];
    const calculatedAt = new Date().toISOString();
    const historyStart = series.length ? series[0].date : null;
    const historyEnd = series.length ? series[series.length - 1].date : null;

    if (!meetsThreshold) {
      warnings.push(
        `Historique insuffisant : ${calendarDays} jour(s) (min ${FORECAST_THRESHOLDS.daily.minCalendarDays}), ` +
          `${activeDays} jour(s) actif(s) (min ${FORECAST_THRESHOLDS.daily.minActiveDays}), ` +
          `${valuedActivationsCount} activation(s) valorisée(s) (min ${FORECAST_THRESHOLDS.daily.minValuedActivations}).`,
      );
      return {
        metric,
        points: [],
        model: 'NAIVE',
        confidence: 'INSUFFICIENT_DATA',
        historyStart,
        historyEnd,
        trainingPoints: calendarDays,
        validationMetric: null,
        modelComparison: [],
        calculatedAt,
        isForecast: true,
        warnings,
      };
    }

    const history = series.map((p) => p[metric]);
    const historyDayOfWeek = series.map((p) => p.dayOfWeek);
    const validationSize = Math.min(FORECAST_VALIDATION_DAYS, Math.max(1, Math.floor(history.length * 0.3)));
    const { metrics, bestModel } = backtestAndSelect(history, historyDayOfWeek, validationSize);
    const bestMetric = metrics.find((m) => m.model === bestModel)!;

    const targetDates: string[] = [];
    const targetDayOfWeek: number[] = [];
    const oneDayMs = 24 * 60 * 60 * 1000;
    for (let h = 0; h < horizonDays; h++) {
      const d = new Date(to.getTime() + h * oneDayMs);
      const key = localDateKey(d, timezone);
      targetDates.push(key);
      const { dayOfWeek } = localDayOfWeekAndHour(d, timezone);
      targetDayOfWeek.push(dayOfWeek);
    }

    const raw = runModel(bestModel, history, historyDayOfWeek, horizonDays, targetDayOfWeek);
    const clamped = clampNonNegative(raw);
    const spread = bestMetric.mae * 1.28; // ~80% d'intervalle sous hypothèse d'erreurs symétriques

    const points: ForecastPoint[] = targetDates.map((date, i) => {
      const predictedRaw = clamped[i];
      const predicted = metric === 'revenueXof' ? Math.round(predictedRaw) : Math.round(predictedRaw);
      const lowerBound = Math.max(0, Math.round(predictedRaw - spread));
      const upperBound = Math.max(predicted, Math.round(predictedRaw + spread));
      return { date, predicted, lowerBound, upperBound };
    });

    if (horizonDays > calendarDays) {
      warnings.push("Horizon demandé supérieur à l'historique disponible : fiabilité réduite.");
    }

    const confidence = computeConfidence({
      meetsThreshold: true,
      trainingPoints: calendarDays,
      minTrainingPoints: FORECAST_THRESHOLDS.daily.minActiveDays,
      activeRatio: activeDays / calendarDays,
      wape: bestMetric.wape,
      horizonDays,
      historyDays: calendarDays,
    });

    return {
      metric,
      points,
      model: bestModel,
      confidence,
      historyStart,
      historyEnd,
      trainingPoints: calendarDays,
      validationMetric: { mae: bestMetric.mae, wape: bestMetric.wape, bias: bestMetric.bias },
      modelComparison: metrics,
      calculatedAt,
      isForecast: true,
      warnings,
    };
  }

  async forecast(query: ForecastQuery): Promise<{
    revenueForecast: ForecastResult;
    salesForecast: ForecastResult;
    warnings: string[];
  }> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    if (query.routerId) await this.assertRouterInTenant(ctx.tenantId, query.routerId);
    if (query.planId) await this.assertPlanInTenant(ctx.tenantId, query.planId);

    const { from, to, timezone } = await this.resolveHistoryWindow();
    const lines = await this.revenue.listActivations({
      tenantId: ctx.tenantId,
      from,
      to,
      routerId: query.routerId,
      planId: query.planId,
    });
    const series = buildDailyRevenueSeries(lines, from, to, timezone);
    const valuedActivationsCount = lines.filter((l) => l.xof !== null).length;

    const revenueForecast = this.forecastMetric(series, 'revenueXof', query.horizonDays, valuedActivationsCount, to, timezone);
    const salesForecast = this.forecastMetric(series, 'salesCount', query.horizonDays, valuedActivationsCount, to, timezone);

    const warnings = [...new Set([...revenueForecast.warnings, ...salesForecast.warnings])];
    return { revenueForecast, salesForecast, warnings };
  }

  async forecastTraffic(routerId?: string): Promise<TrafficForecastResult> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    if (routerId) await this.assertRouterInTenant(ctx.tenantId, routerId);

    const { from, to, timezone } = await this.resolveHistoryWindow();
    const [lines, sessions] = await Promise.all([
      this.revenue.listActivations({ tenantId: ctx.tenantId, from, to, routerId }),
      this.prisma.session.findMany({
        where: { tenantId: ctx.tenantId, ...(routerId ? { routerId } : {}), startedAt: { gte: from, lt: to } },
        select: { startedAt: true },
      }),
    ]);

    const calendarDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
    const meetsThreshold = calendarDays >= FORECAST_THRESHOLDS.hourly.minCalendarDays && lines.length >= FORECAST_THRESHOLDS.hourly.minActivations;

    const calculatedAt = new Date().toISOString();
    if (!meetsThreshold) {
      return {
        salesPeakDays: [],
        salesPeakHours: [],
        sessionsPeakDays: [],
        sessionsPeakHours: [],
        confidence: 'INSUFFICIENT_DATA',
        historyCoverageDays: calendarDays,
        insufficientDataReason: `Historique insuffisant : ${calendarDays} jour(s) (min ${FORECAST_THRESHOLDS.hourly.minCalendarDays}), ${lines.length} vente(s) (min ${FORECAST_THRESHOLDS.hourly.minActivations}).`,
        calculatedAt,
      };
    }

    const salesPeakDays = averageByDayOfWeek(lines.map((l) => l.usedAt), timezone, calendarDays);
    const salesPeakHours = averageByHour(lines.map((l) => l.usedAt), timezone, calendarDays);
    const sessionsPeakDays = averageByDayOfWeek(sessions.map((s) => s.startedAt), timezone, calendarDays);
    const sessionsPeakHours = averageByHour(sessions.map((s) => s.startedAt), timezone, calendarDays);

    const confidence: ForecastConfidence = lines.length >= FORECAST_THRESHOLDS.hourly.minActivations * 1.5 ? 'MEDIUM' : 'LOW';

    return {
      salesPeakDays,
      salesPeakHours,
      sessionsPeakDays,
      sessionsPeakHours,
      confidence,
      historyCoverageDays: calendarDays,
      insufficientDataReason: null,
      calculatedAt,
    };
  }

  async forecastRouters(): Promise<RouterForecastItem[]> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    const { from, to, timezone } = await this.resolveHistoryWindow();
    const routers = await this.prisma.router.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, identity: true, alias: true },
    });

    const results: RouterForecastItem[] = [];
    for (const r of routers) {
      const lines = await this.revenue.listActivations({ tenantId: ctx.tenantId, from, to, routerId: r.id });
      const series = buildDailyRevenueSeries(lines, from, to, timezone);
      const valuedActivationsCount = lines.filter((l) => l.xof !== null).length;
      const revenueForecast = this.forecastMetric(series, 'revenueXof', 7, valuedActivationsCount, to, timezone);
      const salesForecast = this.forecastMetric(series, 'salesCount', 7, valuedActivationsCount, to, timezone);
      const currentTrend = trendDirection(series.map((p) => p.revenueXof));

      results.push({
        routerId: r.id,
        routerName: r.alias || r.identity,
        currentTrend,
        expectedDirection: revenueForecast.confidence === 'INSUFFICIENT_DATA' ? 'UNKNOWN' : directionFromForecast(series, revenueForecast),
        forecastRevenueXof: revenueForecast.confidence === 'INSUFFICIENT_DATA' ? null : sumPredicted(revenueForecast),
        forecastSalesCount: salesForecast.confidence === 'INSUFFICIENT_DATA' ? null : sumPredicted(salesForecast),
        confidence: revenueForecast.confidence,
        warning: revenueForecast.confidence === 'INSUFFICIENT_DATA' ? revenueForecast.warnings[0] ?? null : null,
      });
    }
    return results;
  }

  async forecastPlans(): Promise<PlanForecastItem[]> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');
    const { from, to, timezone } = await this.resolveHistoryWindow();
    const plans = await this.prisma.plan.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, name: true },
    });
    const lines = await this.revenue.listActivations({ tenantId: ctx.tenantId, from, to });

    const results: PlanForecastItem[] = [];
    for (const p of plans) {
      const planLines = lines.filter((l) => l.planId === p.id);
      const series = buildDailyRevenueSeries(planLines, from, to, timezone);
      const valuedActivationsCount = planLines.filter((l) => l.xof !== null).length;
      const salesForecast = this.forecastMetric(series, 'salesCount', 7, valuedActivationsCount, to, timezone);
      const revenueForecast = this.forecastMetric(series, 'revenueXof', 7, valuedActivationsCount, to, timezone);

      results.push({
        planId: p.id,
        name: p.name,
        salesTrend: trendDirection(series.map((s) => s.salesCount)),
        revenueTrend: trendDirection(series.map((s) => s.revenueXof)),
        expectedDemand: salesForecast.confidence === 'INSUFFICIENT_DATA' ? null : sumPredicted(salesForecast),
        confidence: salesForecast.confidence,
        warning: salesForecast.confidence === 'INSUFFICIENT_DATA' ? salesForecast.warnings[0] ?? null : revenueForecast.warnings[0] ?? null,
      });
    }
    return results;
  }

  private async assertRouterInTenant(tenantId: string, routerId: string): Promise<void> {
    const router = await this.prisma.router.findFirst({ where: { tenantId, id: routerId }, select: { id: true } });
    if (!router) throw new BadRequestException('Routeur introuvable pour ce tenant');
  }

  private async assertPlanInTenant(tenantId: string, planId: string): Promise<void> {
    const plan = await this.prisma.plan.findFirst({ where: { tenantId, id: planId }, select: { id: true } });
    if (!plan) throw new BadRequestException('Forfait introuvable pour ce tenant');
  }
}

function sumPredicted(result: ForecastResult): number {
  return result.points.reduce((s, p) => s + p.predicted, 0);
}

/** Direction simple et honnête : compare la moitié récente à la moitié ancienne de l'historique. */
function trendDirection(values: number[]): 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN' {
  if (values.length < 4) return 'UNKNOWN';
  const mid = Math.floor(values.length / 2);
  const first = values.slice(0, mid);
  const second = values.slice(mid);
  const avgFirst = first.reduce((s, v) => s + v, 0) / first.length;
  const avgSecond = second.reduce((s, v) => s + v, 0) / second.length;
  if (avgFirst === 0 && avgSecond === 0) return 'STABLE';
  const change = avgFirst === 0 ? 1 : (avgSecond - avgFirst) / avgFirst;
  if (change > 0.1) return 'UP';
  if (change < -0.1) return 'DOWN';
  return 'STABLE';
}

function directionFromForecast(series: DailySeriesPoint[], forecast: ForecastResult): 'UP' | 'DOWN' | 'STABLE' | 'UNKNOWN' {
  if (!forecast.points.length) return 'UNKNOWN';
  const recentAvg = series.slice(-7).reduce((s, p) => s + p.revenueXof, 0) / Math.max(1, Math.min(7, series.length));
  const forecastAvg = forecast.points.reduce((s, p) => s + p.predicted, 0) / forecast.points.length;
  if (recentAvg === 0 && forecastAvg === 0) return 'STABLE';
  const change = recentAvg === 0 ? 1 : (forecastAvg - recentAvg) / recentAvg;
  if (change > 0.1) return 'UP';
  if (change < -0.1) return 'DOWN';
  return 'STABLE';
}

function averageByDayOfWeek(instants: Date[], timezone: string, calendarDays: number): { dayOfWeek: number; averageCount: number }[] {
  const counts = new Array(7).fill(0);
  for (const at of instants) {
    const { dayOfWeek } = localDayOfWeekAndHour(at, timezone);
    counts[dayOfWeek] += 1;
  }
  const weeksApprox = Math.max(1, calendarDays / 7);
  return counts
    .map((count, dayOfWeek) => ({ dayOfWeek, averageCount: Math.round((count / weeksApprox) * 100) / 100 }))
    .sort((a, b) => b.averageCount - a.averageCount);
}

function averageByHour(instants: Date[], timezone: string, calendarDays: number): { hour: number; averageCount: number }[] {
  const counts = new Array(24).fill(0);
  for (const at of instants) {
    const { hour } = localDayOfWeekAndHour(at, timezone);
    counts[hour] += 1;
  }
  const daysApprox = Math.max(1, calendarDays);
  return counts
    .map((count, hour) => ({ hour, averageCount: Math.round((count / daysApprox) * 100) / 100 }))
    .sort((a, b) => b.averageCount - a.averageCount);
}
