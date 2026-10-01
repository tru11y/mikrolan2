import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';
import { Empty, Mono, Row, space } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { fmtXof } from './shared';

export const RapportPlanPieChart = memo(function RapportPlanPieChart({
  data,
  t,
}: {
  data: { planId: string; planName: string; revenueXof: number; sold: number }[];
  t: (key: string) => string;
}) {
  const theme = useTheme();
  const planColors = [theme.primary, theme.success, theme.warning, theme.danger, '#38BDF8', '#F472B6'];
  const slices = useMemo(() => {
    const total = data.reduce((s, p) => s + p.revenueXof, 0) || 1;
    return data.map((p, idx) => ({
      value: p.revenueXof,
      color: planColors[idx % planColors.length],
      text: `${Math.round((p.revenueXof / total) * 100)}%`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  if (!data.length) return <Empty icon="pie-chart-outline" text={t('rapport.noPlanSales')} />;

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
});
