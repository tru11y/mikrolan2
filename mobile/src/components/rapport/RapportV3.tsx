import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Press, Row, Skeleton, radius, space, type, weight, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { barHeights, growthLabel } from '@/src/lib/rapportPeriod';
import { fmtXof } from './shared';

const CHART_HEIGHT = 140;

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

function GrowthChip({ pct }: { pct: number | null | undefined }) {
  const theme = useTheme();
  const g = growthLabel(pct);
  if (!g) return null;
  const color = g.up ? theme.success : theme.danger;
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.md,
        paddingHorizontal: 10, paddingVertical: 6, backgroundColor: withAlpha(color, 0.16),
      }}
    >
      <Ionicons name={g.up ? 'caret-up' : 'caret-down'} size={14} color={color} />
      <Text style={{ color, fontSize: type.title, fontWeight: weight.bold, fontFamily: theme.mono }}>{g.text}</Text>
    </View>
  );
}

export function RapportHero({
  label,
  revenueXof,
  growthPercent,
  loading,
  chartLabel,
  bars,
  axis,
  emptyText,
}: {
  label: string;
  revenueXof: number;
  growthPercent: number | null | undefined;
  loading: boolean;
  chartLabel: string;
  bars: number[];
  axis: [string, string];
  emptyText: string;
}) {
  const theme = useTheme();
  const heights = barHeights(bars, CHART_HEIGHT);
  const hasData = heights.some((h) => h > 0);
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: radius.xl, padding: space.lg, gap: space.md }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.textMuted, fontSize: type.caption, fontWeight: weight.bold, letterSpacing: 1 }}>{label}</Text>
          {loading ? (
            <Skeleton height={48} width="70%" />
          ) : (
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ color: theme.text, fontSize: 44, fontWeight: weight.heavy, fontFamily: theme.mono, letterSpacing: -1 }}
            >
              {fmtXof(revenueXof)}
            </Text>
          )}
        </View>
        {loading ? null : <GrowthChip pct={growthPercent} />}
      </Row>

      {loading ? (
        <Skeleton height={CHART_HEIGHT} />
      ) : hasData ? (
        <View accessible accessibilityLabel={chartLabel} style={{ height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: bars.length > 12 ? 2 : 8 }}>
          {heights.map((h, i) => (
            <View key={i} style={{ flex: 1, height: h, backgroundColor: theme.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
          ))}
        </View>
      ) : (
        <View style={{ height: CHART_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: theme.textMuted, fontSize: type.body }}>{emptyText}</Text>
        </View>
      )}

      <Row>
        <Text style={{ color: theme.textMuted, fontSize: type.caption, fontWeight: weight.semibold }}>{axis[0]}</Text>
        <Text style={{ color: theme.textMuted, fontSize: type.caption, fontWeight: weight.semibold }}>{chartLabel}</Text>
        <Text style={{ color: theme.textMuted, fontSize: type.caption, fontWeight: weight.semibold }}>{axis[1]}</Text>
      </Row>
    </View>
  );
}

export function RapportStat({
  label,
  value,
  growthPercent,
}: {
  label: string;
  value: string;
  growthPercent?: number | null;
}) {
  const theme = useTheme();
  const g = growthLabel(growthPercent);
  return (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: theme.surface, borderRadius: radius.lg, padding: space.md, gap: 2 }}>
      <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: type.caption, fontWeight: weight.semibold }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: theme.text, fontSize: type.h1, fontWeight: weight.bold, fontFamily: theme.mono }}>
        {value}
      </Text>
      {g ? (
        <Text style={{ color: g.up ? theme.success : theme.danger, fontSize: type.caption, fontWeight: weight.bold }}>
          {g.up ? '▲' : '▼'} {g.text}
        </Text>
      ) : null}
    </View>
  );
}

export type ShareRow = { id: string; name: string; revenueXof: number; percent: number };

/** Forfaits : une barre empilée et sa légende chiffrée. */
export function RapportPlanBar({ rows }: { rows: ShareRow[] }) {
  const theme = useTheme();
  const palette = [theme.primary, theme.success, theme.warning, '#4FB3FF', '#E879F9', theme.textMuted];
  const color = (i: number) => palette[Math.min(i, palette.length - 1)];
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', height: 28, borderRadius: radius.sm, overflow: 'hidden', gap: 2 }}>
        {rows.map((r, i) => (
          <View key={r.id} style={{ flex: Math.max(r.percent, 1), backgroundColor: color(i) }} />
        ))}
      </View>
      <View style={{ gap: space.sm }}>
        {rows.map((r, i) => (
          <Row key={r.id} style={{ gap: space.sm }}>
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color(i) }} />
            <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: type.body, fontWeight: weight.semibold }}>{r.name}</Text>
            <Text style={{ width: 52, textAlign: 'right', color: theme.textMuted, fontSize: type.body }}>{Math.round(r.percent)} %</Text>
            <Text style={{ width: 92, textAlign: 'right', color: theme.text, fontSize: type.body, fontWeight: weight.bold, fontFamily: theme.mono }}>
              {fmtXof(r.revenueXof)}
            </Text>
          </Row>
        ))}
      </View>
    </View>
  );
}

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
