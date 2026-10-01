import { memo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type AnalyticsRouterSummary } from '@/src/lib/api';
import { fmtGrowth } from '@/src/lib/analyticsFormat';
import { Mono, Press, Row, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { fmtXof } from './shared';

export const RapportRouterCard = memo(function RapportRouterCard({
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
});
