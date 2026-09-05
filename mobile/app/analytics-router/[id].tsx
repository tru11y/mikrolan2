import { useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { LineChart } from 'react-native-gifted-charts';
import { api, type AnalyticsPeriod } from '@/src/lib/api';
import { busiestCell, describeBusiest, fmtGrowth, fmtXof } from '@/src/lib/analyticsFormat';
import {
  AuroraCard,
  Badge,
  Card,
  Empty,
  ErrorState,
  FadeIn,
  Mono,
  Row,
  SectionTitle,
  Skeleton,
  space,
  Subtitle,
  Title,
  withAlpha,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
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
  const theme = useTheme();
  const { t } = useTranslation();
  const { id, period: periodParam } = useLocalSearchParams<{ id: string; period?: string }>();
  const navHeight = useBottomNavHeight();
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = screenWidth - space.lg * 2 - space.lg * 2 - 40;
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
      <AppHeader title={data?.routerName ?? t('analyticsRouter.detailTitle')} back />
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
          <ErrorState message={t('analyticsRouter.loadError')} onRetry={() => detail.refetch()} />
        ) : !data ? (
          <Empty icon="hardware-chip-outline" text={t('analyticsRouter.noData')} />
        ) : (
          <>
            <View>
              <Title>{data.routerName}</Title>
              <Subtitle>{t('analyticsRouter.periodSubtitle')}</Subtitle>
            </View>

            <FadeIn>
            <AuroraCard style={{ gap: 8, padding: space.xl }}>
              <Text style={{ color: withAlpha('#FFFFFF', 0.7), fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                {t('analyticsRouter.revenue')}
              </Text>
              <Mono style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '900' }}>{fmtXof(data.revenueXof)}</Mono>
              <Row style={{ justifyContent: 'flex-start', gap: 10 }}>
                <Text style={{ color: withAlpha('#FFFFFF', 0.8), fontSize: 12 }}>{t('analyticsRouter.sales', { count: data.salesCount })}</Text>
                <Text style={{ color: withAlpha('#FFFFFF', 0.8), fontSize: 12 }}>
                  {t('analyticsRouter.ofGlobalRevenue', { pct: data.contributionPercent.toFixed(0) })}
                </Text>
                {fmtGrowth(data.growthPercent) ? (
                  <View style={{ backgroundColor: withAlpha('#FFFFFF', 0.2), borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
                      {fmtGrowth(data.growthPercent)} {t('analyticsRouter.vsPrevious')}
                    </Text>
                  </View>
                ) : null}
              </Row>
              <Text style={{ color: withAlpha('#FFFFFF', 0.7), fontSize: 11 }}>
                {t('analyticsRouter.tenantAverage', { amount: fmtXof(data.comparisonToTenantAverage.averageRouterRevenueXof) })}
                {fmtGrowth(data.comparisonToTenantAverage.deltaPercent)
                  ? ` (${fmtGrowth(data.comparisonToTenantAverage.deltaPercent)})`
                  : ''}
              </Text>
            </AuroraCard>
            </FadeIn>

            {data.dataQuality !== 'EXACT' && data.dataQuality !== 'NO_DATA' ? (
              <Card style={{ gap: 4 }}>
                <Badge
                  label={
                    data.dataQuality === 'ESTIMATED'
                      ? t('rapport.dataEstimated')
                      : data.dataQuality === 'MIXED'
                        ? t('rapport.dataMixed')
                        : t('rapport.dataIncomplete')
                  }
                  tone="warning"
                />
                {data.dataQuality === 'ESTIMATED' || data.dataQuality === 'MIXED' ? (
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                    {t('rapport.estimatedNote')}
                  </Text>
                ) : null}
              </Card>
            ) : null}

            <View>
              <SectionTitle>{t('analyticsRouter.evolution')}</SectionTitle>
              {data.timeSeries.length < 2 ? (
                <Empty icon="trending-up-outline" text={t('analyticsRouter.insufficientHistory')} />
              ) : (
                <Card>
                  <LineChart
                    data={data.timeSeries.map((pt) => ({ value: pt.revenueXof, label: pt.date.slice(5) }))}
                    width={chartWidth}
                    height={160}
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
              <SectionTitle>{t('analyticsRouter.plansSection')}</SectionTitle>
              {!data.plans.length ? (
                <Empty icon="pricetags-outline" text={t('analyticsRouter.noPlanSales')} />
              ) : (
                <View style={{ gap: 8 }}>
                  {data.plans.map((p) => (
                    <Card key={p.planId} style={{ gap: 4 }}>
                      <Row>
                        <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', flex: 1 }}>{p.name}</Text>
                        <Mono style={{ color: theme.textMuted, fontSize: 12 }}>{fmtXof(p.revenueXof)}</Mono>
                      </Row>
                      <Text style={{ color: theme.textMuted, fontSize: 11 }}>{t('analyticsRouter.sales', { count: p.salesCount })}</Text>
                    </Card>
                  ))}
                </View>
              )}
            </View>

            <View>
              <SectionTitle>{t('analyticsRouter.affluence')}</SectionTitle>
              <Card style={{ gap: 10 }}>
                <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
                  <Ionicons name="cart-outline" size={16} color={theme.primary} />
                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
                    {t('analyticsRouter.salesPeak', { desc: describeBusiest(busiestSales) })}
                  </Text>
                </Row>
                <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
                  <Ionicons name="wifi-outline" size={16} color={theme.primaryMuted} />
                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', flex: 1 }}>
                    {t('analyticsRouter.sessionsPeak', { count: data.sessionsCount, desc: describeBusiest(busiestSessions) })}
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
