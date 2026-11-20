'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, extractErrorMessage } from '@/lib/api';
import { xof } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, Stat } from '@/components/ui';
import { BarChart, LineChart, PeriodTabs, type ChartBar, type ChartPoint } from '@/components/analytics/charts';

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';

type AnalyticsOverview = {
  revenueXof: number;
  salesCount: number;
  averageSaleXof: number;
  revenueGrowthPercent: number | null;
  timeSeries: { date: string; revenueXof: number; salesCount: number }[];
  topPlans: { planId: string; name: string; revenueXof: number; revenueContributionPercent: number }[];
};

type HeatmapCell = { dayOfWeek: number; hour: number; count: number; revenueXof?: number };
type AnalyticsTraffic = { salesHeatmap: HeatmapCell[]; sessionsHeatmap: HeatmapCell[] };

type BusinessInsight = {
  type: string;
  title: string;
  observation: string;
  evidence: string;
  confidence: Confidence;
  recommendedAction: string | null;
};

type ForecastPoint = { date: string; predicted: number; lowerBound: number; upperBound: number };
type ForecastResult = {
  metric: 'revenueXof' | 'salesCount';
  points: ForecastPoint[];
  model: string;
  confidence: Confidence;
  warnings: string[];
};
type ForecastOverview = {
  revenueForecast: ForecastResult;
  salesForecast: ForecastResult;
  warnings: string[];
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  HIGH: 'Fiabilité élevée',
  MEDIUM: 'Fiabilité moyenne',
  LOW: 'Fiabilité faible',
  INSUFFICIENT_DATA: 'Données insuffisantes',
  UNAVAILABLE: 'Indisponible',
};

function ConfidenceBadge({ c }: { c: Confidence }) {
  const tone = c === 'HIGH' ? 'success' : c === 'MEDIUM' ? 'primary' : c === 'LOW' ? 'warning' : 'muted';
  return <Badge tone={tone}>{CONFIDENCE_LABEL[c]}</Badge>;
}

function hourlyBars(cells: HeatmapCell[]): ChartBar[] {
  const byHour = new Map<number, number>();
  for (const c of cells) byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + c.count);
  return Array.from({ length: 24 }, (_, h) => ({ label: `${h}h`, value: byHour.get(h) ?? 0 }));
}

const TABS = [
  { key: 'overview' as const, label: "Vue d'ensemble" },
  { key: 'forecast' as const, label: 'Prévisions' },
];

