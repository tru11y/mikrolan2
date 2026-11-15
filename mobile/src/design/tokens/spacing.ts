// MikroLan Connect — Espacement base 4 pt (D0 §F).
export const connectSpace = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16, // défaut
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;
export type ConnectSpaceKey = keyof typeof connectSpace;
