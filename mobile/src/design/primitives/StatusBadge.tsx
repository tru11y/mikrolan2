// MikroLan Connect — StatusBadge D0 §H.
// Rend TOUJOURS : fond coloré + icône + libellé. Jamais couleur seule.

import { View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  connectColors,
  connectIcon,
  connectRadius,
  connectSpace,
  statusMatrix,
  type StatusKey,
} from '../tokens/index.ts';
import { Text, type TextTone } from './Text.tsx';

export type StatusBadgeSize = 'sm' | 'md';

export type StatusBadgeProps = {
  status: StatusKey;
  /** Libellé affiché. Passez la chaîne traduite (i18n) ici. Si omis, utilise
   * le libellé français par défaut de la matrice. */
  label?: string;
  /** Ancienneté (« il y a 8 min »). Concaténée après le libellé avec " · ". */
  age?: string;
  size?: StatusBadgeSize;
  style?: ViewStyle;
};

const iconToneMap: Record<string, TextTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  textMuted: 'muted',
  primary: 'primary',
};

export function StatusBadge({ status, label, age, size = 'md', style }: StatusBadgeProps) {
  const d = statusMatrix[status];
  const resolvedLabel = label ?? d.fallbackLabel;
  const iconColor = (connectColors as Record<string, string>)[d.color];
  const bg = (connectColors as Record<string, string>)[d.bg];
  const iconSize = size === 'sm' ? connectIcon.sm : connectIcon.md;
  const padV = size === 'sm' ? 4 : 6;
  const padH = size === 'sm' ? connectSpace.sm : connectSpace.sm + 2;
  const tone: TextTone = iconToneMap[d.color] ?? 'text';
  const a11y = age ? `${resolvedLabel} · ${age}` : resolvedLabel;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11y}
      style={[{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: bg,
        borderRadius: connectRadius.pill,
        paddingVertical: padV, paddingHorizontal: padH,
        gap: connectSpace.xs + 2,
        alignSelf: 'flex-start',
      }, style]}
    >
      <Ionicons name={d.icon as React.ComponentProps<typeof Ionicons>['name']} size={iconSize} color={iconColor} />
      <Text variant={size === 'sm' ? 'secondary' : 'secondary'} tone={tone} weight="bold">
        {age ? `${resolvedLabel} · ${age}` : resolvedLabel}
      </Text>
    </View>
  );
}

// Spec pure, testable depuis Node.
export const statusBadgeSpec = {
  sizes: ['sm', 'md'] as const,
  requiresIconAndLabel: true,
};
