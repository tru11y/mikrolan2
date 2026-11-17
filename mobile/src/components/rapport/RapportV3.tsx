import { Text, View } from 'react-native';
import { Press, Row, radius, space, type, weight } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { growthLabel } from '@/src/lib/rapportPeriod';
import { fmtXof } from './shared';

export function RapportPeriodBar<K extends string>({
  items,
  selected,
  onSelect,
}: {
  items: { key: K; label: string; flex: number }[];
  selected: K;
  onSelect: (key: K) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {items.map((p) => {
        const on = p.key === selected;
        return (
          <Press key={p.key} onPress={() => onSelect(p.key)} accessibilityLabel={p.label} style={{ flex: p.flex }}>
            <View
              style={{
                height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md,
                backgroundColor: on ? theme.primary : theme.surface,
                borderWidth: 1, borderColor: on ? theme.primary : theme.border,
              }}
            >
              <Text numberOfLines={1} style={{ color: on ? theme.primaryText : theme.text, fontSize: 13, fontWeight: weight.bold }}>
                {p.label}
              </Text>
            </View>
          </Press>
        );
      })}
    </View>
  );
}

export type ShareRow = { id: string; name: string; revenueXof: number; percent: number };

/** Routeurs : barres relatives au premier, avec la variation quand elle est connue. */
export function RapportRouterBars({
  rows,
  onPress,
}: {
  rows: (ShareRow & { growthPercent: number | null })[];
  onPress: (id: string) => void;
}) {
  const theme = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.revenueXof));
  return (
    <View style={{ gap: space.md }}>
      {rows.map((r) => {
        const g = growthLabel(r.growthPercent);
        return (
          <Press key={r.id} onPress={() => onPress(r.id)} scaleTo={0.99} accessibilityLabel={r.name} style={{ gap: 6, minHeight: 44, justifyContent: 'center' }}>
            <Row style={{ gap: space.sm }}>
              <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: type.body, fontWeight: weight.bold }}>{r.name}</Text>
              {g ? (
                <Text style={{ color: g.up ? theme.success : theme.danger, fontSize: type.caption, fontWeight: weight.bold }}>
                  {g.up ? '▲' : '▼'} {g.text}
                </Text>
              ) : null}
              <Text style={{ color: theme.text, fontSize: type.body, fontWeight: weight.bold, fontFamily: theme.mono }}>{fmtXof(r.revenueXof)}</Text>
            </Row>
            <View style={{ height: 10, borderRadius: 5, backgroundColor: theme.surfaceAlt }}>
              <View style={{ height: 10, borderRadius: 5, width: `${(r.revenueXof / max) * 100}%`, backgroundColor: theme.primary }} />
            </View>
          </Press>
        );
      })}
    </View>
  );
}
