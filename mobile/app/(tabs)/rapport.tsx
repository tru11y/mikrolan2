export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type AnalyticsPeriod,
  type MetricsPeriod,
} from '@/src/lib/api';
import { exportMetricsCsv } from '@/src/lib/metricsCsv';
import { exportMetricsPdf } from '@/src/lib/metricsPdf';
import {
  Card,
  Empty,
  ErrorState,
  FadeIn,
  Press,
  Row,
  Skeleton,
  space,
  useToast,
} from '@/src/components/ui';
import { describeError } from '@/src/lib/errors';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { useBackToDashboard } from '@/src/hooks/use-back-to-dashboard';
import { RapportSectionHeader } from '@/src/components/rapport/RapportSectionHeader';
import { RapportHourlyHeatmap } from '@/src/components/rapport/RapportHourlyHeatmap';
import { RapportDateRangeModal } from '@/src/components/rapport/RapportDateRangeModal';
import { RapportPeriodBar, RapportRouterBars } from '@/src/components/rapport/RapportV3';
import { RapportPlanTable, RapportRevenueCard, type ChartPoint } from '@/src/components/rapport/RapportBi';
import { fmtDay, fmtXof } from '@/src/components/rapport/shared';
import {
  addDays,
  fmtRange,
  meaningfulGrowth,
  rangeDays,
  startOfDay,
  toApiBounds,
  type DayRange,
} from '@/src/lib/rapportPeriod';

type PeriodKey = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'custom';

const METRICS_BY_ANALYTICS: Record<AnalyticsPeriod, MetricsPeriod> = {
  today: 'today',
  yesterday: 'today',
  last7days: '7d',
  last30days: '30d',
  currentWeek: '7d',
  currentMonth: '30d',
  custom: '30d',
};

