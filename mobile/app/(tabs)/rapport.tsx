export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View, Text, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSseLive } from '@/src/providers/live-events-provider';
import {
  api,
  type AnalyticsPeriod,
  type MetricsPeriod,
} from '@/src/lib/api';
import { exportMetricsCsv } from '@/src/lib/metricsCsv';
import { exportMetricsPdf } from '@/src/lib/metricsPdf';
import {
  AnimatedNumber,
  AuroraCard,
  Card,
  Empty,
  ErrorState,
  FadeIn,
  Mono,
  Press,
  Row,
  Skeleton,
  space,
  useToast,
  withAlpha,
} from '@/src/components/ui';
import { describeError } from '@/src/lib/errors';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { useBackToDashboard } from '@/src/hooks/use-back-to-dashboard';
import { RapportKpi } from '@/src/components/rapport/RapportKpi';
import { RapportSectionHeader } from '@/src/components/rapport/RapportSectionHeader';
import { RapportPlanPieChart } from '@/src/components/rapport/RapportPlanPieChart';
import { RapportRouterCard } from '@/src/components/rapport/RapportRouterCard';
import { RapportMonthYearPicker } from '@/src/components/rapport/RapportMonthYearPicker';
import { RapportRevenueChart } from '@/src/components/rapport/RapportRevenueChart';
import { RapportTicketsChart } from '@/src/components/rapport/RapportTicketsChart';
import { RapportHourlyHeatmap } from '@/src/components/rapport/RapportHourlyHeatmap';
import { fmtBytes, fmtXof } from '@/src/components/rapport/shared';

type FilterMode = 'preset' | 'month';

