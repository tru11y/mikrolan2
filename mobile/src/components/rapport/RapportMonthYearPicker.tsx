import { memo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Press, Row, weight } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

export const RapportMonthYearPicker = memo(function RapportMonthYearPicker({
  month,
  year,
  onChangeMonth,
  onChangeYear,
}: {
  month: number;
  year: number;
  onChangeMonth: (m: number) => void;
  onChangeYear: (y: number) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const months: string[] = t('rapport.months', { returnObjects: true }) as string[];

  return (
    <View style={{ gap: 8 }}>
      {/* Year nav */}
      <Row style={{ justifyContent: 'center', gap: 16 }}>
        <Press onPress={() => onChangeYear(year - 1)} style={{ padding: 8 }}>
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Press>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: weight.bold, minWidth: 60, textAlign: 'center' }}>{year}</Text>
        <Press onPress={() => onChangeYear(year + 1)} style={{ padding: 8 }}>
          <Ionicons name="chevron-forward" size={18} color={theme.text} />
        </Press>
      </Row>
      {/* Month grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {months.map((label, idx) => {
          const active = idx === month;
          return (
            <Press
              key={idx}
              onPress={() => onChangeMonth(idx)}
              style={{
                width: '24%',
                paddingVertical: 8,
                borderRadius: 10,
                alignItems: 'center',
                backgroundColor: active ? theme.primary : 'transparent',
              }}
            >
              <Text style={{
                color: active ? theme.primaryText : theme.textMuted,
                fontSize: 11,
                fontWeight: active ? '700' : '500',
              }}>
                {label.slice(0, 4)}
              </Text>
            </Press>
          );
        })}
      </View>
    </View>
  );
});
