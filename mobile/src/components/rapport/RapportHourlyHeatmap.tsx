import { memo, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export const RapportHourlyHeatmap = memo(function RapportHourlyHeatmap({
  cells,
}: {
  cells: { dayOfWeek: number; hour: number; count: number; revenueXof?: number }[];
}) {
  const theme = useTheme();
  const { maxCount, grid } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const c of cells) {
      if (c.dayOfWeek >= 0 && c.dayOfWeek < 7 && c.hour >= 0 && c.hour < 24) {
        g[c.dayOfWeek][c.hour] = c.count;
      }
    }
    return { maxCount: Math.max(1, ...cells.map((c) => c.count)), grid: g };
  }, [cells]);

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
});
