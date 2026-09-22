import { memo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Row, weight, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

export const RapportSectionHeader = memo(function RapportSectionHeader({
  icon,
  label,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
}) {
  const theme = useTheme();
  return (
    <Row style={{ gap: 10, paddingTop: 4 }}>
      <View style={{
        width: 28, height: 28, borderRadius: 9,
        backgroundColor: withAlpha(color, 0.1),
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={icon} size={13} color={color} />
      </View>
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: weight.bold, flex: 1 }}>{label}</Text>
    </Row>
  );
});
