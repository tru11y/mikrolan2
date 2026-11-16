// MikroLan Connect — MetricCard D0 §I. Variantes compact / standard / hero.
// `hero` couvre le besoin anciennement nommé HeroMetric. Pas de composant séparé.

import { View, type ViewStyle } from 'react-native';
import {
  connectColors,
  connectRadius,
  connectSpace,
  connectElevation,
} from '../tokens/index.ts';
import { Text, type TextTone } from './Text.tsx';

export type MetricCardVariant = 'compact' | 'standard' | 'hero';

export type MetricCardProps = {
  label: string;
  value: string;
  variant?: MetricCardVariant;
  valueTone?: TextTone;
  subtext?: string;
  /** accessibilityLabel complet lu à TalkBack. Obligatoire pour `hero` dont la
   * mise en page est plafonnée (D0 §E). Si omis, concaténation label + valeur. */
  accessibilityLabel?: string;
  style?: ViewStyle;
};

export function MetricCard({
  label,
  value,
  variant = 'standard',
  valueTone,
  subtext,
  accessibilityLabel,
  style,
}: MetricCardProps) {
  const isHero = variant === 'hero';
  const isCompact = variant === 'compact';
  const bg = isHero ? connectColors.primary : connectColors.surface;
  const padding = isCompact ? connectSpace.md : connectSpace.lg + 2;
  const radius = isHero ? connectRadius.xl : isCompact ? connectRadius.md : connectRadius.lg;
  const labelTone: TextTone = isHero ? 'onPrimary' : 'muted';
  const resolvedValueTone: TextTone = valueTone ?? (isHero ? 'onPrimary' : 'text');
  const a11y = accessibilityLabel ?? `${label}, ${value}${subtext ? ', ' + subtext : ''}`;

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={a11y}
      style={[{
        backgroundColor: bg,
        borderRadius: radius,
        padding,
        borderWidth: isHero ? 0 : 1,
        borderColor: connectColors.divider,
        gap: connectSpace.xs,
        ...(isHero ? connectElevation.hero : connectElevation.none),
      }, style]}
    >
      <Text
        variant={isCompact ? 'micro' : 'micro'}
        tone={labelTone}
        weight="semibold"
        style={{ textTransform: 'uppercase' as const, letterSpacing: 0.4 }}
      >
        {label}
      </Text>
      <Text
        variant={isHero ? 'amount' : 'kpi'}
        tone={resolvedValueTone}
        numeric
      >
        {value}
      </Text>
      {subtext ? (
        <Text variant="secondary" tone={isHero ? 'onPrimary' : 'muted'}>
          {subtext}
        </Text>
      ) : null}
    </View>
  );
}

export const metricCardSpec = {
  variants: ['compact', 'standard', 'hero'] as const,
  heroUsesAmount: true,
};
