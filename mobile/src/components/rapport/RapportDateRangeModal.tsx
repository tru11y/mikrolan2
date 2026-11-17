import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Press, Row, radius, space, type, weight, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import {
  addDays,
  fmtDate,
  lastMonth,
  monthGrid,
  orderedRange,
  rangeDays,
  sameDay,
  startOfDay,
  thisMonth,
  type DayRange,
} from '@/src/lib/rapportPeriod';

const CELL = 44;

/** Choix de deux dates : premier appui = début, second = fin (dans n'importe quel ordre). */
export function RapportDateRangeModal({
  visible,
  initial,
  onClose,
  onApply,
}: {
  visible: boolean;
  initial: DayRange | null;
  onClose: () => void;
  onApply: (range: DayRange) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const today = startOfDay(new Date());
  const [anchor, setAnchor] = useState<Date | null>(initial?.from ?? null);
  const [end, setEnd] = useState<Date | null>(initial?.to ?? null);
  const [cursor, setCursor] = useState(() => {
    const d = initial?.to ?? today;
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const range = anchor && end ? orderedRange(anchor, end) : null;
  const monthNames = t('rapport.months', { returnObjects: true }) as string[];
  const weekDays = t('rapport.weekDaysShort', { returnObjects: true }) as string[];
  const isCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth();

  const pick = (day: Date) => {
    if (!anchor || end) {
      setAnchor(day);
      setEnd(null);
    } else {
      setEnd(day);
    }
  };
  const preset = (r: DayRange) => {
    setAnchor(r.from);
    setEnd(r.to);
    setCursor({ year: r.to.getFullYear(), month: r.to.getMonth() });
  };
  const shift = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  const presets: { label: string; range: DayRange }[] = [
    { label: t('rapport.last7d'), range: { from: addDays(today, -6), to: today } },
    { label: t('rapport.last30d'), range: { from: addDays(today, -29), to: today } },
    { label: t('rapport.thisMonth'), range: thisMonth(today) },
    { label: t('rapport.lastMonth'), range: lastMonth(today) },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha('#000000', 0.6) }}>
        <View style={{ backgroundColor: theme.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, gap: space.md }}>
          <Row>
            <Text style={{ color: theme.text, fontSize: type.h2, fontWeight: weight.heavy }}>{t('rapport.chooseDates')}</Text>
            <Press onPress={onClose} accessibilityLabel={t('common.close')} style={{ width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={22} color={theme.text} />
            </Press>
          </Row>

          <Row style={{ gap: space.sm }}>
            {[
              { label: t('rapport.dateFrom'), value: range?.from ?? anchor, active: !anchor || Boolean(end) },
              { label: t('rapport.dateTo'), value: range?.to ?? null, active: Boolean(anchor) && !end },
            ].map((f) => (
              <View
                key={f.label}
                style={{
                  flex: 1, backgroundColor: theme.surface, borderRadius: radius.md, padding: space.md,
                  borderWidth: 2, borderColor: f.active ? theme.primary : theme.border,
                }}
              >
                <Text style={{ color: theme.textMuted, fontSize: type.caption, fontWeight: weight.semibold }}>{f.label}</Text>
                <Text style={{ color: theme.text, fontSize: type.title, fontWeight: weight.bold, fontFamily: theme.mono }}>
                  {f.value ? fmtDate(f.value) : '—'}
                </Text>
              </View>
            ))}
          </Row>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {presets.map((p) => (
              <Press key={p.label} onPress={() => preset(p.range)}>
                <View
                  style={{
                    height: CELL, paddingHorizontal: space.md, justifyContent: 'center',
                    borderRadius: radius.pill, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
                  }}
                >
                  <Text style={{ color: theme.text, fontSize: type.body, fontWeight: weight.semibold }}>{p.label}</Text>
                </View>
              </Press>
            ))}
          </View>

          <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: space.md, gap: space.sm }}>
            <Row>
              <Press onPress={() => shift(-1)} accessibilityLabel={t('rapport.prevMonth')} style={{ width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="chevron-back" size={20} color={theme.text} />
              </Press>
              <Text style={{ color: theme.text, fontSize: type.title, fontWeight: weight.bold }}>
                {monthNames[cursor.month]} {cursor.year}
              </Text>
              <Press
                onPress={() => shift(1)}
                disabled={isCurrentMonth}
                accessibilityLabel={t('rapport.nextMonth')}
                style={{ width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="chevron-forward" size={20} color={isCurrentMonth ? theme.textFaint : theme.text} />
              </Press>
            </Row>
            <View style={{ flexDirection: 'row' }}>
              {weekDays.map((d, i) => (
                <Text key={`${d}-${i}`} style={{ flex: 1, textAlign: 'center', color: theme.textMuted, fontSize: type.caption, fontWeight: weight.bold }}>
                  {d}
                </Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {monthGrid(cursor.year, cursor.month).map((day, i) => {
                if (day === null) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, height: CELL }} />;
                const date = new Date(cursor.year, cursor.month, day);
                const future = date.getTime() > today.getTime();
                const edge = Boolean((anchor && sameDay(date, anchor)) || (end && sameDay(date, end)));
                const inside = Boolean(range && date.getTime() >= range.from.getTime() && date.getTime() <= range.to.getTime());
                return (
                  <Press
                    key={day}
                    onPress={() => pick(date)}
                    disabled={future}
                    scaleTo={1}
                    accessibilityLabel={fmtDate(date)}
                    style={{
                      width: `${100 / 7}%`, height: CELL, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: inside && !edge ? withAlpha(theme.primary, 0.22) : 'transparent',
                    }}
                  >
                    <View
                      style={{
                        width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: edge ? theme.primary : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          color: edge ? theme.primaryText : future ? theme.textFaint : theme.text,
                          fontSize: type.bodyLg,
                          fontWeight: edge || sameDay(date, today) ? weight.bold : weight.regular,
                        }}
                      >
                        {day}
                      </Text>
                    </View>
                  </Press>
                );
              })}
            </View>
          </View>

          <Press onPress={() => range && onApply(range)} disabled={!range}>
            <View
              style={{
                height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
                backgroundColor: range ? theme.primary : theme.surfaceAlt,
              }}
            >
              <Text style={{ color: range ? theme.primaryText : theme.textMuted, fontSize: type.title, fontWeight: weight.bold }}>
                {range ? t('rapport.applyDays', { count: rangeDays(range) }) : t('rapport.pickTwoDates')}
              </Text>
            </View>
          </Press>
        </View>
      </View>
    </Modal>
  );
}
