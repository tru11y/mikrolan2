import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View, Text, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart, LineChart, PieChart } from 'react-native-gifted-charts';
import {
  api,
  type AnalyticsPeriod,
  type AnalyticsPlanPerformance,
  type AnalyticsRouterSummary,
  type MetricsPeriod,
  type RevenueByPeriodItem,
  type RevenueByRouterItem,
  type SessionStats,
} from '@/src/lib/api';
import { exportMetricsCsv } from '@/src/lib/metricsCsv';
import { exportMetricsPdf } from '@/src/lib/metricsPdf';
import { busiestCell, describeBusiest, fmtGrowth, DAY_LABELS } from '@/src/lib/analyticsFormat';
import {
  AnimatedNumber,
  AuroraCard,
  Badge,
  Card,
  Empty,
  ErrorState,
  FadeIn,
  icon,
  Mono,
  Press,
  Row,

  Skeleton,
  space,
  Subtitle,
  type,
  weight,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';
import { useActiveRouter } from '@/src/providers/active-router-provider';

const PERIOD_KEYS: { key: string; value: MetricsPeriod }[] = [
  { key: 'rapport.today', value: 'today' },
  { key: 'rapport.thisWeek', value: '7d' },
  { key: 'rapport.thisMonth', value: '30d' },
];

const ANALYTICS_PERIODS: { key: string; value: AnalyticsPeriod }[] = [
  { key: 'rapport.today', value: 'today' },
  { key: 'rapport.yesterday', value: 'yesterday' },
  { key: 'rapport.last7d', value: 'last7days' },
  { key: 'rapport.last30d', value: 'last30days' },
  { key: 'rapport.currentWeek', value: 'currentWeek' },
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

function Kpi({
  icon: iconName,
  iconColor,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  value: string;
  label: string;
}) {
  const theme = useTheme();
  return (
    <View style={{
      flex: 1, alignItems: 'center', gap: 8, minWidth: 0,
      paddingVertical: 16, paddingHorizontal: 8,
      backgroundColor: theme.surface,
      borderWidth: 1, borderColor: theme.border,
      borderRadius: 16,
    }}>
      <View style={{
        width: 38, height: 38, borderRadius: 12,
        backgroundColor: withAlpha(iconColor, 0.1),
        borderWidth: 1, borderColor: withAlpha(iconColor, 0.2),
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={iconName} size={17} color={iconColor} />
      </View>
      <Text
        style={{ color: theme.text, fontSize: type.h2, fontWeight: weight.heavy, fontFamily: theme.mono }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={{ color: theme.textMuted, fontSize: 10, textAlign: 'center', letterSpacing: 0.4, lineHeight: 14 }}>{label}</Text>
    </View>
  );
}

function SectionDivider({ icon, label, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 }}>
      <View style={{
        width: 30, height: 30, borderRadius: 10,
        backgroundColor: withAlpha(color, 0.1),
        borderWidth: 1, borderColor: withAlpha(color, 0.2),
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={icon} size={14} color={color} />
      </View>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: weight.bold, flex: 1 }}>{label}</Text>
      <View style={{ height: 1, flex: 0.3, backgroundColor: withAlpha(theme.border, 0.5) }} />
    </View>
  );
}

function DailyRevenueChart({ data, t, chartWidth }: { data: { date: string; revenueXof: number; salesCount: number }[]; t: (key: string) => string; chartWidth: number }) {
  const theme = useTheme();
  if (!data.length) return <Empty icon="bar-chart-outline" text={t('rapport.noSalesData')} />;
  const bars = data.map((d) => ({
    value: d.revenueXof,
    label: d.date.slice(8),
    frontColor: theme.primary,
  }));
  return (
    <View style={{ alignItems: 'center', paddingTop: space.sm }}>
      <BarChart
        data={bars}
        width={chartWidth}
        height={160}
        barWidth={Math.min(24, Math.max(8, (chartWidth - 40) / data.length - 4))}
        spacing={Math.min(12, Math.max(2, (chartWidth - 40) / data.length / 3))}
        roundedTop
        frontColor={theme.primary}
        yAxisTextStyle={{ color: theme.textMuted, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: theme.textMuted, fontSize: 8 }}
        rulesColor={theme.border}
        yAxisColor={theme.border}
        xAxisColor={theme.border}
        noOfSections={4}
      />
    </View>
  );
}

function PeakHoursChart({ data, t, chartWidth }: { data: { hour: number; sessions: number; sales: number }[]; t: (key: string) => string; chartWidth: number }) {
  const theme = useTheme();
  if (!data.length) return <Empty icon="time-outline" text={t('rapport.noSessionData')} />;
  const maxSessions = Math.max(...data.map((d) => d.sessions), 1);
  const bars = data.map((d) => ({
    value: d.sessions,
    label: d.hour % 3 === 0 ? `${d.hour}h` : '',
    frontColor: d.sessions === maxSessions ? theme.warning : theme.primarySoft,
  }));
  const peakHour = data.reduce((max, d) => (d.sessions > max.sessions ? d : max), data[0]);
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
        <View style={{ backgroundColor: withAlpha(theme.warning, 0.15), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="flame" size={14} color={theme.warning} />
          <Text style={{ color: theme.warning, fontSize: 12, fontWeight: '800' }}>
            {peakHour.hour}h-{peakHour.hour + 1}h
          </Text>
        </View>
        <Text style={{ color: theme.textMuted, fontSize: 11, flex: 1 }}>
          {peakHour.sessions} sessions · {peakHour.sales} {t('rapport.sales')}
        </Text>
      </Row>
      <View style={{ alignItems: 'center' }}>
        <BarChart
          data={bars}
          width={chartWidth}
          height={120}
          barWidth={Math.max(4, (chartWidth - 40) / 24 - 2)}
          spacing={2}
          frontColor={theme.primarySoft}
          yAxisTextStyle={{ color: theme.textMuted, fontSize: 9 }}
          xAxisLabelTextStyle={{ color: theme.textMuted, fontSize: 8 }}
          rulesColor={theme.border}
          yAxisColor={theme.border}
          xAxisColor={theme.border}
          noOfSections={3}
        />
      </View>
    </View>
  );
}

function MonthlyRevenueChart({ data, t, chartWidth }: { data: RevenueByPeriodItem[]; t: (key: string) => string; chartWidth: number }) {
  const theme = useTheme();
  const recent = data.slice(-6);
  if (!recent.length) {
    return <Empty icon="bar-chart-outline" text={t('rapport.noSalesData')} />;
  }
  const points = recent.map((d) => ({
    value: d.totalXof,
    label: d.month.slice(0, 3),
    dataPointText: fmtXof(d.totalXof),
  }));
  return (
    <View style={{ alignItems: 'center', paddingTop: space.sm }}>
      <LineChart
        data={points}
        width={chartWidth}
        height={160}
        color={theme.primary}
        thickness={3}
        dataPointsColor={theme.primary}
        textColor={theme.textMuted}
        textFontSize={10}
        xAxisLabelTextStyle={{ color: theme.textMuted, fontSize: 10 }}
        yAxisTextStyle={{ color: theme.textMuted, fontSize: 10 }}
        rulesColor={theme.border}
        yAxisColor={theme.border}
        xAxisColor={theme.border}
        startFillColor={theme.primary}
        endFillColor={theme.primary}
        startOpacity={0.25}
        endOpacity={0.02}
        areaChart
        curved
        noOfSections={4}
        hideDataPoints={false}
      />
    </View>
  );
}

function PlanPieChart({ data, t }: { data: { planId: string; planName: string; revenueXof: number; sold: number }[]; t: (key: string) => string }) {
  const theme = useTheme();
  const planColors = [theme.primary, theme.success, theme.warning, theme.danger, '#38BDF8', '#F472B6'];
  if (!data.length) {
    return <Empty icon="pie-chart-outline" text={t('rapport.noPlanSales')} />;
  }
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
        radius={60}
        innerRadius={36}
        textColor={theme.text}
        textSize={10}
        showText
      />
      <View style={{ flex: 1, gap: 6 }}>
        {data.map((p, idx) => (
          <Row key={p.planId} style={{ gap: 6, justifyContent: 'flex-start' }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: planColors[idx % planColors.length],
              }}
            />
            <Text style={{ color: theme.text, fontSize: 11, flex: 1 }} numberOfLines={1}>
              {p.planName}
            </Text>
            <Mono style={{ color: theme.textMuted, fontSize: 11 }}>{p.sold}×</Mono>
          </Row>
        ))}
      </View>
    </Row>
  );
}

function RouterRankingChart({ data, t, chartWidth }: { data: RevenueByRouterItem[]; t: (key: string) => string; chartWidth: number }) {
  const theme = useTheme();
  if (!data.length) {
    return <Empty icon="hardware-chip-outline" text={t('rapport.noRouterData')} />;
  }
  const top = data.slice(0, 6);
  const bars = top.map((d) => ({
    value: d.totalXof,
    label: d.routerName.length > 8 ? `${d.routerName.slice(0, 7)}…` : d.routerName,
    frontColor: theme.primary,
  }));
  return (
    <View style={{ alignItems: 'center', paddingTop: space.sm }}>
      <BarChart
        data={bars}
        width={chartWidth}
        height={160}
        barWidth={24}
        spacing={20}
        roundedTop
        frontColor={theme.primary}
        yAxisTextStyle={{ color: theme.textMuted, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: theme.textMuted, fontSize: 9 }}
        rulesColor={theme.border}
        yAxisColor={theme.border}
        xAxisColor={theme.border}
        noOfSections={4}
      />
    </View>
  );
}

const ANALYTICS_PERIOD_BY_METRICS_PERIOD: Record<MetricsPeriod, AnalyticsPeriod> = {
  today: 'today',
  '7d': 'last7days',
  '30d': 'last30days',
};

/** Classement compact des routeurs — tap pour le détail. */
function RoutersRankingSection({
  data,
  onSelect,
  t,
}: {
  data: AnalyticsRouterSummary[];
  onSelect: (routerId: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const theme = useTheme();
  if (!data.length) {
    return <Empty icon="hardware-chip-outline" text={t('rapport.noRouterSales')} />;
  }
  return (
    <View style={{ gap: 8 }}>
      {data.slice(0, 8).map((r) => {
        const growth = fmtGrowth(r.growthPercent);
        const growthColor = r.growthPercent == null ? theme.textMuted : r.growthPercent >= 0 ? theme.success : theme.danger;
        return (
          <Press
            key={r.routerId}
            onPress={() => onSelect(r.routerId)}
            style={{
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 14,
              padding: 12,
              gap: 4,
            }}
          >
            <Row>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                {r.routerName}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </Row>
            <Row style={{ justifyContent: 'flex-start', gap: 10 }}>
              <Mono style={{ color: theme.success, fontSize: 13, fontWeight: '800' }}>{fmtXof(r.revenueXof)}</Mono>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>{r.salesCount} {t('rapport.sales')}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>{r.contributionPercent.toFixed(0)}{t('rapport.ofRevenue')}</Text>
              {growth ? <Text style={{ color: growthColor, fontSize: 11, fontWeight: '700' }}>{growth}</Text> : null}
            </Row>
          </Press>
        );
      })}
    </View>
  );
}

/** Double classement forfaits : par volume et par contribution CA — les deux
 * peuvent diverger (un forfait très vendu mais peu cher pèse peu au final). */
function PlansDualRankingSection({ data, t }: { data: AnalyticsPlanPerformance[]; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const theme = useTheme();
  if (!data.length) {
    return <Empty icon="pricetags-outline" text={t('rapport.noPlanSalesThisPeriod')} />;
  }
  const byRevenue = [...data].sort((a, b) => b.revenueXof - a.revenueXof).slice(0, 5);
  const bySales = [...data].sort((a, b) => b.salesCount - a.salesCount).slice(0, 5);

  const renderPlan = (p: AnalyticsPlanPerformance, metric: 'revenue' | 'sales') => {
    const growth = fmtGrowth(p.growthPercent);
    const sentence =
      metric === 'revenue'
        ? t('rapport.revenueContribution', { pct: p.revenueContributionPercent.toFixed(0) })
        : t('rapport.salesContribution', { pct: p.salesContributionPercent.toFixed(0) });
    return (
      <View key={`${metric}-${p.planId}`} style={{ gap: 2, paddingVertical: 6 }}>
        <Row>
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>
            {p.name}
          </Text>
          <Mono style={{ color: theme.textMuted, fontSize: 12 }}>{fmtXof(p.revenueXof)}</Mono>
        </Row>
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>{sentence}</Text>
        {growth ? (
          <Text style={{ color: theme.textMuted, fontSize: 11 }}>
            {t('rapport.volumeChange', { direction: p.growthPercent! >= 0 ? t('rapport.increases') : t('rapport.decreases'), pct: Math.abs(p.growthPercent!).toFixed(0) })}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: 16 }}>
      <View>
        <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 }}>
          {t('rapport.topByRevenue')}
        </Text>
        {byRevenue.map((p) => renderPlan(p, 'revenue'))}
      </View>
      <View>
        <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 }}>
          {t('rapport.topByVolume')}
        </Text>
        {bySales.map((p) => renderPlan(p, 'sales'))}
      </View>
    </View>
  );
}

/** Jour/heure le plus actif — vend (commercial) vs sessions (réseau), jamais
 * confondus car issus de sources différentes (Voucher.usedAt vs Session.startedAt). */
function AffluenceSection({
  salesHeatmap,
  sessionsHeatmap,
  t,
}: {
  salesHeatmap: { dayOfWeek: number; hour: number; count: number }[];
  sessionsHeatmap: { dayOfWeek: number; hour: number; count: number }[];
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const theme = useTheme();
  const busiestSales = busiestCell(salesHeatmap);
  const busiestSessions = busiestCell(sessionsHeatmap);
  return (
    <View style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Ionicons name="cart-outline" size={16} color={theme.primary} />
        <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
          {t('rapport.salesPeak', { desc: describeBusiest(busiestSales) })}
        </Text>
      </Row>
      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Ionicons name="wifi-outline" size={16} color={theme.primarySoft} />
        <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
          {t('rapport.sessionsPeak', { desc: describeBusiest(busiestSessions) })}
        </Text>
      </Row>
    </View>
  );
}

const CONFIDENCE_TONE: Record<string, 'success' | 'warning' | 'muted' | 'danger'> = {
  HIGH: 'success',
  MEDIUM: 'warning',
  LOW: 'warning',
  INSUFFICIENT_DATA: 'muted',
  UNAVAILABLE: 'muted',
};

const CONFIDENCE_KEY: Record<string, string> = {
  HIGH: 'rapport.confidenceHigh',
  MEDIUM: 'rapport.confidenceMedium',
  LOW: 'rapport.confidenceLow',
  INSUFFICIENT_DATA: 'rapport.insufficientData',
  UNAVAILABLE: 'rapport.confidenceUnavailable',
};

/** Tendance + modèle retenu + période d'historique — jamais un modèle présenté comme vérité, toujours accompagné de sa confiance. */
function TrendsSection({ forecast }: { forecast: import('@/src/lib/api').ForecastOverview | undefined }) {
  const theme = useTheme();
  const { t } = useTranslation();
  if (!forecast) return <Skeleton height={80} />;
  const { revenueForecast, salesForecast } = forecast;
  if (revenueForecast.confidence === 'INSUFFICIENT_DATA') {
    return <Empty icon="analytics-outline" text={t('rapport.insufficientDataMsg')} />;
  }
  return (
    <View style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Badge label={t(CONFIDENCE_KEY[revenueForecast.confidence])} tone={CONFIDENCE_TONE[revenueForecast.confidence]} />
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>
          {t('rapport.modelHistory', { model: revenueForecast.model, start: revenueForecast.historyStart, end: revenueForecast.historyEnd })}
        </Text>
      </Row>
      <Text style={{ color: theme.textMuted, fontSize: 11 }}>
        {t('rapport.revenueTrainingDays', { count: revenueForecast.trainingPoints })}
      </Text>
      <Text style={{ color: theme.textMuted, fontSize: 11 }}>
        {t('rapport.salesTrainingDays', { count: salesForecast.trainingPoints, model: salesForecast.model })}
      </Text>
    </View>
  );
}

/** Prévision des prochains jours — distinction visuelle explicite réel/prévision, jamais présentée comme un fait acquis. */
function ForecastPointsSection({ points, metricLabel }: { points: { date: string; predicted: number; lowerBound: number; upperBound: number }[]; metricLabel: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  if (!points.length) return <Empty icon="calendar-outline" text={t('rapport.insufficientDataMsg')} />;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>{metricLabel}</Text>
      {points.map((p) => (
        <Row key={p.date} style={{ gap: 8 }}>
          <Text style={{ color: theme.textMuted, fontSize: 12, width: 90 }}>{p.date.slice(5)}</Text>
          <Row style={{ justifyContent: 'flex-start', gap: 6, flex: 1 }}>
            <Ionicons name="sparkles-outline" size={12} color={theme.primarySoft} />
            <Mono style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>{p.predicted}</Mono>
            <Text style={{ color: theme.textMuted, fontSize: 10 }}>
              ({p.lowerBound}–{p.upperBound})
            </Text>
          </Row>
        </Row>
      ))}
      <Text style={{ color: theme.textMuted, fontSize: 10, fontStyle: 'italic' }}>
        {t('rapport.forecastDisclaimer')}
      </Text>
    </View>
  );
}

/** Affluence prévue — jours/heures probables, ventes et sessions toujours distinguées. */
function PredictedTrafficSection({ data }: { data: import('@/src/lib/api').ForecastTraffic | undefined }) {
  const theme = useTheme();
  const { t } = useTranslation();
  if (!data) return <Skeleton height={80} />;
  if (data.confidence === 'INSUFFICIENT_DATA') {
    return <Empty icon="time-outline" text={data.insufficientDataReason ?? t('rapport.insufficientDataMsg')} />;
  }
  const topSalesDay = data.salesPeakDays[0];
  const topSalesHour = data.salesPeakHours[0];
  const topSessionsDay = data.sessionsPeakDays[0];
  const topSessionsHour = data.sessionsPeakHours[0];
  const salesDesc = (topSalesDay ? DAY_LABELS[topSalesDay.dayOfWeek] : '—') + (topSalesHour ? ` vers ${topSalesHour.hour}h` : '');
  const sessionsDesc = (topSessionsDay ? DAY_LABELS[topSessionsDay.dayOfWeek] : '—') + (topSessionsHour ? ` vers ${topSessionsHour.hour}h` : '');
  return (
    <View style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Ionicons name="cart-outline" size={16} color={theme.primary} />
        <Text style={{ color: theme.text, fontSize: 12, flex: 1 }}>
          {t('rapport.predictedSales', { desc: salesDesc })}
        </Text>
      </Row>
      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Ionicons name="wifi-outline" size={16} color={theme.primarySoft} />
        <Text style={{ color: theme.text, fontSize: 12, flex: 1 }}>
          {t('rapport.predictedSessions', { desc: sessionsDesc })}
        </Text>
      </Row>
      <Badge label={t(CONFIDENCE_KEY[data.confidence])} tone={CONFIDENCE_TONE[data.confidence]} />
    </View>
  );
}

/** Insights métier — cartes concises avec preuve et limite, jamais de causalité ni de jugement. */
function InsightsSection({ insights }: { insights: import('@/src/lib/api').BusinessInsight[] | undefined }) {
  const theme = useTheme();
  const { t } = useTranslation();
  if (!insights) return <Skeleton height={100} />;
  if (!insights.length || (insights.length === 1 && insights[0].type === 'INSUFFICIENT_DATA')) {
    return <Empty icon="bulb-outline" text={insights[0]?.observation ?? t('rapport.insufficientDataMsg')} />;
  }
  return (
    <View style={{ gap: 10 }}>
      {insights.slice(0, 6).map((ins, idx) => (
        <View
          key={`${ins.type}-${idx}`}
          style={{
            backgroundColor: theme.surface,
            borderWidth: 1, borderColor: theme.border,
            borderRadius: 14, padding: 14, gap: 8,
            borderLeftWidth: 3,
            borderLeftColor: CONFIDENCE_TONE[ins.confidence] === 'success' ? theme.success : CONFIDENCE_TONE[ins.confidence] === 'warning' ? theme.warning : theme.border,
          }}
        >
          <Row style={{ gap: 8 }}>
            <Ionicons name="bulb" size={14} color={theme.warning} />
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: weight.bold, flex: 1 }}>{ins.title}</Text>
          </Row>
          <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>{ins.observation}</Text>
          <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
            <Badge label={CONFIDENCE_KEY[ins.confidence] ? t(CONFIDENCE_KEY[ins.confidence]) : ins.confidence} tone={CONFIDENCE_TONE[ins.confidence] ?? 'muted'} />
          </Row>
          {ins.limitations ? (
            <Text style={{ color: withAlpha(theme.textMuted, 0.6), fontSize: 10, fontStyle: 'italic' }}>{ins.limitations}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function SessionStatsSection({ data, t }: { data: SessionStats | undefined; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const theme = useTheme();
  if (!data) return <Skeleton height={120} />;
  if (data.totalSessions === 0) return <Empty icon="wifi-outline" text={t('rapport.noSessionData')} />;
  return (
    <View style={{ gap: 12 }}>
      <Row style={{ gap: space.sm }}>
        <Kpi icon="pulse-outline" iconColor={theme.primary} value={`${data.totalSessions}`} label={t('rapport.totalSessions')} />
        <Kpi icon="wifi-outline" iconColor={theme.success} value={`${data.activeSessions}`} label={t('rapport.activeSessions')} />
        <Kpi icon="time-outline" iconColor={theme.warning} value={data.averageDurationMinutes != null ? `${data.averageDurationMinutes} min` : '—'} label={t('rapport.avgDuration')} />
      </Row>
      <Card style={{ gap: 8 }}>
        <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
          {t('rapport.dataUsage')}
        </Text>
        <Row style={{ justifyContent: 'flex-start', gap: 16 }}>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Row style={{ gap: 4 }}>
              <Ionicons name="arrow-down-outline" size={14} color={theme.success} />
              <Mono style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>{fmtBytes(data.totalBytesIn)}</Mono>
            </Row>
            <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('rapport.download')}</Text>
          </View>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Row style={{ gap: 4 }}>
              <Ionicons name="arrow-up-outline" size={14} color={theme.primary} />
              <Mono style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>{fmtBytes(data.totalBytesOut)}</Mono>
            </Row>
            <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('rapport.upload')}</Text>
          </View>
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Mono style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>{fmtBytes(data.totalBytes)}</Mono>
            <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('rapport.total')}</Text>
          </View>
        </Row>
      </Card>
      {data.byRouter.length > 1 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
            {t('rapport.sessionsByRouter')}
          </Text>
          {data.byRouter.slice(0, 5).map((r) => (
            <Row key={r.routerId} style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 10 }}>
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>{r.routerName}</Text>
              <Mono style={{ color: theme.textMuted, fontSize: 11 }}>{r.sessionCount} sess.</Mono>
              <Mono style={{ color: theme.textMuted, fontSize: 11, marginLeft: 8 }}>{fmtBytes((BigInt(r.bytesIn) + BigInt(r.bytesOut)).toString())}</Mono>
            </Row>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function RapportScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { routerId } = useLocalSearchParams<{ routerId?: string }>();
  const { activeRouterId } = useActiveRouter();
  const navHeight = useBottomNavHeight();
  const qc = useQueryClient();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = screenWidth - space.lg * 2 - space.lg * 2 - 40;
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>('last30days');
  const [refreshing, setRefreshing] = useState(false);
  const METRICS_BY_ANALYTICS: Record<AnalyticsPeriod, MetricsPeriod> = {
    today: 'today',
    yesterday: 'today',
    last7days: '7d',
    last30days: '30d',
    currentWeek: '7d',
    currentMonth: '30d',
    custom: '30d',
  };
  const period = METRICS_BY_ANALYTICS[analyticsPeriod];

  const PERIODS = PERIOD_KEYS.map((p) => ({ value: p.value, label: t(p.key) }));
  const AP = ANALYTICS_PERIODS.map((p) => ({ value: p.value, label: t(p.key) }));

  const confidenceLabel = (key: string) => {
    const map: Record<string, string> = {
      HIGH: t('rapport.confidenceHigh'),
      MEDIUM: t('rapport.confidenceMedium'),
      LOW: t('rapport.confidenceLow'),
      INSUFFICIENT_DATA: t('rapport.insufficientData'),
      UNAVAILABLE: t('common.unavailable'),
    };
    return map[key] ?? key;
  };

  const metrics = useQuery({
    queryKey: ['metrics', period, routerId],
    queryFn: () => api.metrics.summary(period, routerId),
    placeholderData: keepPreviousData,
  });
  const clients = useQuery({
    queryKey: ['clients', routerId],
    queryFn: () => api.metrics.recentClients(30, routerId),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });
  const revenueByPeriod = useQuery({
    queryKey: ['accounting', 'revenue-period'],
    queryFn: () => api.accounting.revenueByPeriod(12),
  });
  const revenueByRouter = useQuery({
    queryKey: ['accounting', 'revenue-router'],
    queryFn: () => api.accounting.revenueByRouter(),
  });
  const overview = useQuery({
    queryKey: ['analytics', 'overview', analyticsPeriod, routerId],
    queryFn: () => api.analytics.overview({ period: analyticsPeriod, routerId }),
    placeholderData: keepPreviousData,
  });
  const analyticsRouters = useQuery({
    queryKey: ['analytics', 'routers', analyticsPeriod],
    queryFn: () => api.analytics.routers({ period: analyticsPeriod }),
    placeholderData: keepPreviousData,
  });
  const traffic = useQuery({
    queryKey: ['analytics', 'traffic', analyticsPeriod, routerId],
    queryFn: () => api.analytics.traffic({ period: analyticsPeriod, routerId }),
    placeholderData: keepPreviousData,
  });
  const forecast = useQuery({
    queryKey: ['analytics', 'forecast', routerId],
    queryFn: () => api.analytics.forecast({ routerId }),
    placeholderData: keepPreviousData,
  });
  const forecastTraffic = useQuery({
    queryKey: ['analytics', 'forecast-traffic', routerId],
    queryFn: () => api.analytics.forecastTraffic(routerId),
    placeholderData: keepPreviousData,
  });
  const sessionStats = useQuery({
    queryKey: ['analytics', 'sessions', analyticsPeriod, routerId],
    queryFn: () => api.analytics.sessionStats({ period: analyticsPeriod, routerId }),
    placeholderData: keepPreviousData,
  });
  const insights = useQuery({
    queryKey: ['analytics', 'insights'],
    queryFn: () => api.analytics.insights(),
    placeholderData: keepPreviousData,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['metrics'] }),
      qc.invalidateQueries({ queryKey: ['clients'] }),
      qc.invalidateQueries({ queryKey: ['accounting'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
      qc.invalidateQueries({ queryKey: ['analytics', 'sessions'] }),
    ]);
    setRefreshing(false);
  }, [qc]);

  const data = metrics.data;

  // Taux de conversion : sur 100 tickets générés, combien ont réellement été
  // vendus/utilisés — le signal le plus direct de gaspillage d'impression.
  const conversionPct = useMemo(() => {
    if (!data || data.ticketsGenerated === 0) return null;
    return Math.round((data.ticketsUsed / data.ticketsGenerated) * 100);
  }, [data]);

  const arpu = useMemo(() => {
    if (!data || data.ticketsUsed === 0) return null;
    return Math.round(data.revenueXof / data.ticketsUsed);
  }, [data]);

  const revenuePerRouter = useMemo(() => {
    const rs = overview.data?.routersSummary;
    if (!rs?.length || !overview.data) return null;
    return Math.round(overview.data.revenueXof / rs.length);
  }, [overview.data]);

  const revenuePerDay = useMemo(() => {
    const ts = overview.data?.timeSeries;
    if (!ts?.length || !overview.data) return null;
    return Math.round(overview.data.revenueXof / ts.length);
  }, [overview.data]);

  const error = metrics.error || revenueByPeriod.error || revenueByRouter.error;
  const loading = metrics.isLoading || revenueByPeriod.isLoading || revenueByRouter.isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('rapport.title')} back={Boolean(activeRouterId)} />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{
          padding: space.lg,
          gap: space.lg,
          paddingBottom: navHeight,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.text} />
        }
      >
        <FadeIn>
          <Row>
            <View style={{ flex: 1 }}>
              <Subtitle>{t('rapport.subtitle')}</Subtitle>
            </View>
            <Row style={{ gap: 8 }}>
              <Press
                onPress={() => {
                  if (!data) return;
                  const periodLabel = PERIODS.find((p) => p.value === period)!.label;
                  exportMetricsCsv(data, periodLabel, sessionStats.data);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <Ionicons name="document-text-outline" size={14} color={theme.secondary} />
                <Text style={{ color: theme.secondary, fontSize: 11, fontWeight: '700' }}>CSV</Text>
              </Press>
              <Press
                onPress={() => {
                  if (!data) return;
                  const periodLabel = PERIODS.find((p) => p.value === period)!.label;
                  exportMetricsPdf(data, periodLabel, sessionStats.data, overview.data);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: theme.primary,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                <Ionicons name="download-outline" size={14} color={theme.primaryText} />
                <Text style={{ color: theme.primaryText, fontSize: 11, fontWeight: '700' }}>PDF</Text>
              </Press>
            </Row>
          </Row>
        </FadeIn>

        {error ? (
          <ErrorState message={t('rapport.loadError')} onRetry={onRefresh} />
        ) : (
          <>
            {/* Filtre de période — pilote tous les KPIs et graphiques. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 16,
                padding: 4,
              }}
              contentContainerStyle={{ gap: 4 }}
            >
              {AP.map((p) => {
                const active = p.value === analyticsPeriod;
                return (
                  <Press
                    key={p.value}
                    onPress={() => setAnalyticsPeriod(p.value)}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      alignItems: 'center',
                      backgroundColor: active ? theme.primary : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        color: active ? theme.primaryText : theme.textMuted,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    >
                      {p.label}
                    </Text>
                  </Press>
                );
              })}
            </ScrollView>

            {/* Chiffre d'affaires + tendance */}
            <FadeIn delay={50}>
            <AuroraCard style={{ gap: 10, padding: space.xl }}>
              <Text
                style={{ color: withAlpha('#FFFFFF', 0.7), fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}
              >
                {t('rapport.revenue')}
              </Text>
              {metrics.isLoading ? (
                <Skeleton height={36} width="60%" />
              ) : (
                <AnimatedNumber
                  value={data?.revenueXof ?? 0}
                  format={(n) => fmtXof(n)}
                  style={{ color: '#FFFFFF', fontSize: 34, fontWeight: '900', fontFamily: theme.mono }}
                />
              )}
              {data?.trendPct != null ? (
                (() => {
                  const up = data.trendPct >= 0;
                  return (
                    <Row style={{ justifyContent: 'flex-start', gap: space.xs + 2 }}>
                      <View style={{ backgroundColor: withAlpha('#FFFFFF', 0.2), borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Ionicons name={up ? 'trending-up' : 'trending-down'} size={14} color="#FFFFFF" />
                        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
                          {up ? '+' : ''}{data.trendPct.toFixed(0)}%
                        </Text>
                      </View>
                      <Text style={{ color: withAlpha('#FFFFFF', 0.7), fontSize: 11, flex: 1 }}>
                        {t('rapport.vsPrevious', { pct: data.trendPct.toFixed(0), count: data.ticketsUsed })}
                      </Text>
                    </Row>
                  );
                })()
              ) : null}
            </AuroraCard>
            </FadeIn>

            {data?.dataQuality && data.dataQuality !== 'EXACT' ? (
              <Card style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'flex-start', gap: 6 }}>
                  <Badge
                    label={
                      data.dataQuality === 'ESTIMATED'
                        ? t('rapport.dataEstimated')
                        : data.dataQuality === 'MIXED'
                          ? t('rapport.dataMixed')
                          : data.dataQuality === 'INCOMPLETE'
                            ? t('rapport.dataIncomplete')
                            : t('rapport.dataNoData')
                    }
                    tone={data.dataQuality === 'NO_DATA' ? 'muted' : 'warning'}
                  />
                  {data.exactRevenueXof != null && data.estimatedRevenueXof != null ? (
                    <Text style={{ color: theme.textMuted, fontSize: 11, flex: 1 }}>
                      {t('rapport.exactLabel')} : {fmtXof(data.exactRevenueXof)} · {t('rapport.estimatedLabel')} : {fmtXof(data.estimatedRevenueXof)}
                    </Text>
                  ) : null}
                </Row>
                {data.dataQuality === 'ESTIMATED' || data.dataQuality === 'MIXED' ? (
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                    {t('rapport.estimatedNote')}
                  </Text>
                ) : null}
                {(data.unknownSalesCount ?? 0) > 0 || (data.invalidSourceCount ?? 0) > 0 ? (
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                    {(data.unknownSalesCount ?? 0) > 0
                      ? t('rapport.unknownSalesCount', { count: data.unknownSalesCount })
                      : ''}
                    {(data.unknownSalesCount ?? 0) > 0 && (data.invalidSourceCount ?? 0) > 0 ? ' · ' : ''}
                    {(data.invalidSourceCount ?? 0) > 0
                      ? t('rapport.invalidSourceCount', { count: data.invalidSourceCount })
                      : ''}
                  </Text>
                ) : null}
              </Card>
            ) : null}

            {/* KPIs business */}
            <FadeIn delay={100}>
              <Row style={{ gap: space.sm }}>
                <Kpi
                  icon="swap-horizontal-outline"
                  iconColor={theme.primary}
                  value={conversionPct != null ? `${conversionPct}%` : '—'}
                  label={t('rapport.conversionRate')}
                />
                <Kpi
                  icon="pricetag-outline"
                  iconColor={theme.warning}
                  value={arpu != null ? fmtXof(arpu) : '—'}
                  label={t('rapport.avgBasket')}
                />
                <Kpi
                  icon="people-outline"
                  iconColor={theme.success}
                  value={`${data?.activeSessions ?? 0}`}
                  label={t('rapport.onlineNow')}
                />
              </Row>
            </FadeIn>

            <FadeIn delay={110}>
              <Row style={{ gap: space.sm }}>
                <Kpi
                  icon="calendar-outline"
                  iconColor={theme.secondary ?? theme.primary}
                  value={revenuePerDay != null ? fmtXof(revenuePerDay) : '—'}
                  label={t('rapport.avgDailyRevenue')}
                />
                <Kpi
                  icon="hardware-chip-outline"
                  iconColor={theme.primarySoft}
                  value={revenuePerRouter != null ? fmtXof(revenuePerRouter) : '—'}
                  label={t('rapport.avgRevenuePerRouter')}
                />
              </Row>
            </FadeIn>

            {/* CA journalier */}
            <FadeIn delay={120}>
            <Card style={{ gap: 12 }}>
              <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                <Ionicons name="calendar-outline" size={16} color={theme.primary} />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                  {t('rapport.dailyRevenue')}
                </Text>
              </Row>
              {overview.isLoading ? (
                <Skeleton height={160} />
              ) : (
                <DailyRevenueChart data={overview.data?.timeSeries ?? []} t={t} chartWidth={chartWidth} />
              )}
            </Card>
            </FadeIn>

            {/* Pic de connexions par heure */}
            <FadeIn delay={135}>
            <Card style={{ gap: 12 }}>
              <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                <Ionicons name="flame-outline" size={16} color={theme.warning} />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                  {t('rapport.peakHours')}
                </Text>
              </Row>
              {overview.isLoading ? (
                <Skeleton height={140} />
              ) : (
                <PeakHoursChart data={overview.data?.peakHours ?? []} t={t} chartWidth={chartWidth} />
              )}
            </Card>
            </FadeIn>

            {/* Tendance CA sur 6 mois */}
            <FadeIn delay={150}>
            <Card style={{ gap: 12 }}>
              <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                <Ionicons name="trending-up-outline" size={16} color={theme.primary} />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                  {t('rapport.revenueTrend')}
                </Text>
              </Row>
              {loading ? (
                <Skeleton height={160} />
              ) : (
                <MonthlyRevenueChart data={revenueByPeriod.data ?? []} t={t} chartWidth={chartWidth} />
              )}
            </Card>
            </FadeIn>

            {/* Répartition par forfait */}
            <FadeIn delay={200}>
            <Card style={{ gap: 12 }}>
              <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                <Ionicons name="pie-chart-outline" size={16} color={theme.primary} />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                  {t('rapport.planBreakdown')}
                </Text>
              </Row>
              {metrics.isLoading ? <Skeleton height={100} /> : <PlanPieChart data={data?.byPlan ?? []} t={t} />}
            </Card>
            </FadeIn>

            {/* CA par routeur — utile dès 2+ points de vente pour repérer le
                routeur qui sous-performe. */}
            {(revenueByRouter.data?.length ?? 0) > 1 ? (
              <Card style={{ gap: 12 }}>
                <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                  <Ionicons name="hardware-chip-outline" size={16} color={theme.primary} />
                  <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                    {t('rapport.revenueByRouter')}
                  </Text>
                </Row>
                {loading ? (
                  <Skeleton height={140} />
                ) : (
                  <RouterRankingChart data={revenueByRouter.data ?? []} t={t} chartWidth={chartWidth} />
                )}
              </Card>
            ) : null}

            {/* Classement routeurs (Analytics) — accès au détail par routeur */}
            <FadeIn delay={250}>
            <View style={{ gap: 10 }}>
              <SectionDivider icon="hardware-chip-outline" label={t('rapport.routersSection')} color={theme.primary} />
              {overview.isLoading && analyticsRouters.isLoading ? (
                <Skeleton height={100} />
              ) : overview.error || analyticsRouters.error ? (
                <ErrorState message={t('rapport.routersLoadError')} onRetry={onRefresh} />
              ) : (
                <RoutersRankingSection
                  data={analyticsRouters.data ?? []}
                  onSelect={(id) => router.push(`/analytics-router/${id}?period=${analyticsPeriod}`)}
                  t={t}
                />
              )}
            </View>

            </FadeIn>

            {/* Forfaits — double classement (volume vs contribution CA) */}
            <FadeIn delay={300}>
            <View style={{ gap: 10 }}>
              <SectionDivider icon="pricetags-outline" label={t('rapport.plansSection')} color={theme.warning} />
              {overview.isLoading ? (
                <Skeleton height={140} />
              ) : overview.error ? (
                <ErrorState message={t('rapport.plansLoadError')} onRetry={onRefresh} />
              ) : (
                <Card style={{ gap: 8 }}>
                  <PlansDualRankingSection data={overview.data?.topPlans ?? []} t={t} />
                </Card>
              )}
            </View>

            </FadeIn>

            {/* Affluence : jours/heures d'activité, ventes vs sessions séparées */}
            <FadeIn delay={350}>
            <View style={{ gap: 10 }}>
              <SectionDivider icon="time-outline" label={t('rapport.affluence')} color={theme.success} />
              {traffic.isLoading ? (
                <Skeleton height={80} />
              ) : traffic.error ? (
                <ErrorState message={t('rapport.affluenceLoadError')} onRetry={onRefresh} />
              ) : (
                <Card>
                  <AffluenceSection
                    salesHeatmap={traffic.data?.salesHeatmap ?? []}
                    sessionsHeatmap={traffic.data?.sessionsHeatmap ?? []}
                    t={t}
                  />
                </Card>
              )}
            </View>

            </FadeIn>

            {/* Sessions et utilisation réseau */}
            <FadeIn delay={400}>
            <View style={{ gap: 10 }}>
              <SectionDivider icon="wifi-outline" label={t('rapport.sessionsSection')} color={theme.primary} />
              {sessionStats.error ? (
                <ErrorState message={t('rapport.sessionsLoadError')} onRetry={onRefresh} />
              ) : (
                <SessionStatsSection data={sessionStats.data} t={t} />
              )}
            </View>

            </FadeIn>

            {/* Tendances et prévisions BI explicables */}
            <FadeIn delay={450}>
            <View style={{ gap: 10 }}>
              <SectionDivider icon="analytics-outline" label={t('rapport.trends')} color={theme.secondary ?? theme.primary} />
              {forecast.error ? (
                <ErrorState message={t('rapport.trendsLoadError')} onRetry={onRefresh} />
              ) : (
                <Card>
                  <TrendsSection forecast={forecast.data} />
                </Card>
              )}
            </View>
            </FadeIn>

            <FadeIn delay={500}>
            <View style={{ gap: 10 }}>
              <SectionDivider icon="sparkles-outline" label={t('rapport.forecasts')} color={theme.warning} />
              {forecast.isLoading ? (
                <Skeleton height={160} />
              ) : forecast.error ? (
                <ErrorState message={t('rapport.forecastLoadError')} onRetry={onRefresh} />
              ) : forecast.data?.revenueForecast.confidence === 'INSUFFICIENT_DATA' ? (
                <Empty icon="calendar-outline" text={t('rapport.insufficientDataMsg')} />
              ) : (
                <Card style={{ gap: 16 }}>
                  <ForecastPointsSection points={forecast.data?.revenueForecast.points ?? []} metricLabel={t('rapport.revenueForecastLabel')} />
                  <ForecastPointsSection points={forecast.data?.salesForecast.points ?? []} metricLabel={t('rapport.salesForecastLabel')} />
                </Card>
              )}
            </View>
            </FadeIn>

            <FadeIn delay={550}>
            <View style={{ gap: 10 }}>
              <SectionDivider icon="navigate-outline" label={t('rapport.predictedTraffic')} color={theme.success} />
              {forecastTraffic.error ? (
                <ErrorState message={t('rapport.predictedTrafficLoadError')} onRetry={onRefresh} />
              ) : (
                <Card>
                  <PredictedTrafficSection data={forecastTraffic.data} />
                </Card>
              )}
            </View>
            </FadeIn>

            <FadeIn delay={600}>
            <View style={{ gap: 10 }}>
              <SectionDivider icon="bulb-outline" label={t('rapport.insights')} color={theme.warning} />
              {insights.error ? (
                <ErrorState message={t('rapport.insightsLoadError')} onRetry={onRefresh} />
              ) : (
                <InsightsSection insights={insights.data} />
              )}
            </View>
            </FadeIn>

            {/* Clients récents */}
            <FadeIn delay={650}>
            <View style={{ gap: 10 }}>
              <SectionDivider icon="people-outline" label={t('rapport.recentClients')} color={theme.primary} />
              {!clients.data?.length ? (
                <Empty icon="people-outline" text={t('rapport.noTicketUsed')} />
              ) : (
                <View style={{ gap: 8 }}>
                  {clients.data.map((c) => (
                    <View key={c.voucherId} style={{
                      backgroundColor: theme.surface,
                      borderWidth: 1, borderColor: theme.border,
                      borderRadius: 14, padding: 12, gap: 6,
                      borderLeftWidth: 3,
                      borderLeftColor: c.online ? theme.success : withAlpha(theme.textMuted, 0.3),
                    }}>
                      <Row>
                        <Row style={{ gap: 6, flex: 1, justifyContent: 'flex-start' }}>
                          <View style={{
                            width: 8, height: 8, borderRadius: 4,
                            backgroundColor: c.online ? theme.success : withAlpha(theme.textMuted, 0.3),
                          }} />
                          <Mono style={{ color: theme.text, fontSize: 14, fontWeight: weight.bold }}>{c.code}</Mono>
                        </Row>
                        <Badge
                          label={c.online ? t('rapport.online') : t('rapport.used')}
                          tone={c.online ? 'success' : 'muted'}
                        />
                      </Row>
                      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
                        <Text style={{ color: theme.textMuted, fontSize: 11 }}>{c.planName}</Text>
                        <Mono style={{ color: theme.success, fontSize: 11, fontWeight: '700' }}>{fmtXof(c.priceXof)}</Mono>
                        <Text style={{ color: theme.textMuted, fontSize: 11 }}>{c.routerName}</Text>
                      </Row>
                      {c.macAddress || c.ipAddress ? (
                        <Mono style={{ color: withAlpha(theme.textMuted, 0.6), fontSize: 10 }}>
                          {[c.ipAddress, c.macAddress].filter(Boolean).join(' · ')}
                        </Mono>
                      ) : null}
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
