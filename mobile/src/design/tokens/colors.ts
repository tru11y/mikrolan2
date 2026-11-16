// MikroLan Connect — Palette officielle D0 §D.
// Source de vérité : D:\dev\mikrolan-prototypes\D0-charte-MikroLan-Connect.md
// Ne pas modifier sans mise à jour conjointe du document D0.

export const connectColors = {
  background: '#FBF6EE',
  surface: '#FFFFFF',
  surfaceAlt: '#F5EEDF',
  text: '#1F2A28',
  textMuted: '#4F5B58',
  textFaint: '#585F5C',
  border: '#9E8A5A',
  borderSoft: '#9E8A5A',
  divider: '#E3D8C5',
  primary: '#0B6B5C',
  primaryHover: '#095548',
  onPrimary: '#FFFFFF',
  primaryTint: '#DDF0EA',
  accent: '#B35C00',
  onAccent: '#FFFFFF',
  accentTint: '#FFE9C2',
  success: '#0F6B2E',
  successBg: '#DFF2E6',
  warning: '#7A4300',
  warningBg: '#FFE2B3',
  danger: '#A8221A',
  dangerBg: '#FCE2DF',
  focus: '#0B6B5C',
  routerUnknownBg: '#E7E0D0',
  disabledBg: '#EDE4CF',
  disabledText: '#585F5C',
} as const;

export type ConnectColorKey = keyof typeof connectColors;
export type ConnectColors = typeof connectColors;
