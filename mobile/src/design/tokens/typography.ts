// MikroLan Connect — Typographie officielle D0 §E.
// Pile système React Native (fontFamily=undefined), plancher 12, cible 16.

export const connectType = {
  micro: 12,
  secondary: 14,
  body: 16,
  button: 16,
  subtitle: 18,
  screenTitle: 24,
  critical: 24,
  kpi: 30,
  amount: 40,
} as const;

export const connectLineHeight = {
  micro: 16,
  secondary: 20,
  body: 24,
  button: 20,
  subtitle: 24,
  screenTitle: 30,
  critical: 30,
  kpi: 34,
  amount: 44,
} as const;

export const connectWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

// fontFamily=undefined → pile système iOS SF / Android Roboto / Web system.
export const connectFontFamily = {
  base: undefined as string | undefined,
  mono: 'monospace' as const,
} as const;

// Plafonds d'agrandissement — justifiés composant par composant (D0 §E).
// kpi, amount, critical : à 200 % la mise en page casse (sort de l'écran A56 ou
// casse la grille 2×2). Plafond 1,6 ; valeur complète lue à TalkBack via
// accessibilityLabel du composant qui les utilise.
export const connectMaxFontMultiplier = {
  kpi: 1.6,
  amount: 1.6,
  critical: 1.6,
} as const;

export type ConnectTypeKey = keyof typeof connectType;
