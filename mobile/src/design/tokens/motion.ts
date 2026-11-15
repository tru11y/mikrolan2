// MikroLan Connect — Mouvement D0 §F. Respect obligatoire de useReduceMotion
// (helper existant exporté par src/components/ui.tsx).
import { Easing } from 'react-native';

export const connectMotion = {
  fast: 140,
  base: 220,
  slow: 360,
  stagger: 55,
  easeOut: Easing.bezier(0.22, 1, 0.36, 1),
  easeIn: Easing.bezier(0.55, 0, 1, 0.45),
} as const;
export type ConnectMotionKey = keyof typeof connectMotion;