const ANALYTICS_PERIODS: { key: string; value: AnalyticsPeriod }[] = [
  { key: 'rapport.today', value: 'today' },
  { key: 'rapport.last7d', value: 'last7days' },
  { key: 'rapport.last30d', value: 'last30days' },
  { key: 'rapport.currentMonth', value: 'currentMonth' },
];

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
  const sseLive = useSseLive();
  const toast = useToast();
  const theme = useTheme();
  const { t } = useTranslation();
  const { routerId } = useLocalSearchParams<{ routerId?: string }>();
  const { activeRouterId } = useActiveRouter();
  const navHeight = useBottomNavHeight();
  const qc = useQueryClient();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = screenWidth - space.lg * 2;

  const [filterMode, setFilterMode] = useState<FilterMode>('preset');
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>('last30days');
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [refreshing, setRefreshing] = useState(false);

  const effectivePeriod = filterMode === 'month' ? 'custom' as AnalyticsPeriod : analyticsPeriod;
  // Le backend exige des datetimes ISO (z.string().datetime()) avec `to` exclusif :
  // [1er du mois 00:00Z, 1er du mois suivant 00:00Z).
  const customFrom = useMemo(
    () => (filterMode === 'month' ? new Date(Date.UTC(selectedYear, selectedMonth, 1)).toISOString() : undefined),
    [filterMode, selectedMonth, selectedYear],
  );
  const customTo = useMemo(
    () => (filterMode === 'month' ? new Date(Date.UTC(selectedYear, selectedMonth + 1, 1)).toISOString() : undefined),
    [filterMode, selectedMonth, selectedYear],
  );

  const period = METRICS_BY_ANALYTICS[effectivePeriod] ?? '30d';

  const AP = ANALYTICS_PERIODS.map((p) => ({ value: p.value, label: t(p.key) }));
  // Le libellé d'export doit refléter ce que l'opérateur a réellement choisi
  // (fenêtre glissante "30 derniers jours" vs mois calendaire) — jamais dérivé
  // du bucket backend `MetricsPeriod` ('30d' sert aux deux, ce qui affichait
  // à tort "Ce mois" pour un export "30 derniers jours").
  const monthNames = t('rapport.months', { returnObjects: true }) as string[];
  const exportPeriodLabel =
    filterMode === 'month'
      ? `${monthNames[selectedMonth]} ${selectedYear}`
      : (AP.find((p) => p.value === analyticsPeriod)?.label ?? '');

  const rangeCaption = useMemo(() => {
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const today = new Date();
    const daysBack = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
    if (filterMode === 'month') {
      return t('rapport.rangeMonth', {
        from: fmt(new Date(selectedYear, selectedMonth, 1)),
        to: fmt(new Date(selectedYear, selectedMonth + 1, 0)),
      });
    }
    switch (analyticsPeriod) {
      case 'last30days':
        return t('rapport.rangeRolling', { days: 30, from: fmt(daysBack(29)), to: fmt(today) });
      case 'last7days':
        return t('rapport.rangeRolling', { days: 7, from: fmt(daysBack(6)), to: fmt(today) });
      case 'currentMonth':
        return t('rapport.rangeMonth', {
          from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)),
          to: fmt(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
        });
      default:
        return fmt(today);
    }
  }, [filterMode, analyticsPeriod, selectedMonth, selectedYear, t]);

  const metrics = useQuery({
    queryKey: ['metrics', period, routerId],
    queryFn: () => api.metrics.summary(period, routerId),
    placeholderData: keepPreviousData,
  });
  const clients = useQuery({
    queryKey: ['clients', routerId],
    queryFn: () => api.metrics.recentClients(15, routerId),
    refetchInterval: sseLive ? false : 30_000,
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
      qc.invalidateQueries({ queryKey: ['clients'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
    ]);
    setRefreshing(false);
  }, [qc]);

  const data = metrics.data;
  const timeSeries = overview.data?.timeSeries ?? [];

  const monthlyRevenue = useMemo(() => {
    if (!timeSeries.length) return 0;
    return timeSeries.reduce((sum, d) => sum + d.revenueXof, 0);
  }, [timeSeries]);

  const totalSalesCount = useMemo(
    () => timeSeries.reduce((s, d) => s + d.salesCount, 0),
    [timeSeries],
  );

  const error = metrics.error;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('rapport.title')} back={Boolean(activeRouterId)} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: 14, paddingBottom: navHeight }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />}
      >
        {/* Header + export */}
        <FadeIn>
          <Row>
            <View style={{ flex: 1 }} />
            <Row style={{ gap: 8 }}>
              <Press
                onPress={() => {
                  if (!data) return;
                  exportMetricsCsv(data, exportPeriodLabel, sessionStats.data).catch((e) =>
                    toast.error(describeError(e).message),
                  );
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: theme.surface,
                  borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
                }}
              >
                <Ionicons name="document-text-outline" size={13} color={theme.primaryMuted} />
                <Text style={{ color: theme.primaryMuted, fontSize: 10, fontWeight: '700' }}>CSV</Text>
              </Press>
              <Press
                onPress={() => {
                  if (!data) return;
                  exportMetricsPdf(data, exportPeriodLabel, sessionStats.data, overview.data).catch((e) =>
                    toast.error(describeError(e).message),
                  );
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: theme.primary, borderRadius: 10,
                  paddingHorizontal: 10, paddingVertical: 6,
                }}
              >
                <Ionicons name="download-outline" size={13} color={theme.primaryText} />
                <Text style={{ color: theme.primaryText, fontSize: 10, fontWeight: '700' }}>PDF</Text>
              </Press>
            </Row>
          </Row>
        </FadeIn>

        {error ? (
          <ErrorState message={t('rapport.loadError')} onRetry={onRefresh} />
        ) : (
          <>
            {/* Filter mode toggle */}
            <FadeIn>
              <Row style={{ gap: 6 }}>
                <Press
                  onPress={() => setFilterMode('preset')}
                  style={{
                    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10,
                    backgroundColor: filterMode === 'preset' ? theme.primary : theme.surface,
                  }}
                >
                  <Text style={{
                    color: filterMode === 'preset' ? theme.primaryText : theme.textMuted,
                    fontSize: 11, fontWeight: '700',
                  }}>
                    {t('rapport.periodMode')}
                  </Text>
                </Press>
                <Press
                  onPress={() => setFilterMode('month')}
                  style={{
                    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10,
                    backgroundColor: filterMode === 'month' ? theme.primary : theme.surface,
                  }}
                >
                  <Text style={{
                    color: filterMode === 'month' ? theme.primaryText : theme.textMuted,
                    fontSize: 11, fontWeight: '700',
                  }}>
                    {t('rapport.month')} / {t('rapport.year')}
                  </Text>
                </Press>
              </Row>
            </FadeIn>

            {/* Period filter or month/year picker */}
            <FadeIn>
              {filterMode === 'preset' ? (
                <Row style={{
                  backgroundColor: theme.surface,
                  borderRadius: 14, padding: 3, gap: 3,
                }}>
                  {AP.map((p) => {
                    const active = p.value === analyticsPeriod;
                    return (
                      <Press
                        key={p.value}
                        onPress={() => setAnalyticsPeriod(p.value)}
                        style={{
                          flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center',
                          backgroundColor: active ? theme.primary : 'transparent',
                        }}
                      >
                        <Text style={{
                          color: active ? theme.primaryText : theme.textMuted,
                          fontSize: 11, fontWeight: '700',
                        }}>
                          {p.label}
                        </Text>
                      </Press>
                    );
                  })}
                </Row>
              ) : (
                <Card style={{ gap: 8 }}>
                  <RapportMonthYearPicker
                    month={selectedMonth}
                    year={selectedYear}
                    onChangeMonth={setSelectedMonth}
                    onChangeYear={setSelectedYear}
                  />
                </Card>
              )}
            </FadeIn>

            <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center' }}>
              {filterMode === 'month' ? `${monthNames[selectedMonth]} ${selectedYear} · ` : ''}
              {rangeCaption}
            </Text>

            {/* Hero revenue */}
            <FadeIn delay={50}>
              <AuroraCard style={{ gap: 10, padding: 20 }}>
                <Text style={{ color: withAlpha('#FFFFFF', 0.7), fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                  {filterMode === 'month' ? t('rapport.monthlyRevenue') : t('rapport.revenue')}
                </Text>
                {metrics.isLoading && overview.isLoading ? (
                  <Skeleton height={36} width="60%" />
                ) : (
                  <AnimatedNumber
                    value={filterMode === 'month' ? monthlyRevenue : (data?.revenueXof ?? 0)}
                    format={(n) => fmtXof(n)}
                    style={{ color: '#FFFFFF', fontSize: 32, fontWeight: '900', fontFamily: theme.mono }}
                  />
                )}
                {data?.trendPct != null && filterMode === 'preset' ? (
                  <Row style={{ justifyContent: 'flex-start', gap: 6 }}>
                    <View style={{
                      backgroundColor: withAlpha('#FFFFFF', 0.18), borderRadius: 8,
                      paddingHorizontal: 8, paddingVertical: 3,
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                    }}>
                      <Ionicons name={data.trendPct >= 0 ? 'trending-up' : 'trending-down'} size={13} color="#FFFFFF" />
                      <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>
                        {data.trendPct >= 0 ? '+' : ''}{data.trendPct.toFixed(0)}%
                      </Text>
                    </View>
                    <Text style={{ color: withAlpha('#FFFFFF', 0.6), fontSize: 11 }}>
                      {data.ticketsUsed} {t('rapport.sales')}
                    </Text>
                  </Row>
                ) : null}
              </AuroraCard>
            </FadeIn>

            {/* KPIs — sessions en ligne + tickets vendus + CA moyen/jour */}
            <FadeIn delay={100}>
              <Row style={{ gap: 8 }}>
                <RapportKpi
                  icon="people-outline"
                  iconColor={theme.success}
                  value={`${data?.activeSessions ?? 0}`}
                  label={t('rapport.onlineNow')}
                />
                <RapportKpi
                  icon="ticket-outline"
                  iconColor={theme.primary}
                  value={`${totalSalesCount}`}
                  label={t('rapport.ticketsSoldPerDay')}
                />
                <RapportKpi
                  icon="cash-outline"
                  iconColor={theme.warning}
                  value={timeSeries.length ? fmtXof(Math.round(monthlyRevenue / timeSeries.length)) : '—'}
                  label={t('rapport.avgDailyRevenue')}
                />
                <RapportKpi
                  icon="calendar-outline"
                  iconColor="#EAB308"
                  value={fmtXof(monthlyRevenue)}
                  label={t('rapport.monthlyRevenue')}
                />
              </Row>
            </FadeIn>

            {/* CA journalier — interactive line chart */}
            <FadeIn delay={130}>
              <RapportRevenueChart timeSeries={timeSeries} chartWidth={chartWidth} />
            </FadeIn>

            {/* Tickets vendus par jour — bar chart */}
            <FadeIn delay={160}>
              <RapportTicketsChart timeSeries={timeSeries} chartWidth={chartWidth} />
            </FadeIn>

            {/* Heatmap horaire */}
            {traffic.data?.salesHeatmap?.length ? (
              <FadeIn delay={175}>
                <Card style={{ gap: 10 }}>
                  <RapportSectionHeader icon="flame-outline" label={t('rapport.hourlyHeatmap')} color={theme.warning} />
                  <RapportHourlyHeatmap cells={traffic.data.salesHeatmap} />
                </Card>
              </FadeIn>
            ) : null}

            {/* Sessions summary */}
            {sessionStats.data && sessionStats.data.totalSessions > 0 ? (
              <FadeIn delay={190}>
                <Card style={{ gap: 8 }}>
                  <RapportSectionHeader icon="wifi-outline" label={t('rapport.sessionsSection')} color={theme.primary} />
                  <Row style={{ gap: 12 }}>
                    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                      <Mono style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{sessionStats.data.totalSessions}</Mono>
                      <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('rapport.totalSessions')}</Text>
                    </View>
                    <View style={{ width: 1, height: 30, backgroundColor: theme.border }} />
                    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                      <Mono style={{ color: theme.success, fontSize: 16, fontWeight: '800' }}>{sessionStats.data.activeSessions}</Mono>
                      <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('rapport.activeSessions')}</Text>
                    </View>
                    <View style={{ width: 1, height: 30, backgroundColor: theme.border }} />
                    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
                      <Row style={{ gap: 3 }}>
                        <Ionicons name="arrow-down" size={12} color={theme.success} />
                        <Mono style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>{fmtBytes(sessionStats.data.totalBytesIn)}</Mono>
                      </Row>
                      <Row style={{ gap: 3 }}>
                        <Ionicons name="arrow-up" size={12} color={theme.primary} />
                        <Mono style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>{fmtBytes(sessionStats.data.totalBytesOut)}</Mono>
                      </Row>
                    </View>
                  </Row>
                </Card>
              </FadeIn>
            ) : null}

            {/* Plan breakdown */}
            <FadeIn delay={220}>
              <Card style={{ gap: 12 }}>
                <RapportSectionHeader icon="pie-chart-outline" label={t('rapport.planBreakdown')} color={theme.warning} />
                {metrics.isLoading ? <Skeleton height={100} /> : <RapportPlanPieChart data={data?.byPlan ?? []} t={t} />}
              </Card>
            </FadeIn>

            {/* Router ranking */}
            <FadeIn delay={250}>
              <View style={{ gap: 10 }}>
                <RapportSectionHeader icon="hardware-chip-outline" label={t('rapport.routersSection')} color={theme.primary} />
                {overview.isLoading && analyticsRouters.isLoading ? (
                  <Skeleton height={80} />
                ) : !(analyticsRouters.data?.length) ? (
                  <Empty icon="hardware-chip-outline" text={t('rapport.noRouterSales')} />
                ) : (
                  <View style={{ gap: 8 }}>
                    {analyticsRouters.data.slice(0, 5).map((r) => (
                      <RapportRouterCard
                        key={r.routerId}
                        r={r}
                        onPress={() => router.push(`/analytics-router/${r.routerId}?period=${effectivePeriod}`)}
                        t={t}
                      />
                    ))}
                  </View>
                )}
              </View>
            </FadeIn>

            {/* Recent clients */}
            <FadeIn delay={280}>
              <View style={{ gap: 10 }}>
                <RapportSectionHeader icon="people-outline" label={t('rapport.recentClients')} color={theme.success} />
                {!clients.data?.length ? (
                  <Empty icon="people-outline" text={t('rapport.noTicketUsed')} />
                ) : (
                  <View style={{ gap: 6 }}>
                    {clients.data.slice(0, 10).map((c) => (
                      <View key={c.voucherId} style={{
                        backgroundColor: theme.surface,
                        borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        borderLeftWidth: 3,
                        borderLeftColor: c.online ? theme.success : withAlpha(theme.textMuted, 0.2),
                      }}>
                        <View style={{
                          width: 8, height: 8, borderRadius: 4,
                          backgroundColor: c.online ? theme.success : withAlpha(theme.textMuted, 0.3),
                        }} />
                        <View style={{ flex: 1 }}>
                          <Row>
                            <Mono style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>{c.code}</Mono>
                            <Mono style={{ color: theme.success, fontSize: 12, fontWeight: '700' }}>{fmtXof(c.priceXof)}</Mono>
                          </Row>
                          <Text style={{ color: theme.textMuted, fontSize: 10 }}>
                            {c.planName} · {c.routerName}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </FadeIn>
          </>
        )}
      </ScrollView>
      <BottomNav active="rapport" />
    </View>
  );
}
