import type { PropsWithChildren } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { icon, radius, space, withAlpha } from './ui';
import { useTheme } from '@/src/providers/theme-provider';

type ConsentCheckboxProps = PropsWithChildren<{
  checked: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
}>;

/** Case à cocher explicite (jamais pré-cochée) : le consentement doit être un acte positif. */
export function ConsentCheckbox({ checked, onToggle, accessibilityLabel, children }: ConsentCheckboxProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.sm,
          borderWidth: 2,
          borderColor: checked ? theme.primary : theme.border,
          backgroundColor: checked ? theme.primary : withAlpha(theme.border, 0.1),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Ionicons name="checkmark" size={icon.sm} color={theme.onStrong} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}
