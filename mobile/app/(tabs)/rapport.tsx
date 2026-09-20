export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View, Text, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart, LineChart, PieChart } from 'react-native-gifted-charts';
import { useSseLive } from '@/src/providers/live-events-provider';
import {
  api,
  type AnalyticsPeriod,
  type AnalyticsRouterSummary,
  type MetricsPeriod,
} from '@/src/lib/api';
import { exportMetricsCsv } from '@/src/lib/metricsCsv';
import { exportMetricsPdf } from '@/src/lib/metricsPdf';
import { fmtGrowth } from '@/src/lib/analyticsFormat';
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
  type,
  weight,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';
import { useActiveRouter } from '@/src/providers/active-router-provider';
import { useBackToDashboard } from '@/src/hooks/use-back-to-dashboard';

const MONTHS_FR = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre',
];

type FilterMode = 'preset' | 'month';

const ANALYTICS_PERIODS: { key: string; value: AnalyticsPeriod }[] = [
  { key: 'rapport.today', value: 'today' },
  { key: 'rapport.last7d', value: 'last7days' },
  { key: 'rapport.last30d', value: 'last30days' },
  { key: 'rapport.currentMonth', value: 'currentMonth' },
];

function fmtXof(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' F';
}

function fmtBytes(bytesStr: string): string {
  const bytes = Number(bytesStr);
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

const METRICS_BY_ANALYTICS: Record<AnalyticsPeriod, MetricsPeriod> = {
  today: 'today',
  yesterday: 'today',
  last7days: '7d',
  last30days: '30d',
  currentWeek: '7d',
  currentMonth: '30d',
  custom: '30d',
};

function Kpi({
  icon: iconName,
  iconColor,
  value,
  label,
  sub,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  value: string;
  label: string;
  sub?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{
      flex: 1, alignItems: 'center', gap: 6, minWidth: 0,
      paddingVertical: 14, paddingHorizontal: 6,
      backgroundColor: theme.surface,
      borderRadius: 16,
    }}>
      <View style={{
        width: 34, height: 34, borderRadius: 11,
        backgroundColor: withAlpha(iconColor, 0.1),
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={iconName} size={16} color={iconColor} />
      </View>
      <Text
        style={{ color: theme.text, fontSize: 18, fontWeight: weight.heavy, fontFamily: theme.mono }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={{ color: theme.textMuted, fontSize: 10, textAlign: 'center', letterSpacing: 0.3, lineHeight: 13 }}>{label}</Text>
      {sub ? <Text style={{ color: iconColor, fontSize: 10, fontWeight: '700' }}>{sub}</Text> : null}
    </View>
  );
}

function SectionHeader({ icon, label, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }) {
  const theme = useTheme();
  return (
    <Row style={{ gap: 10, paddingTop: 4 }}>
      <View style={{
        width: 28, height: 28, borderRadius: 9,
        backgroundColor: withAlpha(color, 0.1),
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={icon} size={13} color={color} />
      </View>
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: weight.bold, flex: 1 }}>{label}</Text>
    </Row>
  );
}

function PlanPieChart({ data, t }: { data: { planId: string; planName: string; revenueXof: number; sold: number }[]; t: (key: string) => string }) {
  const theme = useTheme();
  const planColors = [theme.primary, theme.success, theme.warning, theme.danger, '#38BDF8', '#F472B6'];
  if (!data.length) return <Empty icon="pie-chart-outline" text={t('rapport.noPlanSales')} />;
  const total = data.reduce((s, p) => s + p.revenueXof, 0) || 1;
  const slices = data.map((p, idx) => ({
    value: p.revenueXof,
    color: planColors[idx % planColors.length],
    text: `${Math.round((p.revenueXof / total) * 100)}%`,
  }));

  return (
    <Row style={{ gap: space.lg, alignItems: 'center', justifyContent: 'flex-start' }}>
      <PieChart
        data={slices}
        radius={55}
        innerRadius={32}
        textColor={theme.text}
        textSize={10}
        showText
      />
      <View style={{ flex: 1, gap: 8 }}>
        {data.map((p, idx) => (
          <Row key={p.planId} style={{ gap: 8, justifyContent: 'flex-start' }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: planColors[idx % planColors.length] }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{p.planName}</Text>
              <Row style={{ gap: 6, justifyContent: 'flex-start' }}>
                <Mono style={{ color: theme.success, fontSize: 11, fontWeight: '700' }}>{fmtXof(p.revenueXof)}</Mono>
                <Text style={{ color: theme.textMuted, fontSize: 10 }}>{p.sold} ventes</Text>
              </Row>
            </View>
          </Row>
        ))}
      </View>
    </Row>
  );
}

function RouterCard({
  r,
  onPress,
  t,
}: {
  r: AnalyticsRouterSummary;
  onPress: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const theme = useTheme();
  const growth = fmtGrowth(r.growthPercent);
  const growthColor = r.growthPercent == null ? theme.textMuted : r.growthPercent >= 0 ? theme.success : theme.danger;
  return (
    <Press onPress={onPress} style={{
      backgroundColor: theme.surface,
      borderRadius: 14, padding: 14, gap: 8,
    }}>
      <Row>
        <Row style={{ gap: 10, flex: 1, justifyContent: 'flex-start' }}>
          <View style={{
            width: 36, height: 36, borderRadius: 11,
            backgroundColor: withAlpha(theme.primary, 0.08),
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="hardware-chip" size={16} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{r.routerName}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 11 }}>{r.salesCount} {t('rapport.sales')} · {r.contributionPercent.toFixed(0)}%</Text>
          </View>
        </Row>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Mono style={{ color: theme.success, fontSize: 14, fontWeight: '800' }}>{fmtXof(r.revenueXof)}</Mono>
          {growth ? <Text style={{ color: growthColor, fontSize: 11, fontWeight: '700' }}>{growth}</Text> : null}
        </View>
      </Row>
    </Press>
  );
}

function MonthYearPicker({
  month,
  year,
  onChangeMonth,
  onChangeYear,
}: {
  month: number;
  year: number;
  onChangeMonth: (m: number) => void;
  onChangeYear: (y: number) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const months: string[] = t('rapport.months', { returnObjects: true }) as string[];

  return (
    <View style={{ gap: 8 }}>
      {/* Year nav */}
      <Row style={{ justifyContent: 'center', gap: 16 }}>
        <Press onPress={() => onChangeYear(year - 1)} style={{ padding: 8 }}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Press>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: weight.bold, minWidth: 60, textAlign: 'center' }}>{year}</Text>
        <Press onPress={() => onChangeYear(year + 1)} style={{ padding: 8 }}>
          <Ionicons name="chevron-forward" size={18} color={theme.text} />
        </Press>
      </Row>
      {/* Month grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {months.map((label, idx) => {
          const active = idx === month;
          return (
            <Press
              key={idx}
              onPress={() => onChangeMonth(idx)}
              style={{
                width: '24%',
                paddingVertical: 8,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: active ? theme.primary : 'transparent',
              }}
            >
              <Text style={{
                color: active ? theme.primaryText : theme.textMuted,
                fontSize: 11,
                fontWeight: active ? '700' : '500',
              }}>
                {label.slice(0, 4)}
              </Text>
            </Press>
          );
        })}
      </View>
    </View>
  );
}

function fmtDay(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function RevenueChart({
  timeSeries,
  chartWidth,
}: {
  timeSeries: { date: string; revenueXof: number; salesCount: number }[];
  chartWidth: number;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (!timeSeries.length) return <Empty icon="bar-chart-outline" text={t('rapport.noChartData')} />;

  const spacing = Math.max(8, Math.min(40, (chartWidth - 60) / Math.max(timeSeries.length - 1, 1)));

  const data = timeSeries.map((d) => ({
    value: d.revenueXof,
    label: fmtDay(d.date),
    dataPointText: d.revenueXof > 0 ? fmtXof(d.revenueXof) : undefined,
  }));

  return (
    <Card style={{ gap: 10 }}>
      <SectionHeader icon="trending-up" label={t('rapport.dailyRevenueChart')} color={theme.success} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <LineChart
          data={data}
          width={Math.max(chartWidth - 60, timeSeries.length * spacing)}
          height={160}
          spacing={spacing}
          color={theme.success}
          thickness={2}
          startFillColor={withAlpha(theme.success, 0.2)}
          endFillColor={withAlpha(theme.success, 0.01)}
          areaChart
          curved
          hideDataPoints={timeSeries.length > 14}
          dataPointsColor={theme.success}
          xAxisColor={theme.border}
          yAxisColor={theme.border}
          yAxisTextStyle={{ color: theme.textMuted, fontSize: 9 }}
          xAxisLabelTextStyle={{ color: theme.textMuted, fontSize: 8, width: 30, textAlign: 'center' }}
          noOfSections={4}
          pointerConfig={{
            pointerStripColor: theme.border,
            pointerStripWidth: 1,
            pointerColor: theme.success,
            radius: 5,
            pointerLabelWidth: 100,
            pointerLabelHeight: 40,
            activatePointersOnLongPress: false,
            pointerLabelComponent: (items: { value: number }[]) => (
              <View style={{
                backgroundColor: theme.surface,
                borderRadius: 8,
                padding: 6,
                borderWidth: 1,
                borderColor: theme.border,
              }}>
                <Text style={{ color: theme.success, fontSize: 12, fontWeight: '700', fontFamily: theme.mono }}>
                  {fmtXof(items[0]?.value ?? 0)}
                </Text>
              </View>
            ),
          }}
        />
      </ScrollView>
    </Card>
  );
}

function TicketsChart({
  timeSeries,
  chartWidth,
}: {
  timeSeries: { date: string; revenueXof: number; salesCount: number }[];
  chartWidth: number;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (!timeSeries.length) return null;

  const spacing = Math.max(8, Math.min(40, (chartWidth - 60) / Math.max(timeSeries.length - 1, 1)));
  const barWidth = Math.max(6, Math.min(20, spacing * 0.6));

  const data = timeSeries.map((d) => ({
    value: d.salesCount,
    label: fmtDay(d.date),
    frontColor: withAlpha(theme.primary, 0.7),
    topLabelComponent: () =>
      d.salesCount > 0 ? (
        <Text style={{ color: theme.text, fontSize: 8, fontWeight: '700', textAlign: 'center' }}>
          {d.salesCount}
        </Text>
      ) : undefined,
  }));

  return (
    <Card style={{ gap: 10 }}>
      <SectionHeader icon="ticket-outline" label={t('rapport.ticketsSoldPerDay')} color={theme.primary} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <BarChart
          data={data}
          width={Math.max(chartWidth - 60, timeSeries.length * spacing)}
          height={120}
          spacing={spacing}
          barWidth={barWidth}
          barBorderRadius={4}
          xAxisColor={theme.border}
          yAxisColor={theme.border}
          yAxisTextStyle={{ color: theme.textMuted, fontSize: 9 }}
          xAxisLabelTextStyle={{ color: theme.textMuted, fontSize: 8, width: 30, textAlign: 'center' }}
          noOfSections={4}
          isAnimated
        />
      </ScrollView>
    </Card>
  );
}

const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function HourlyHeatmap({ cells }: { cells: { dayOfWeek: number; hour: number; count: number; revenueXof?: number }[] }) {
  const theme = useTheme();
  const maxCount = Math.max(1, ...cells.map((c) => c.count));

  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of cells) {
    if (c.dayOfWeek >= 0 && c.dayOfWeek < 7 && c.hour >= 0 && c.hour < 24) {
      grid[c.dayOfWeek][c.hour] = c.count;
    }
  }

  const cellSize = 11;
  const labelW = 28;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ gap: 2 }}>
        {/* Hour labels */}
        <View style={{ flexDirection: 'row', marginLeft: labelW }}>
          {Array.from({ length: 24 }, (_, h) => (
            <Text key={h} style={{
              width: cellSize + 2, textAlign: 'center',
              color: theme.textMuted, fontSize: 7, fontWeight: '600',
            }}>
              {h % 3 === 0 ? String(h) : ''}
            </Text>
          ))}
        </View>
        {/* Rows */}
        {DAYS_SHORT.map((day, d) => (
          <View key={d} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ width: labelW, color: theme.textMuted, fontSize: 8, fontWeight: '600' }}>{day}</Text>
            {grid[d].map((count, h) => {
              const alpha = count === 0 ? 0.03 : 0.1 + 0.9 * (count / maxCount);
              return (
                <View
                  key={h}
                  style={{
                    width: cellSize, height: cellSize, borderRadius: 2, margin: 1,
                    backgroundColor: withAlpha(theme.primary, alpha),
                  }}
                />
              );
            })}
          </View>
        ))}
        {/* Legend */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginLeft: labelW, width: 24 * (cellSize + 2) }}>
          <Text style={{ color: theme.textMuted, fontSize: 9 }}>Peu actif</Text>
          <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
            {[0.08, 0.25, 0.5, 0.75, 1].map((a, i) => (
              <View key={i} style={{ width: 12, height: 8, borderRadius: 2, backgroundColor: withAlpha(theme.primary, a) }} />
            ))}
          </View>
          <Text style={{ color: theme.textMuted, fontSize: 9 }}>Très actif</Text>
        </View>
      </View>
    </ScrollView>
  );
}

