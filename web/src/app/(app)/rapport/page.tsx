'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, extractErrorMessage } from '@/lib/api';
import type { MetricsSummary, MetricsPeriod } from '@/lib/types';
import { xof } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Stat } from '@/components/ui';
import { BarChart, PeriodTabs, type ChartBar } from '@/components/analytics/charts';

// Périodes analytics (histogramme horaire) alignées sur le backend.
type AnalyticsPeriod = 'today' | 'yesterday' | 'last7days' | 'last30days';

type AnalyticsOverview = {
  revenueXof: number;
  salesCount: number;
  averageSaleXof: number;
  revenueGrowthPercent: number | null;
  timeSeries: { date: string; revenueXof: number; salesCount: number }[];
  peakHours: { hour: number; sessions: number; sales: number }[];
};

const PERIODS: readonly { key: MetricsPeriod; label: string; analytics: AnalyticsPeriod }[] = [
  { key: 'today', label: "Aujourd'hui", analytics: 'today' },
  { key: 'yesterday', label: 'Hier', analytics: 'yesterday' },
  { key: '7d', label: '7 jours', analytics: 'last7days' },
  { key: '30d', label: '30 jours', analytics: 'last30days' },
] as const;

function Trend({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted">—</span>;
  const up = pct >= 0;
  return (
    <span className={up ? 'text-success' : 'text-danger'}>
      {up ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}

export default function RapportPage() {
  const [period, setPeriod] = useState<MetricsPeriod>('today');
  const analyticsPeriod = PERIODS.find((p) => p.key === period)?.analytics ?? 'today';
  const singleDay = period === 'today' || period === 'yesterday';

  const metrics = useQuery({
    queryKey: ['metrics', 'summary', period],
    queryFn: () => apiGet<MetricsSummary>('/metrics/summary', { period }),
  });
  const overview = useQuery({
    queryKey: ['analytics', 'overview', analyticsPeriod],
    queryFn: () => apiGet<AnalyticsOverview>('/analytics/overview', { period: analyticsPeriod }),
  });

  const s = metrics.data;
  const avgBasket = s && s.ticketsUsed > 0 ? Math.round(s.revenueXof / s.ticketsUsed) : 0;

  const bars = useMemo<ChartBar[]>(() => {
    const ov = overview.data;
    if (!ov) return [];
    if (singleDay) {
      const byHour = new Map(ov.peakHours.map((h) => [h.hour, h.sales]));
      return Array.from({ length: 24 }, (_, h) => ({
        label: `${h}h`,
        value: byHour.get(h) ?? 0,
      }));
    }
    return ov.timeSeries.map((d) => ({ label: d.date.slice(5), value: d.revenueXof }));
  }, [overview.data, singleDay]);

  const hasChart = bars.some((b) => b.value > 0);
  const byPlan = (s?.byPlan ?? []).filter((p) => p.sold > 0 || p.revenueXof > 0);
  const maxPlan = Math.max(1, ...byPlan.map((p) => p.revenueXof));

  return (
    <div>
      <PageHeader title="Rapport & performance" />

      <div className="mb-5">
        <PeriodTabs items={PERIODS} value={period} onChange={setPeriod} />
      </div>

      {metrics.isLoading ? (
        <Loading />
      ) : metrics.error ? (
        <ErrorBox message={extractErrorMessage(metrics.error)} />
      ) : (
        <>
          <Card className="mb-5 bg-gradient-to-br from-primary to-primary-dim">
            <div className="text-sm font-medium text-white/80">Chiffre d&apos;affaires</div>
            <div className="mt-1 text-4xl font-extrabold text-white">{xof(s?.revenueXof)}</div>
            <div className="mt-2 text-sm text-white/80">
              {s?.ticketsUsed ?? 0} tickets vendus · Tendance{' '}
              <span className="font-semibold text-white">
                {s?.trendPct == null ? '—' : `${s.trendPct >= 0 ? '+' : ''}${s.trendPct.toFixed(1)}%`}
              </span>{' '}
              vs période précédente
            </div>
          </Card>

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Panier moyen" value={xof(avgBasket)} />
            <Stat label="Tickets vendus" value={s?.ticketsUsed ?? 0} />
            <Stat label="Tickets générés" value={s?.ticketsGenerated ?? 0} />
            <Stat label="Tendance" value={<Trend pct={s?.trendPct ?? null} />} sub="vs précédent" />
          </div>

          <Card className="mb-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">
                {singleDay ? 'CA par heure' : 'CA par jour'}
              </h2>
            </div>
            {overview.isLoading ? (
              <Loading />
            ) : overview.error ? (
              <ErrorBox message={extractErrorMessage(overview.error)} />
            ) : hasChart ? (
              <BarChart
                data={bars}
                ariaLabel={
                  singleDay
                    ? "Histogramme du chiffre d'affaires par heure"
                    : "Histogramme du chiffre d'affaires par jour"
                }
                formatValue={(v) => xof(v)}
                maxLabels={singleDay ? 12 : 8}
              />
            ) : (
              <EmptyState>Aucune vente sur la période.</EmptyState>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-fg">Forfaits vendus</h2>
            {byPlan.length === 0 ? (
              <EmptyState>Aucun forfait vendu sur la période.</EmptyState>
            ) : (
              <div className="space-y-3">
                {byPlan.map((p) => (
                  <div key={p.planId}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-fg">{p.planName}</span>
                      <span className="text-muted">
                        {p.sold} × · <span className="text-fg">{xof(p.revenueXof)}</span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface2">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(p.revenueXof / maxPlan) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
