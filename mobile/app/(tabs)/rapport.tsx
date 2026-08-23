import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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
} from '@/src/lib/api';
import { exportMetricsCsv } from '@/src/lib/metricsCsv';
import { busiestCell, describeBusiest, fmtGrowth } from '@/src/lib/analyticsFormat';
import {
  Badge,
  Card,
  Empty,
  ErrorState,
  icon,
  Mono,
  Press,
  Row,
  SectionTitle,
  Skeleton,
  space,
  Subtitle,
  theme,
  Title,
  type,
  weight,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';
import { useActiveRouter } from '@/src/providers/active-router-provider';

const PERIODS: { label: string; value: MetricsPeriod }[] = [
  { label: "Aujourd'hui", value: 'today' },
  { label: 'Cette Semaine', value: '7d' },
  { label: 'Ce Mois', value: '30d' },
];

const PLAN_COLORS = [theme.primary, theme.success, theme.warning, theme.danger, '#38BDF8', '#F472B6'];

function fmtXof(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' F';
}

/** KPI card: value + label, optionally a trend chip. */
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
  return (
    <Card style={{ flex: 1, alignItems: 'center', gap: 4, minWidth: 0 }}>
      <Ionicons name={iconName} size={20} color={iconColor} />
      <Text
        style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: weight.bold }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center' }}>{label}</Text>
    </Card>
  );
}