export default function RapportScreen() {
  useBackToDashboard();
  const sseLive = useSseLive();
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
  const customFrom = useMemo(() => {
    if (filterMode !== 'month') return undefined;
    return `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01`;
  }, [filterMode, selectedMonth, selectedYear]);
  const customTo = useMemo(() => {
    if (filterMode !== 'month') return undefined;
    const last = new Date(selectedYear, selectedMonth + 1, 0);
    return `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  }, [filterMode, selectedMonth, selectedYear]);

  const period = METRICS_BY_ANALYTICS[effectivePeriod] ?? '30d';

  const AP = ANALYTICS_PERIODS.map((p) => ({ value: p.value, label: t(p.key) }));
  const PERIODS = [
    { value: 'today' as MetricsPeriod, label: t('rapport.today') },
    { value: '7d' as MetricsPeriod, label: t('rapport.thisWeek') },
    { value: '30d' as MetricsPeriod, label: t('rapport.thisMonth') },
  ];

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
                  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? '';
                  exportMetricsCsv(data, periodLabel, sessionStats.data);
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
                  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? '';
                  exportMetricsPdf(data, periodLabel, sessionStats.data, overview.data);
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
                    Période
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
                  <MonthYearPicker
                    month={selectedMonth}
                    year={selectedYear}
                    onChangeMonth={setSelectedMonth}
                    onChangeYear={setSelectedYear}
                  />
                </Card>
              )}
            </FadeIn>

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
                <Kpi
                  icon="people-outline"
                  iconColor={theme.success}
                  value={`${data?.activeSessions ?? 0}`}
                  label={t('rapport.onlineNow')}
                />
                <Kpi
                  icon="ticket-outline"
                  iconColor={theme.primary}
                  value={`${timeSeries.reduce((s, d) => s + d.salesCount, 0)}`}
                  label={t('rapport.ticketsSoldPerDay')}
                />
                <Kpi
                  icon="cash-outline"
                  iconColor={theme.warning}
                  value={timeSeries.length ? fmtXof(Math.round(monthlyRevenue / timeSeries.length)) : '—'}
                  label={t('rapport.avgDailyRevenue')}
                />
                <Kpi
                  icon="calendar-outline"
                  iconColor="#EAB308"
                  value={fmtXof(monthlyRevenue)}
                  label={t('rapport.monthlyRevenue')}
                />
              </Row>
            </FadeIn>

            {/* CA journalier — interactive line chart */}
            <FadeIn delay={130}>
              <RevenueChart timeSeries={timeSeries} chartWidth={chartWidth} />
            </FadeIn>

            {/* Tickets vendus par jour — bar chart */}
            <FadeIn delay={160}>
              <TicketsChart timeSeries={timeSeries} chartWidth={chartWidth} />
            </FadeIn>

            {/* Heatmap horaire */}
            {traffic.data?.salesHeatmap?.length ? (
              <FadeIn delay={175}>
                <Card style={{ gap: 10 }}>
                  <SectionHeader icon="flame-outline" label={t('rapport.hourlyHeatmap')} color={theme.warning} />
                  <HourlyHeatmap cells={traffic.data.salesHeatmap} />
                </Card>
              </FadeIn>
            ) : null}

            {/* Sessions summary */}
            {sessionStats.data && sessionStats.data.totalSessions > 0 ? (
              <FadeIn delay={190}>
                <Card style={{ gap: 8 }}>
                  <SectionHeader icon="wifi-outline" label={t('rapport.sessionsSection')} color={theme.primary} />
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
                <SectionHeader icon="pie-chart-outline" label={t('rapport.planBreakdown')} color={theme.warning} />
                {metrics.isLoading ? <Skeleton height={100} /> : <PlanPieChart data={data?.byPlan ?? []} t={t} />}
              </Card>
            </FadeIn>

            {/* Router ranking */}
            <FadeIn delay={250}>
              <View style={{ gap: 10 }}>
                <SectionHeader icon="hardware-chip-outline" label={t('rapport.routersSection')} color={theme.primary} />
                {overview.isLoading && analyticsRouters.isLoading ? (
                  <Skeleton height={80} />
                ) : !(analyticsRouters.data?.length) ? (
                  <Empty icon="hardware-chip-outline" text={t('rapport.noRouterSales')} />
                ) : (
                  <View style={{ gap: 8 }}>
                    {analyticsRouters.data.slice(0, 5).map((r) => (
                      <RouterCard
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
                <SectionHeader icon="people-outline" label={t('rapport.recentClients')} color={theme.success} />
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
