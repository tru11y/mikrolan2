import { memo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'react-native-gifted-charts';
import { Card, Empty, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { RapportSectionHeader } from './RapportSectionHeader';
import { fmtDay, fmtXof } from './shared';

export const RapportRevenueChart = memo(function RapportRevenueChart({
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
      <RapportSectionHeader icon="trending-up" label={t('rapport.dailyRevenueChart')} color={theme.success} />
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
});
