import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Row, Skeleton, radius, space, type, weight, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { axisTickIndexes, barHeights, growthLabel, peakIndex } from '@/src/lib/rapportPeriod';

const CHART_HEIGHT = 132;
const NUM = { fontVariant: ['tabular-nums' as const] };

function amount(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n).replace(/\s/g, ' ');
}

export type ChartPoint = { label: string; revenueXof: number; sales: number };

/**
 * Le chiffre de la période, sa comparaison annoncée en clair, puis sa répartition
 * dans le temps — toujours en francs, par heure sur un jour, par jour sinon.
 */
export function RapportRevenueCard({
  title,
  revenueXof,
  summary,
  growthPercent,
  comparisonText,
  loading,
  chartTitle,
  points,
  hourly,
  peakPrefix,
  describePoint,
  emptyText,
}: {
  title: string;
  revenueXof: number;
  summary: string;
  growthPercent: number | null;
  comparisonText: string;
  loading: boolean;
  chartTitle: string;
  points: ChartPoint[];
  hourly: boolean;
  peakPrefix: string;
  describePoint: (p: ChartPoint) => string;
  emptyText: string;
}) {
  const theme = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  const values = points.map((p) => p.revenueXof);
  const heights = barHeights(values, CHART_HEIGHT);
  const peak = peakIndex(values);
  const shown = picked !== null && picked < points.length ? picked : peak;
  const ticks = axisTickIndexes(points.length, hourly);
  const g = growthLabel(growthPercent);
  const growthColor = g?.up ? theme.success : theme.danger;

  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: radius.xl, padding: space.lg, gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: theme.textMuted, fontSize: type.caption, fontWeight: weight.bold, letterSpacing: 1 }}>{title}</Text>
        {loading ? (
          <Skeleton height={48} width="70%" />
        ) : (
          <Row style={{ alignItems: 'baseline', justifyContent: 'flex-start', gap: 6 }}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[NUM, { flexShrink: 1, color: theme.text, fontSize: 44, fontWeight: weight.heavy, letterSpacing: -1 }]}
            >
              {amount(revenueXof)}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: type.h2, fontWeight: weight.bold }}>F</Text>
          </Row>
        )}
        {loading ? null : (
          <Text style={[NUM, { color: theme.textMuted, fontSize: type.body, fontWeight: weight.semibold }]}>{summary}</Text>
        )}
      </View>

      {loading || !g ? null : (
        <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.md,
              paddingHorizontal: 8, paddingVertical: 4, backgroundColor: withAlpha(growthColor, 0.16),
            }}
          >
            <Ionicons name={g.up ? 'caret-up' : 'caret-down'} size={12} color={growthColor} />
            <Text style={[NUM, { color: growthColor, fontSize: type.body, fontWeight: weight.bold }]}>{g.text}</Text>
          </View>
          <Text style={{ flex: 1, color: theme.textMuted, fontSize: type.caption }}>{comparisonText}</Text>
        </Row>
      )}

      <View style={{ gap: space.sm }}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.text, fontSize: type.body, fontWeight: weight.bold }}>{chartTitle}</Text>
          {loading || shown < 0 ? null : (
            <Text numberOfLines={1} style={[NUM, { color: theme.textMuted, fontSize: type.caption, fontWeight: weight.semibold }]}>
              {picked === null ? `${peakPrefix} ` : ''}
              {describePoint(points[shown])}
            </Text>
          )}
        </View>

        {loading ? (
          <Skeleton height={CHART_HEIGHT} />
        ) : peak < 0 ? (
          <View style={{ height: CHART_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: theme.textMuted, fontSize: type.body }}>{emptyText}</Text>
          </View>
        ) : (
          <View
            style={{
              height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: points.length > 12 ? 2 : 8,
              borderBottomWidth: 1, borderBottomColor: theme.border,
            }}
          >
            {points.map((p, i) => (
              <Pressable
                key={p.label}
                onPress={() => setPicked(i === picked ? null : i)}
                accessibilityRole="button"
                accessibilityLabel={describePoint(p)}
                style={{ flex: 1, height: CHART_HEIGHT, justifyContent: 'flex-end' }}
              >
                <View
                  style={{
                    height: heights[i], borderTopLeftRadius: 3, borderTopRightRadius: 3,
                    backgroundColor: i === shown ? theme.primary : withAlpha(theme.primary, 0.45),
                  }}
                />
              </Pressable>
            ))}
          </View>
        )}

        {loading || peak < 0 ? null : (
          <View style={{ height: 16 }}>
            {ticks.map((i) => {
              const first = i === 0;
              const last = i === points.length - 1;
              return (
                <Text
                  key={i}
                  style={[
                    NUM,
                    { position: 'absolute', width: 56, color: theme.textMuted, fontSize: type.caption, fontWeight: weight.semibold },
                    first
                      ? { left: 0, textAlign: 'left' }
                      : last
                        ? { right: 0, textAlign: 'right' }
                        : { left: `${((i + 0.5) / points.length) * 100}%`, marginLeft: -28, textAlign: 'center' },
                  ]}
                >
                  {points[i].label}
                </Text>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

export type PlanRow = { id: string; name: string; tickets: number; revenueXof: number; percent: number };

/** Ce qui se vend : tickets et chiffre d'affaires par forfait, la part en barre. */
export function RapportPlanTable({
  rows,
  days,
  labels,
}: {
  rows: PlanRow[];
  days: number;
  labels: { plan: string; tickets: string; revenue: string; perDay: (n: string) => string };
}) {
  const theme = useTheme();
  const head = { color: theme.textMuted, fontSize: type.caption, fontWeight: weight.bold } as const;
  return (
    <View style={{ gap: space.md }}>
      <Row style={{ gap: space.sm }}>
        <Text style={[head, { flex: 1 }]}>{labels.plan}</Text>
        <Text style={[head, { width: 76, textAlign: 'right' }]}>{labels.tickets}</Text>
        <Text style={[head, { width: 92, textAlign: 'right' }]}>{labels.revenue}</Text>
      </Row>
      {rows.map((r) => {
        const perDay = Math.round((r.tickets / days) * 10) / 10;
        return (
          <View key={r.id} style={{ gap: 6 }}>
            <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
              <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: type.bodyLg, fontWeight: weight.bold }}>{r.name}</Text>
              <View style={{ width: 76, alignItems: 'flex-end' }}>
                <Text style={[NUM, { color: theme.text, fontSize: type.bodyLg, fontWeight: weight.bold }]}>{r.tickets}</Text>
                {days > 1 ? (
                  <Text style={[NUM, { color: theme.textMuted, fontSize: type.caption }]}>
                    {labels.perDay(String(perDay).replace('.', ','))}
                  </Text>
                ) : null}
              </View>
              <View style={{ width: 92, alignItems: 'flex-end' }}>
                <Text style={[NUM, { color: theme.text, fontSize: type.bodyLg, fontWeight: weight.bold }]}>{amount(r.revenueXof)} F</Text>
                <Text style={[NUM, { color: theme.textMuted, fontSize: type.caption }]}>{Math.round(r.percent)} %</Text>
              </View>
            </Row>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.surfaceAlt }}>
              <View style={{ height: 6, borderRadius: 3, width: `${Math.min(100, Math.max(0, r.percent))}%`, backgroundColor: theme.primary }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}
