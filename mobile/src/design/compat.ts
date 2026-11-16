// MikroLan Connect — Couche de compatibilité typée.
// Mappe les noms de tokens legacy (src/components/ui.tsx) vers les équivalents
// Connect. Usage interne D1+ uniquement. PAS d'ENV, PAS de flag runtime.
// Durée de vie : jusqu'à la suppression du thème legacy après D7.

import { connectRadius } from './tokens/radius.ts';
import { connectSpace } from './tokens/spacing.ts';
import { connectType } from './tokens/typography.ts';
import { connectIcon } from './tokens/icon.ts';
import { connectColors } from './tokens/colors.ts';

// radius legacy (ui.tsx) : xs=4, sm=8, md=12, lg=14, xl=18, pill=999
// Connect alignement : xs=4, sm=8, md=12, lg=16, xl=20, pill=999
export const legacyToConnectRadius = {
  xs: connectRadius.xs,
  sm: connectRadius.sm,
  md: connectRadius.md,
  lg: connectRadius.lg, // 14 → 16
  xl: connectRadius.xl, // 18 → 20
  pill: connectRadius.pill,
} as const;

// space : identique (4/8/12/16/20/24/32)
export const legacyToConnectSpace = connectSpace;

// type legacy : micro=11, caption=12, body=14, bodyLg=15, title=16, h2=20, h1=24, display=30, hero=38
// Connect : micro=12, secondary=14, body=16, button=16, subtitle=18, screenTitle=24, critical=24, kpi=30, amount=40
// Le mapping est indicatif. Les composants pilotes doivent préférer connectType directement.
export const legacyToConnectType = {
  micro: connectType.micro,       // 11 → 12 (plancher D0)
  caption: connectType.micro,     // 12
  body: connectType.secondary,    // 14 reste 14 (texte secondaire Connect)
  bodyLg: connectType.body,       // 15 → 16 (corps principal Connect)
  title: connectType.body,        // 16
  h2: connectType.screenTitle,    // 20 → 24 (titre d'écran Connect)
  h1: connectType.screenTitle,    // 24
  display: connectType.kpi,       // 30
  hero: connectType.amount,       // 38 → 40
} as const;

// icon : xs=14(nouveau), sm=16, md=20, lg=24, xl=28, hero=60(nouveau)
export const legacyToConnectIcon = {
  sm: connectIcon.sm,
  md: connectIcon.md,
  lg: connectIcon.lg,
  xl: connectIcon.xl,
} as const;

// Couleurs — pas de mapping direct : le thème legacy dark a sa propre palette
// (primary=#7B61FF). Un écran migré DOIT remplacer `useTheme()` par
// `useConnectTheme()`. Aucun écran n'est migré en D1.
export const connectPaletteRef = connectColors;
