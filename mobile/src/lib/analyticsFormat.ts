import type { AnalyticsHeatmapCell } from '@/src/lib/api';

/** Étiquettes jours (lundi=0..dimanche=6), même convention que le backend. */
export const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function fmtXof(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' F';
}

export function fmtGrowth(pct: number | null): string | null {
  if (pct == null) return null;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

export type Busiest = { dayOfWeek: number; hour: number; count: number } | null;

/** Cellule la plus active d'une heatmap ; null si tout est vide (pas assez d'historique). */
export function busiestCell(cells: AnalyticsHeatmapCell[]): Busiest {
  let best: Busiest = null;
  for (const c of cells) {
    if (c.count > 0 && (!best || c.count > best.count)) {
      best = { dayOfWeek: c.dayOfWeek, hour: c.hour, count: c.count };
    }
  }
  return best;
}

export function describeBusiest(b: Busiest): string {
  if (!b) return 'Pas assez de données pour identifier un pic.';
  return `${DAY_LABELS[b.dayOfWeek]} vers ${b.hour}h (${b.count} au total)`;
}