function MonthlyRevenueChart({ data }: { data: RevenueByPeriodItem[] }) {
  const recent = data.slice(-6);
  if (!recent.length) {
    return <Empty icon="bar-chart-outline" text="Pas encore de ventes à afficher." />;
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
        width={280}
        height={140}
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

function PlanPieChart({ data }: { data: { planId: string; planName: string; revenueXof: number; sold: number }[] }) {
  if (!data.length) {
    return <Empty icon="pie-chart-outline" text="Aucune vente sur cette période." />;
  }
  const total = data.reduce((s, p) => s + p.revenueXof, 0) || 1;
  const slices = data.map((p, idx) => ({
    value: p.revenueXof,
    color: PLAN_COLORS[idx % PLAN_COLORS.length],
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
                backgroundColor: PLAN_COLORS[idx % PLAN_COLORS.length],
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

function RouterRankingChart({ data }: { data: RevenueByRouterItem[] }) {
  if (!data.length) {
    return <Empty icon="hardware-chip-outline" text="Aucune donnée par routeur." />;
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
        width={280}
        height={140}
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
}: {
  data: AnalyticsRouterSummary[];
  onSelect: (routerId: string) => void;
}) {
  if (!data.length) {
    return <Empty icon="hardware-chip-outline" text="Aucun routeur avec des ventes sur cette période." />;
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
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>{r.salesCount} vente(s)</Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>{r.contributionPercent.toFixed(0)}% du CA</Text>
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
function PlansDualRankingSection({ data }: { data: AnalyticsPlanPerformance[] }) {
  if (!data.length) {
    return <Empty icon="pricetags-outline" text="Aucune vente de forfait sur cette période." />;
  }
  const byRevenue = [...data].sort((a, b) => b.revenueXof - a.revenueXof).slice(0, 5);
  const bySales = [...data].sort((a, b) => b.salesCount - a.salesCount).slice(0, 5);

  const renderPlan = (p: AnalyticsPlanPerformance, metric: 'revenue' | 'sales') => {
    const growth = fmtGrowth(p.growthPercent);
    const sentence =
      metric === 'revenue'
        ? `Ce forfait représente ${p.revenueContributionPercent.toFixed(0)} % du chiffre d'affaires de la période.`
        : `Ce forfait représente ${p.salesContributionPercent.toFixed(0)} % des ventes de la période.`;
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
            Son volume {p.growthPercent! >= 0 ? 'augmente' : 'baisse'} de {Math.abs(p.growthPercent!).toFixed(0)} % par
            rapport à la période précédente.
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: 16 }}>
      <View>
        <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 }}>
          TOP PAR CHIFFRE D&apos;AFFAIRES
        </Text>
        {byRevenue.map((p) => renderPlan(p, 'revenue'))}
      </View>
      <View>
        <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 }}>
          TOP PAR VOLUME DE VENTES
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
}: {
  salesHeatmap: { dayOfWeek: number; hour: number; count: number }[];
  sessionsHeatmap: { dayOfWeek: number; hour: number; count: number }[];
}) {
  const busiestSales = busiestCell(salesHeatmap);
  const busiestSessions = busiestCell(sessionsHeatmap);
  return (
    <View style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Ionicons name="cart-outline" size={16} color={theme.primary} />
        <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
          Pic de ventes : {describeBusiest(busiestSales)}
        </Text>
      </Row>
      <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
        <Ionicons name="wifi-outline" size={16} color={theme.primarySoft} />
        <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
          Pic de sessions réseau : {describeBusiest(busiestSessions)}
        </Text>
      </Row>
    </View>
  );
}

export default function RapportScreen() {
  const { routerId } = useLocalSearchParams<{ routerId?: string }>();
  const { activeRouterId } = useActiveRouter();
  const navHeight = useBottomNavHeight();
  const qc = useQueryClient();
  const router = useRouter();
  const [period, setPeriod] = useState<MetricsPeriod>('30d');
  const [refreshing, setRefreshing] = useState(false);
  const analyticsPeriod = ANALYTICS_PERIOD_BY_METRICS_PERIOD[period];

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['metrics'] }),
      qc.invalidateQueries({ queryKey: ['clients'] }),
      qc.invalidateQueries({ queryKey: ['accounting'] }),
      qc.invalidateQueries({ queryKey: ['analytics'] }),
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

  const error = metrics.error || revenueByPeriod.error || revenueByRouter.error;
  const loading = metrics.isLoading || revenueByPeriod.isLoading || revenueByRouter.isLoading;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Rapport & performance" back={Boolean(activeRouterId)} />
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
        <Row>
          <View style={{ flex: 1 }}>
            <Title>Rapport & performance</Title>
            <Subtitle>Ventes de tickets WiFi, revenu, et santé de votre activité.</Subtitle>
          </View>
          <Press
            onPress={() => {
              if (!data) return;
              const periodLabel = PERIODS.find((p) => p.value === period)!.label;
              exportMetricsCsv(data, periodLabel);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 12,
              paddingHorizontal: 10,
              paddingVertical: 10,
            }}
          >
            <Ionicons name="download-outline" size={16} color={theme.secondary} />
          </Press>
        </Row>

        {error ? (
          <ErrorState message="Impossible de charger les données." onRetry={onRefresh} />
        ) : (
          <>
            {/* Filtre de période — pilote les KPIs court terme (CA, conversion, ARPU). */}
            <Row
              style={{
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 16,
                padding: 6,
                gap: 4,
              }}
            >
              {PERIODS.map((p) => {
                const active = p.value === period;
                return (
                  <Press
                    key={p.value}
                    onPress={() => setPeriod(p.value)}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
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
            </Row>

            {/* Chiffre d'affaires + tendance */}
            <Card style={{ gap: 8 }}>
              <Text
                style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}
              >
                CHIFFRE D&apos;AFFAIRES
              </Text>
              <Mono style={{ color: theme.success, fontSize: 30, fontWeight: '900' }}>
                {metrics.isLoading ? '…' : fmtXof(data?.revenueXof ?? 0)}
              </Mono>
              {data?.trendPct != null ? (
                (() => {
                  const up = data.trendPct >= 0;
                  const trendColor = up ? theme.success : theme.danger;
                  return (
                    <Row style={{ justifyContent: 'flex-start', gap: space.xs + 2 }}>
                      <Ionicons name={up ? 'trending-up' : 'trending-down'} size={icon.sm} color={trendColor} />
                      <Text style={{ color: trendColor, fontSize: type.caption, flex: 1 }}>
                        {up ? '+' : ''}
                        {data.trendPct.toFixed(0)}% vs période précédente ({data.ticketsUsed} tickets vendus)
                      </Text>
                    </Row>
                  );
                })()
              ) : null}

              {data?.dataQuality && data.dataQuality !== 'EXACT' ? (
                <View style={{ gap: 6 }}>
                  <Row style={{ justifyContent: 'flex-start', gap: 6 }}>
                    <Badge
                      label={
                        data.dataQuality === 'ESTIMATED'
                          ? 'Estimé'
                          : data.dataQuality === 'MIXED'
                            ? 'Partiellement estimé'
                            : data.dataQuality === 'INCOMPLETE'
                              ? 'Incomplet'
                              : 'Aucune donnée'
                      }
                      tone={data.dataQuality === 'NO_DATA' ? 'muted' : 'warning'}
                    />
                    {data.exactRevenueXof != null && data.estimatedRevenueXof != null ? (
                      <Text style={{ color: theme.textMuted, fontSize: 11, flex: 1 }}>
                        Exact : {fmtXof(data.exactRevenueXof)} · Estimé : {fmtXof(data.estimatedRevenueXof)}
                      </Text>
                    ) : null}
                  </Row>
                  {data.dataQuality === 'ESTIMATED' || data.dataQuality === 'MIXED' ? (
                    <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                      Une partie de ce chiffre d&apos;affaires est estimée à partir du prix actuel des forfaits.
                    </Text>
                  ) : null}
                  {(data.unknownSalesCount ?? 0) > 0 || (data.invalidSourceCount ?? 0) > 0 ? (
                    <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                      {(data.unknownSalesCount ?? 0) > 0
                        ? `${data.unknownSalesCount} vente(s) de provenance inconnue`
                        : ''}
                      {(data.unknownSalesCount ?? 0) > 0 && (data.invalidSourceCount ?? 0) > 0 ? ' · ' : ''}
                      {(data.invalidSourceCount ?? 0) > 0
                        ? `${data.invalidSourceCount} donnée(s) invalide(s)`
                        : ''}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Card>

            {/* KPIs business : conversion et panier moyen, les deux métriques
                qu'un opérateur ne peut pas lire ailleurs dans l'app. */}
            <Row style={{ gap: space.sm }}>
              <Kpi
                icon="swap-horizontal-outline"
                iconColor={theme.primary}
                value={conversionPct != null ? `${conversionPct}%` : '—'}
                label="Taux de conversion"
              />
              <Kpi
                icon="pricetag-outline"
                iconColor={theme.warning}
                value={arpu != null ? fmtXof(arpu) : '—'}
                label="Panier moyen"
              />
              <Kpi
                icon="people-outline"
                iconColor={theme.success}
                value={`${data?.activeSessions ?? 0}`}
                label="En ligne maintenant"
              />
            </Row>

            {/* Tendance CA sur 6 mois */}
            <Card style={{ gap: 12 }}>
              <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                <Ionicons name="trending-up-outline" size={16} color={theme.primary} />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                  Tendance CA (6 derniers mois)
                </Text>
              </Row>
              {loading ? (
                <Skeleton height={140} />
              ) : (
                <MonthlyRevenueChart data={revenueByPeriod.data ?? []} />
              )}
            </Card>

            {/* Répartition par forfait */}
            <Card style={{ gap: 12 }}>
              <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                <Ionicons name="pie-chart-outline" size={16} color={theme.primary} />
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                  Répartition par forfait
                </Text>
              </Row>
              {metrics.isLoading ? <Skeleton height={100} /> : <PlanPieChart data={data?.byPlan ?? []} />}
            </Card>

            {/* CA par routeur — utile dès 2+ points de vente pour repérer le
                routeur qui sous-performe. */}
            {(revenueByRouter.data?.length ?? 0) > 1 ? (
              <Card style={{ gap: 12 }}>
                <Row style={{ gap: 8, justifyContent: 'flex-start' }}>
                  <Ionicons name="hardware-chip-outline" size={16} color={theme.primary} />
                  <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
                    CA par routeur
                  </Text>
                </Row>
                {loading ? (
                  <Skeleton height={140} />
                ) : (
                  <RouterRankingChart data={revenueByRouter.data ?? []} />
                )}
              </Card>
            ) : null}

            {/* Classement routeurs (Analytics) — accès au détail par routeur */}
            <View>
              <SectionTitle>Routeurs</SectionTitle>
              {overview.isLoading && analyticsRouters.isLoading ? (
                <Skeleton height={100} />
              ) : overview.error || analyticsRouters.error ? (
                <ErrorState message="Impossible de charger le classement des routeurs." onRetry={onRefresh} />
              ) : (
                <RoutersRankingSection
                  data={analyticsRouters.data ?? []}
                  onSelect={(id) => router.push(`/analytics-router/${id}?period=${analyticsPeriod}`)}
                />
              )}
            </View>

            {/* Forfaits — double classement (volume vs contribution CA) */}
            <View>
              <SectionTitle>Forfaits</SectionTitle>
              {overview.isLoading ? (
                <Skeleton height={140} />
              ) : overview.error ? (
                <ErrorState message="Impossible de charger l'analyse des forfaits." onRetry={onRefresh} />
              ) : (
                <Card style={{ gap: 8 }}>
                  <PlansDualRankingSection data={overview.data?.topPlans ?? []} />
                </Card>
              )}
            </View>

            {/* Affluence : jours/heures d'activité, ventes vs sessions séparées */}
            <View>
              <SectionTitle>Affluence</SectionTitle>
              {traffic.isLoading ? (
                <Skeleton height={80} />
              ) : traffic.error ? (
                <ErrorState message="Impossible de charger l'affluence." onRetry={onRefresh} />
              ) : (
                <Card>
                  <AffluenceSection
                    salesHeatmap={traffic.data?.salesHeatmap ?? []}
                    sessionsHeatmap={traffic.data?.sessionsHeatmap ?? []}
                  />
                </Card>
              )}
            </View>

            {/* Clients récents */}
            <View>
              <SectionTitle>Clients récents</SectionTitle>
              {!clients.data?.length ? (
                <Empty icon="people-outline" text="Aucun ticket utilisé pour le moment." />
              ) : (
                <View style={{ gap: 12 }}>
                  {clients.data.map((c) => (
                    <Card key={c.voucherId} style={{ gap: 6 }}>
                      <Row>
                        <Mono style={{ color: theme.text, fontSize: 15 }}>{c.code}</Mono>
                        <Badge
                          label={c.online ? 'En ligne' : 'Utilisé'}
                          tone={c.online ? 'success' : 'muted'}
                        />
                      </Row>
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                        {c.planName} · {fmtXof(c.priceXof)} · {c.routerName}
                      </Text>
                      {c.macAddress || c.ipAddress ? (
                        <Mono style={{ color: theme.textMuted, fontSize: 11 }}>
                          {[c.ipAddress, c.macAddress].filter(Boolean).join(' · ')}
                        </Mono>
                      ) : null}
                    </Card>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
      <BottomNav active="rapport" />
    </View>
  );
}