function OverviewTab() {
  const overview = useQuery({
    queryKey: ['analytics', 'overview', 'last30days'],
    queryFn: () => apiGet<AnalyticsOverview>('/analytics/overview', { period: 'last30days' }),
  });
  const traffic = useQuery({
    queryKey: ['analytics', 'traffic', 'last30days'],
    queryFn: () => apiGet<AnalyticsTraffic>('/analytics/traffic', { period: 'last30days' }),
  });
  const insights = useQuery({
    queryKey: ['analytics', 'insights'],
    queryFn: () => apiGet<BusinessInsight[]>('/analytics/insights'),
  });

  const line = useMemo<ChartPoint[]>(
    () => (overview.data?.timeSeries ?? []).map((d) => ({ label: d.date.slice(5), value: d.revenueXof })),
    [overview.data],
  );
  const sessionsBars = useMemo(() => hourlyBars(traffic.data?.sessionsHeatmap ?? []), [traffic.data]);
  const o = overview.data;

  if (overview.isLoading) return <Loading />;
  if (overview.error) return <ErrorBox message={extractErrorMessage(overview.error)} />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="CA (30 j)" value={xof(o?.revenueXof)} />
        <Stat label="Ventes" value={o?.salesCount ?? 0} />
        <Stat label="Panier moyen" value={xof(o?.averageSaleXof)} />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-fg">Évolution du CA</h2>
        {line.length < 2 ? (
          <EmptyState>Historique insuffisant.</EmptyState>
        ) : (
          <LineChart data={line} ariaLabel="Évolution du chiffre d'affaires sur 30 jours" formatValue={(v) => xof(v)} />
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-fg">Affluence par heure (sessions)</h2>
        {traffic.isLoading ? (
          <Loading />
        ) : traffic.error ? (
          <ErrorBox message={extractErrorMessage(traffic.error)} />
        ) : sessionsBars.some((b) => b.value > 0) ? (
          <BarChart data={sessionsBars} ariaLabel="Nombre de sessions par heure de la journée" maxLabels={12} />
        ) : (
          <EmptyState>Aucune donnée de trafic.</EmptyState>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-fg">Forfaits les plus rentables</h2>
        {!o?.topPlans?.length ? (
          <EmptyState>Aucune vente sur la période.</EmptyState>
        ) : (
          <div className="space-y-3">
            {o.topPlans.map((p) => (
              <div key={p.planId}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-fg">{p.name}</span>
                  <span className="text-muted">
                    {p.revenueContributionPercent.toFixed(0)}% · <span className="text-fg">{xof(p.revenueXof)}</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface2">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(p.revenueContributionPercent, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-fg">Analyses</h2>
        {insights.isLoading ? (
          <Loading />
        ) : insights.error ? (
          <ErrorBox message={extractErrorMessage(insights.error)} />
        ) : !insights.data?.length ? (
          <EmptyState>Aucune analyse disponible.</EmptyState>
        ) : (
          <div className="space-y-2">
            {insights.data.map((ins, i) => (
              <Card key={`${ins.type}-${i}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-fg">{ins.title}</span>
                  <ConfidenceBadge c={ins.confidence} />
                </div>
                <p className="text-sm text-muted">{ins.observation}</p>
                <p className="mt-1 text-xs text-muted">{ins.evidence}</p>
                {ins.recommendedAction && (
                  <p className="mt-2 text-sm text-primary">→ {ins.recommendedAction}</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ForecastChart({ title, result }: { title: string; result: ForecastResult }) {
  const points = useMemo<ChartPoint[]>(
    () => result.points.map((p) => ({ label: p.date.slice(5), value: p.predicted, lower: p.lowerBound, upper: p.upperBound })),
    [result.points],
  );
  const fmt = result.metric === 'revenueXof' ? (v: number) => xof(v) : (v: number) => String(Math.round(v));
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <ConfidenceBadge c={result.confidence} />
      </div>
      {result.points.length < 2 || result.confidence === 'INSUFFICIENT_DATA' ? (
        <EmptyState>Données insuffisantes pour une prévision fiable.</EmptyState>
      ) : (
        <LineChart data={points} ariaLabel={`Prévision : ${title}`} formatValue={fmt} showBand />
      )}
      {result.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-warning">
          {result.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ForecastTab() {
  const forecast = useQuery({
    queryKey: ['analytics', 'forecast'],
    queryFn: () => apiGet<ForecastOverview>('/analytics/forecast'),
  });

  if (forecast.isLoading) return <Loading />;
  if (forecast.error) return <ErrorBox message={extractErrorMessage(forecast.error)} />;
  if (!forecast.data) return <EmptyState>Aucune prévision disponible.</EmptyState>;

  return (
    <div className="space-y-5">
      <ForecastChart title="Prévision du chiffre d'affaires" result={forecast.data.revenueForecast} />
      <ForecastChart title="Prévision des ventes" result={forecast.data.salesForecast} />
    </div>
  );
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<'overview' | 'forecast'>('overview');

  return (
    <div>
      <PageHeader title="Analytics" />
      <div className="mb-5">
        <PeriodTabs items={TABS} value={tab} onChange={setTab} ariaLabel="Vue analytics" />
      </div>
      {tab === 'overview' ? <OverviewTab /> : <ForecastTab />}
    </div>
  );
}