export default function RapportScreen() {
  useBackToDashboard();
  const toast = useToast();
  const theme = useTheme();
  const { t } = useTranslation();
  const { routerId } = useLocalSearchParams<{ routerId?: string }>();
  const { activeRouterId } = useActiveRouter();
  const navHeight = useBottomNavHeight();
  const qc = useQueryClient();
  const router = useRouter();

  const [periodKey, setPeriodKey] = useState<PeriodKey>('today');
  const [customRange, setCustomRange] = useState<DayRange | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const effectivePeriod: AnalyticsPeriod = periodKey;
  const bounds = useMemo(
    () => (periodKey === 'custom' && customRange ? toApiBounds(customRange) : null),
    [periodKey, customRange],
  );
  const customFrom = bounds?.from;
  const customTo = bounds?.to;
  const period = METRICS_BY_ANALYTICS[effectivePeriod] ?? '30d';

  const periodItems: { key: PeriodKey; label: string; flex: number }[] = [
    { key: 'today', label: t('rapport.today'), flex: 1.5 },
    { key: 'yesterday', label: t('rapport.yesterday'), flex: 1 },
    { key: 'last7days', label: t('rapport.last7Short'), flex: 0.8 },
    { key: 'last30days', label: t('rapport.last30Short'), flex: 0.8 },
    { key: 'custom', label: t('rapport.dates'), flex: 1.1 },
  ];
  const onSelectPeriod = (key: PeriodKey) => {
    // « Dates » sans plage choisie ouvre le calendrier ; la période ne change qu'à la validation.
    if (key === 'custom') setPickerOpen(true);
    else setPeriodKey(key);
  };

  // Plage réellement affichée, pour la légende et le libellé d'export.
  const shownRange: DayRange = useMemo(() => {
    const today = startOfDay(new Date());
    switch (periodKey) {
      case 'yesterday':
        return { from: addDays(today, -1), to: addDays(today, -1) };
      case 'last7days':
        return { from: addDays(today, -6), to: today };
      case 'last30days':
        return { from: addDays(today, -29), to: today };
      case 'custom':
        return customRange ?? { from: today, to: today };
      default:
        return { from: today, to: today };
    }
  }, [periodKey, customRange]);
  const singleDay = rangeDays(shownRange) === 1;
  const exportPeriodLabel = fmtRange(shownRange);

  const metrics = useQuery({
    queryKey: ['metrics', period, routerId],
    queryFn: () => api.metrics.summary(period, routerId),
    placeholderData: keepPreviousData,
  });
  const overview = useQuery({
    queryKey: ['analytics', 'overview', effectivePeriod, customFrom, customTo, routerId],
    queryFn: () =>
      api.analytics.overview({
        period: effectivePeriod,
        from: customFrom,
        to: customTo,
        routerId,
      }),
    placeholderData: keepPreviousData,
  });
  const analyticsRouters = useQuery({
    queryKey: ['analytics', 'routers', effectivePeriod, customFrom, customTo],
    queryFn: () =>
      api.analytics.routers({
        period: effectivePeriod,
        from: customFrom,
        to: customTo,
      }),
    placeholderData: keepPreviousData,
  });
  const traffic = useQuery({
    queryKey: ['analytics', 'traffic', effectivePeriod, customFrom, customTo, routerId],
    queryFn: () =>
      api.analytics.traffic({
        period: effectivePeriod,
        from: customFrom,
        to: customTo,
        routerId,
      }),
    placeholderData: keepPreviousData,
  });
  const sessionStats = useQuery({
    queryKey: ['analytics', 'sessions', effectivePeriod, customFrom, customTo, routerId],
    queryFn: () =>
      api.analytics.sessionStats({
        period: effectivePeriod,
        from: customFrom,
        to: customTo,
        routerId,
      }),
    placeholderData: keepPreviousData,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['metrics'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
    ]);
    setRefreshing(false);
  }, [qc]);

  const data = metrics.data;
  const days = rangeDays(shownRange);

  // Une seule mesure d'un bout à l'autre : des francs, par heure sur un jour, par jour sinon.
  const points: ChartPoint[] = useMemo(() => {
    if (singleDay) {
      const byHour = new Map((overview.data?.peakHours ?? []).map((h) => [h.hour, h]));
      return Array.from({ length: 24 }, (_, h) => ({
        label: `${h} h`,
        revenueXof: byHour.get(h)?.revenueXof ?? 0,
        sales: byHour.get(h)?.sales ?? 0,
      }));
    }
    return (overview.data?.timeSeries ?? []).map((d) => ({
      label: fmtDay(d.date),
      revenueXof: d.revenueXof,
      sales: d.salesCount,
    }));
  }, [singleDay, overview.data?.peakHours, overview.data?.timeSeries]);

  const salesCount = overview.data?.salesCount ?? 0;
  const summary = salesCount
    ? `${t('rapport.ticketsCount', { count: salesCount })} · ${t('rapport.avgBasketInline', { amount: fmtXof(overview.data?.averageSaleXof ?? 0) })}`
    : t('rapport.ticketsCount', { count: 0 });
  const toDate = overview.data?.comparison === 'to_date';
  const comparisonText = singleDay
    ? t(toDate ? 'rapport.vsYesterdaySameTime' : 'rapport.vsDayBefore')
    : t(toDate ? 'rapport.vsPreviousDaysToDate' : 'rapport.vsPreviousDays', { count: days });

  const planRows = (overview.data?.topPlans ?? []).map((p) => ({
    id: p.planId,
    name: p.name,
    tickets: p.salesCount,
    revenueXof: p.revenueXof,
    percent: p.revenueContributionPercent,
  }));
  const routerRows = (analyticsRouters.data ?? [])
    .filter((r) => r.revenueXof > 0)
    .slice(0, 5)
    .map((r) => ({
      id: r.routerId,
      name: r.routerName,
      revenueXof: r.revenueXof,
      percent: r.contributionPercent,
      growthPercent: meaningfulGrowth(r.growthPercent),
    }));

  const error = metrics.error;
  const exportButton = (icon: 'document-text-outline' | 'download-outline', label: string, run: () => Promise<void>) => (
    <Press
      onPress={() => {
        if (!data) return;
        run().catch((e) => toast.error(describeError(e).message));
      }}
      accessibilityLabel={label}
      style={{ flex: 1 }}
    >
      <View
        style={{
          height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border,
        }}
      >
        <Ionicons name={icon} size={16} color={theme.text} />
        <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{label}</Text>
      </View>
    </Press>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('rapport.title')} back={Boolean(activeRouterId)} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: 14, paddingBottom: navHeight }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />}
      >
        {error ? (
          <ErrorState message={t('rapport.loadError')} onRetry={onRefresh} />
        ) : (
          <>
            <FadeIn>
              <View style={{ gap: 8 }}>
                <RapportPeriodBar items={periodItems} selected={periodKey} onSelect={onSelectPeriod} />
                <Row>
                  <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '600' }}>{fmtRange(shownRange)}</Text>
                  {periodKey === 'custom' ? (
                    <Press onPress={() => setPickerOpen(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
                      <Text style={{ color: theme.primary, fontSize: 13, fontWeight: '700' }}>{t('rapport.changeDates')}</Text>
                    </Press>
                  ) : null}
                </Row>
              </View>
            </FadeIn>

            <FadeIn delay={50}>
              <RapportRevenueCard
                title={t('rapport.revenue')}
                revenueXof={overview.data?.revenueXof ?? 0}
                summary={summary}
                growthPercent={meaningfulGrowth(overview.data?.revenueGrowthPercent)}
                comparisonText={comparisonText}
                loading={overview.isLoading}
                chartTitle={t(singleDay ? 'rapport.revenuePerHour' : 'rapport.revenuePerDay')}
                points={points}
                hourly={singleDay}
                peakPrefix={t(singleDay ? 'rapport.peakHour' : 'rapport.peakDay')}
                describePoint={(p) => `${p.label} · ${fmtXof(p.revenueXof)} · ${t('rapport.ticketsCount', { count: p.sales })}`}
                emptyText={t('rapport.noChartData')}
              />
            </FadeIn>

            <FadeIn delay={100}>
              <Card style={{ gap: 12 }}>
                <RapportSectionHeader icon="pricetags-outline" label={t('rapport.plansSold')} color={theme.warning} />
                {overview.isLoading ? (
                  <Skeleton height={100} />
                ) : planRows.length ? (
                  <RapportPlanTable
                    rows={planRows}
                    days={days}
                    labels={{
                      plan: t('rapport.planCol'),
                      tickets: t('rapport.tickets'),
                      revenue: t('rapport.revenueCol'),
                      perDay: (n) => t('rapport.perDay', { n }),
                    }}
                  />
                ) : (
                  <Empty icon="pricetags-outline" text={t('rapport.noPlanSales')} />
                )}
              </Card>
            </FadeIn>

            {/* Un seul routeur qui vend répéterait le total : la répartition n'apparaît qu'à partir de deux. */}
            {routerRows.length > 1 ? (
              <FadeIn delay={150}>
                <Card style={{ gap: 12 }}>
                  <RapportSectionHeader icon="hardware-chip-outline" label={t('rapport.routersSection')} color={theme.primary} />
                  <RapportRouterBars
                    rows={routerRows}
                    onPress={(id) => router.push(`/analytics-router/${id}?period=${effectivePeriod}`)}
                  />
                </Card>
              </FadeIn>
            ) : null}

            {/* Jour × heure n'a de sens que sur plusieurs jours ; sur un seul, le graphique du haut le dit déjà. */}
            {days >= 7 && traffic.data?.salesHeatmap?.length ? (
              <FadeIn delay={200}>
                <Card style={{ gap: 10 }}>
                  <RapportSectionHeader icon="flame-outline" label={t('rapport.hourlyHeatmap')} color={theme.warning} />
                  <RapportHourlyHeatmap cells={traffic.data.salesHeatmap} />
                </Card>
              </FadeIn>
            ) : null}

            <FadeIn delay={250}>
              <Row style={{ gap: 8 }}>
                {exportButton('document-text-outline', t('rapport.exportCsv'), () =>
                  exportMetricsCsv(data!, exportPeriodLabel, sessionStats.data),
                )}
                {exportButton('download-outline', t('rapport.exportPdf'), () =>
                  exportMetricsPdf(data!, exportPeriodLabel, sessionStats.data, overview.data),
                )}
              </Row>
            </FadeIn>
          </>
        )}
      </ScrollView>
      <RapportDateRangeModal
        key={pickerOpen ? 'open' : 'closed'}
        visible={pickerOpen}
        initial={customRange}
        onClose={() => setPickerOpen(false)}
        onApply={(range) => {
          setCustomRange(range);
          setPeriodKey('custom');
          setPickerOpen(false);
        }}
      />
      <BottomNav active="rapport" />
    </View>
  );
}
