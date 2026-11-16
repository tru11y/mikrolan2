// MikroLan Connect — Text primitive D0 §I.
// Typographie centralisée. Applique variante, tone, chiffres tabulaires,
// agrandissement système, accessibilité. Ne tronque pas par défaut : titres
// critiques, montants et statuts ne doivent JAMAIS être tronqués.

import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import {
  connectColors,
  connectType,
  connectLineHeight,
  connectWeight,
  connectMaxFontMultiplier,
  type ConnectTypeKey,
} from '../tokens/index.ts';

export type TextTone =
  | 'text'
  | 'muted'
  | 'faint'
  | 'primary'
  | 'onPrimary'
  | 'accent'
  | 'onAccent'
  | 'success'
  | 'warning'
  | 'danger';

export const toneToColor: Record<TextTone, string> = {
  text: connectColors.text,
  muted: connectColors.textMuted,
  faint: connectColors.textFaint,
  primary: connectColors.primary,
  onPrimary: connectColors.onPrimary,
  accent: connectColors.accent,
  onAccent: connectColors.onAccent,
  success: connectColors.success,
  warning: connectColors.warning,
  danger: connectColors.danger,
};

// Variantes « header » naturelles.
export const headerVariants: readonly ConnectTypeKey[] = ['screenTitle', 'subtitle'];

// Variantes plafonnées à 1,6× (D0 §E). Le parent doit fournir un
// accessibilityLabel complet pour TalkBack si l'agrandissement tronque la
// présentation visuelle.
export const cappedVariants = Object.keys(connectMaxFontMultiplier) as (keyof typeof connectMaxFontMultiplier)[];

// Variantes qui ne doivent JAMAIS être tronquées.
export const noTruncateVariants: readonly ConnectTypeKey[] = [
  'critical',
  'amount',
  'kpi',
  'screenTitle',
];

export function defaultWeight(variant: ConnectTypeKey): keyof typeof connectWeight {
  switch (variant) {
    case 'kpi':
    case 'amount':
    case 'critical':
    case 'screenTitle':
      return 'heavy';
    case 'subtitle':
    case 'button':
      return 'bold';
    default:
      return 'regular';
  }
}

export type ConnectTextProps = Omit<TextProps, 'style'> & {
  variant?: ConnectTypeKey;
  tone?: TextTone;
  numeric?: boolean;
  weight?: keyof typeof connectWeight;
  numberOfLines?: number;
  style?: TextStyle;
};

export function Text({
  variant = 'body',
  tone = 'text',
  numeric,
  weight,
  numberOfLines,
  style,
  accessibilityRole,
  allowFontScaling = true,
  maxFontSizeMultiplier,
  children,
  ...rest
}: ConnectTextProps) {
  const fontSize = connectType[variant];
  const lineHeight = connectLineHeight[variant];
  const chosenWeight = connectWeight[weight ?? defaultWeight(variant)];
  const color = toneToColor[tone];

  const truncate =
    numberOfLines !== undefined && !noTruncateVariants.includes(variant)
      ? numberOfLines
      : undefined;

  const resolvedCap =
    maxFontSizeMultiplier ??
    (cappedVariants.includes(variant as (typeof cappedVariants)[number])
      ? connectMaxFontMultiplier[variant as (typeof cappedVariants)[number]]
      : undefined);

  const resolvedRole =
    accessibilityRole ?? (headerVariants.includes(variant) ? 'header' : 'text');

  const composed: TextStyle = {
    color,
    fontSize,
    lineHeight,
    fontWeight: chosenWeight as TextStyle['fontWeight'],
    ...(numeric ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : {}),
    ...style,
  };

  return (
    <RNText
      {...rest}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={resolvedCap}
      numberOfLines={truncate}
      accessibilityRole={resolvedRole}
      style={composed}
    >
      {children}
    </RNText>
  );
}

export const textSpec = {
  variants: Object.keys(connectType) as ConnectTypeKey[],
  tones: Object.keys(toneToColor) as TextTone[],
  noTruncateVariants,
  cappedVariants,
  headerVariants,
  toneToColor,
  defaultWeight,
};
