// MikroLan Connect — Icônes D0 §F.
export const connectIcon = {
  xs: 14,
  sm: 16,
  md: 20, // défaut
  lg: 24,
  xl: 28,
  hero: 60,
} as const;
export type ConnectIconKey = keyof typeof connectIcon;
