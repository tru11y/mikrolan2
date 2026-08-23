import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LineChart } from 'react-native-gifted-charts';
import { api, type AnalyticsPeriod } from '@/src/lib/api';
import { busiestCell, describeBusiest, fmtGrowth, fmtXof } from '@/src/lib/analyticsFormat';
import {
  Badge,
  Card,
  Empty,
  ErrorState,
  Mono,
  Row,
  SectionTitle,
  Skeleton,
  space,
  Subtitle,
  theme,
  Title,
} from '@/src/components/ui';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';
import { AppHeader } from '@/src/components/AppHeader';

const ALLOWED_PERIODS: AnalyticsPeriod[] = [
  'today',
  'yesterday',
  'last7days',
  'last30days',
  'currentWeek',
  'currentMonth',
];

export default function AnalyticsRouterDetailScreen() {
  const { id, period: periodParam } = useLocalSearchParams<{ id: string; period?: string }>();
  const navHeight = useBottomNavHeight();
  const [period] = useState<AnalyticsPeriod>(
    ALLOWED_PERIODS.includes(periodParam as AnalyticsPeriod) ? (periodParam as AnalyticsPeriod) : 'last30days',
  );

  const detail = useQuery({
    queryKey: ['analytics', 'router-detail', id, period],
    queryFn: () => api.analytics.routerDetail(id!, { period }),
    enabled: Boolean(id),
  });

  const data = detail.data;
  const busiestSales = data ? busiestCell(data.salesHeatmap) : null;
  const busiestSessions = data ? busiestCell(data.sessionsHeatmap) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={data?.routerName ?? 'Détail routeur'} back />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: navHeight }}
      >
        {detail.isLoading ? (
          <>
            <Skeleton height={100} />
            <Skeleton height={140} />
            <Skeleton height={140} />
          </>
        ) : detail.error ? (
          <ErrorState message="Impossible de charger le détail de ce routeur." onRetry={() => detail.refetch()} />
        ) : !data ? (
          <Empty icon="hardware-chip-outline" text="Aucune donnée disponible." />
        ) : (
          <>
            <View>
              <Title>{data.routerName}</Title>
              <Subtitle>Performance sur la période sélectionnée.</Subtitle>
            </View>

            <Card style={{ gap: 8 }}>
              <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                CHIFFRE D&apos;AFFAIRES
              </Text>
              <Mono style={{ color: theme.success, fontSize: 28, fontWeight: '900' }}>{fmtXof(data.revenueXof)}</Mono>
              <Row style={{ justifyContent: 'flex-start', gap: 10 }}>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>{data.salesCount} vente(s)</Text>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {data.contributionPercent.toFixed(0)}% du CA global
                </Text>
                {fmtGrowth(data.growthPercent) ? (
                  <Text
                    style={{
                      color: data.growthPercent! >= 0 ? theme.success : theme.danger,
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    {fmtGrowth(data.growthPercent)} vs période précédente
                  </Text>
                ) : null}
              </Row>
              {data.dataQuality !== 'EXACT' && data.dataQuality !== 'NO_DATA' ? (
                <View style={{ gap: 4 }}>
                  <Badge
                    label={
                      data.dataQuality === 'ESTIMATED'
                        ? 'Estimé'
                        : data.dataQuality === 'MIXED'
                          ? 'Partiellement estimé'
                          : 'Incomplet'
                    }
                    tone="warning"
                  />
                  {data.dataQuality === 'ESTIMATED' || data.dataQuality === 'MIXED' ? (
                    <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                      Une partie de ce chiffre d&apos;affaires est estimée à partir du prix actuel des forfaits.
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                Moyenne des routeurs du tenant : {fmtXof(data.comparisonToTenantAverage.averageRouterRevenueXof)}
                {fmtGrowth(data.comparisonToTenantAverage.deltaPercent)
                  ? ` (${fmtGrowth(data.comparisonToTenantAverage.deltaPercent)})`
                  : ''}
              </Text>
            </Card>

            <View>
              <SectionTitle>Évolution</SectionTitle>
              {data.timeSeries.length < 2 ? (
                <Empty icon="trending-up-outline" text="Historique insuffisant pour tracer une courbe." />
              ) : (
                <Card>
                  <LineChart
                    data={data.timeSeries.map((t) => ({ value: t.revenueXof, label: t.date.slice(5) }))}
                    width={280}
                    height={140}
                    color={theme.primary}
                    thickness={3}
                    dataPointsColor={theme.primary}
                    textColor={theme.textMuted}
                    textFontSize={10}
                    xAxisLabelTextStyle={{ color: theme.textMuted, fontSize: 9 }}
                    yAxisTextStyle={{ color: theme.textMuted, fontSize: 10 }}
                    rulesColor={theme.border}
                    yAxisColor={theme.border}
                    xAxisColor={theme.border}
                    areaChart
                    curved
                    startFillColor={theme.primary}
                    endFillColor={theme.primary}
                    startOpacity={0.25}
                    endOpacity={0.02}
                    noOfSections={4}
                  />
                </Card>
              )}
            </View>

            <View>
              <SectionTitle>Forfaits</SectionTitle>
              {!data.plans.length ? (
                <Empty icon="pricetags-outline" text="Aucune vente de forfait sur cette période." />
              ) : (
                <View style={{ gap: 8 }}>
                  {data.plans.map((p) => (
                    <Card key={p.planId} style={{ gap: 4 }}>
                      <Row>
                        <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', flex: 1 }}>{p.name}</Text>
                        <Mono style={{ color: theme.textMuted, fontSize: 12 }}>{fmtXof(p.revenueXof)}</Mono>
                      </Row>
                      <Text style={{ color: theme.textMuted, fontSize: 11 }}>{p.salesCount} vente(s)</Text>
                    </Card>
                  ))}
                </View>
              )}
            </View>

            <View>
              <SectionTitle>Affluence</SectionTitle>
              <Card style={{ gap: 10 }}>
                <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
                  <Ionicons name="cart-outline" size={16} color={theme.primary} />
                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
                    Pic de ventes : {describeBusiest(busiestSales)}
                  </Text>
                </Row>
                <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
                  <Ionicons name="wifi-outline" size={16} color={theme.primarySoft} />
                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
                    Pic de sessions réseau ({data.sessionsCount}) : {describeBusiest(busiestSessions)}
                  </Text>
                </Row>
              </Card>
            </View>
          </>
        )}
      </ScrollView>
      <BottomNav active="rapport" />
    </View>
  );
}
