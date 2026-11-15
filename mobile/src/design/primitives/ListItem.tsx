// MikroLan Connect — ListItem D0 §I.
// Variantes `standard` (56) et `router` (76). Cible tactile complète,
// barre latérale sémantique optionnelle, chevron si onPress.

import { Pressable, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  connectColors,
  connectIcon,
  connectSize,
  connectSpace,
} from '../tokens/index.ts';
import { Text, type TextTone } from './Text.tsx';

export type ListItemDensity = 'standard' | 'router' | 'compact';

export type ListItemProps = {
  title: string;
  subtitle?: string;
  density?: ListItemDensity;
  /** Couleur sémantique de la barre latérale (tokens Connect : success /
   *  warning / danger / primary / textMuted). */
  leadingBarColor?: 'success' | 'warning' | 'danger' | 'primary' | 'textMuted';
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Zone sous le titre/sous-titre, p. ex. barres CPU/Mem pour Routeurs. */
  metrics?: React.ReactNode;
  accessibilityLabel?: string;
};

const minHeights: Record<ListItemDensity, number> = {
  standard: connectSize.listCompact, // 56
  compact: connectSize.listCompact, // 56
  router: connectSize.listRouter, // 76
};

export function ListItem({
  title,
  subtitle,
  density = 'standard',
  leadingBarColor,
  trailing,
  onPress,
  metrics,
  accessibilityLabel,
}: ListItemProps) {
  const barColor = leadingBarColor
    ? (connectColors as Record<string, string>)[leadingBarColor]
    : connectColors.divider;
  const showChevron = !!onPress && !trailing;

  const content = (
    <View style={{
      flexDirection: 'row', alignItems: 'stretch',
      minHeight: minHeights[density],
      paddingVertical: connectSpace.sm + 2,
      paddingHorizontal: connectSpace.md + 2,
      gap: connectSpace.sm + 2,
      borderBottomWidth: 1, borderBottomColor: connectColors.divider,
    }}>
      {leadingBarColor ? (
        <View style={{ width: 5, borderRadius: 3, backgroundColor: barColor }} />
      ) : null}
      <View style={{ flex: 1, gap: 4, justifyContent: 'center' }}>
        <Text variant="body" tone="text" weight="bold">{title}</Text>
        {subtitle ? <Text variant="secondary" tone="muted">{subtitle}</Text> : null}
        {metrics ?? null}
      </View>
      {trailing ? <View style={{ justifyContent: 'center' }}>{trailing}</View> : null}
      {showChevron ? (
        <View style={{ justifyContent: 'center' }}>
          <Ionicons name="chevron-forward" size={connectIcon.md} color={connectColors.textMuted} />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      hitSlop={{ top: 0, bottom: 0, left: 0, right: 0 }} // la ligne elle-même >= 56
      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

export const listItemSpec = {
  densities: ['standard', 'router', 'compact'] as ListItemDensity[],
  minHeights,
};
