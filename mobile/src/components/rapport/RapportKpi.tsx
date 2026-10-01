import { memo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { weight, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

export const RapportKpi = memo(function RapportKpi({
  icon: iconName,
  iconColor,
  value,
  label,
  sub,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  value: string;
  label: string;
  sub?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{
      flex: 1, alignItems: 'center', gap: 6, minWidth: 0,
      paddingVertical: 14, paddingHorizontal: 6,
      backgroundColor: theme.surface,
      borderRadius: 16,
    }}>
      <View style={{
        width: 34, height: 34, borderRadius: 11,
        backgroundColor: withAlpha(iconColor, 0.1),
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={iconName} size={16} color={iconColor} />
      </View>
      <Text
        style={{ color: theme.text, fontSize: 18, fontWeight: weight.heavy, fontFamily: theme.mono }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={{ color: theme.textMuted, fontSize: 10, textAlign: 'center', letterSpacing: 0.3, lineHeight: 13 }}>{label}</Text>
      {sub ? <Text style={{ color: iconColor, fontSize: 10, fontWeight: '700' }}>{sub}</Text> : null}
    </View>
  );
});
