export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View, Text } from 'react-native';
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
import { RapportSectionHeader } from '@/src/components/rapport/RapportSectionHeader';
import { RapportHourlyHeatmap } from '@/src/components/rapport/RapportHourlyHeatmap';
import { RapportDateRangeModal } from '@/src/components/rapport/RapportDateRangeModal';
import {
  RapportHero,
  RapportPeriodBar,
  RapportPlanBar,
  RapportRouterBars,
  RapportStat,
} from '@/src/components/rapport/RapportV3';
import { fmtBytes, fmtDay, fmtXof } from '@/src/components/rapport/shared';
import { addDays, fmtDate, fmtRange, rangeDays, startOfDay, toApiBounds, type DayRange } from '@/src/lib/rapportPeriod';

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
  const sseLive = useSseLive();
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

  const hourly = useMemo(() => {
    const byHour = new Map((overview.data?.peakHours ?? []).map((h) => [h.hour, h.sales]));
    return Array.from({ length: 24 }, (_, h) => byHour.get(h) ?? 0);
  }, [overview.data?.peakHours]);
  const bars = singleDay ? hourly : timeSeries.map((d) => d.revenueXof);
  const firstDay = timeSeries[0];
  const lastDay = timeSeries[timeSeries.length - 1];
  const axis: [string, string] = singleDay
    ? ['0 h', '23 h']
    : [firstDay ? fmtDay(firstDay.date) : fmtDate(shownRange.from), lastDay ? fmtDay(lastDay.date) : fmtDate(shownRange.to)];

  const planRows = (overview.data?.topPlans ?? []).map((p) => ({
    id: p.planId,
    name: p.name,
    revenueXof: p.revenueXof,
    percent: p.revenueContributionPercent,
  }));
  const routerRows = (analyticsRouters.data ?? []).slice(0, 5).map((r) => ({
    id: r.routerId,
    name: r.routerName,
    revenueXof: r.revenueXof,
    percent: r.contributionPercent,
    growthPercent: r.growthPercent,
  }));

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
              <RapportHero
                label={t('rapport.revenue')}
                revenueXof={overview.data?.revenueXof ?? 0}
                growthPercent={overview.data?.revenueGrowthPercent}
                loading={overview.isLoading}
                chartLabel={singleDay ? t('rapport.salesPerHour') : t('rapport.revenuePerDay')}
                bars={bars}
                axis={axis}
                emptyText={t('rapport.noChartData')}
              />
            </FadeIn>

            <FadeIn delay={100}>
              <Row style={{ gap: 8 }}>
                <RapportStat
                  label={t('rapport.tickets')}
                  value={String(overview.data?.salesCount ?? 0)}
                  growthPercent={overview.data?.salesGrowthPercent}
                />
                <RapportStat label={t('rapport.avgBasket')} value={fmtXof(overview.data?.averageSaleXof ?? 0)} />
                <RapportStat label={t('rapport.onlineNow')} value={String(sessionStats.data?.activeSessions ?? 0)} />
              </Row>
            </FadeIn>

            <FadeIn delay={150}>
              <Card style={{ gap: 12 }}>
                <RapportSectionHeader icon="pricetags-outline" label={t('rapport.plansSection')} color={theme.warning} />
                {overview.isLoading ? (
                  <Skeleton height={100} />
                ) : planRows.length ? (
                  <RapportPlanBar rows={planRows} />
                ) : (
                  <Empty icon="pricetags-outline" text={t('rapport.noPlanSales')} />
                )}
              </Card>
            </FadeIn>

            <FadeIn delay={200}>
              <Card style={{ gap: 12 }}>
                <RapportSectionHeader icon="hardware-chip-outline" label={t('rapport.routersSection')} color={theme.primary} />
                {analyticsRouters.isLoading ? (
                  <Skeleton height={80} />
                ) : routerRows.length ? (
                  <RapportRouterBars
                    rows={routerRows}
                    onPress={(id) => router.push(`/analytics-router/${id}?period=${effectivePeriod}`)}
                  />
                ) : (
                  <Empty icon="hardware-chip-outline" text={t('rapport.noRouterSales')} />
                )}
              </Card>
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
