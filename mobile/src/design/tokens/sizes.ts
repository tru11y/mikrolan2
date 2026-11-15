// MikroLan Connect — Dimensions D0 §F. Cible tactile plancher 44.
export const connectSize = {
  tap: 44,
  btnSm: 48,
  btnMd: 52,
  listCompact: 56,
  listRouter: 76,
  field: 56,
  fieldCompact: 48,
  heroIconCircle: 112,
  heroIconGlyph: 60,
} as const;
export type ConnectSizeKey = keyof typeof connectSize;
