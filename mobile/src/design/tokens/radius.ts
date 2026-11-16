// MikroLan Connect — Rayons D0 §F.
export const connectRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;
export type ConnectRadiusKey = keyof typeof connectRadius;
