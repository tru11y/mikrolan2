import { memo } from 'react';
import { ScrollView, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BarChart } from 'react-native-gifted-charts';
import { Card, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { RapportSectionHeader } from './RapportSectionHeader';
import { fmtDay } from './shared';

export const RapportTicketsChart = memo(function RapportTicketsChart({
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
      <RapportSectionHeader icon="ticket-outline" label={t('rapport.ticketsSoldPerDay')} color={theme.primary} />
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
});
