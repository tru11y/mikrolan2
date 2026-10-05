/**
 * Affichage des données live par classe : sessions (HOT) et performances (WARM) sont indépendantes.
 * Module SANS import runtime (testable avec `node --test`).
 * Règle : inconnu (null/undefined) ≠ 0. Un vrai 0 % reste « 0 ».
 */
export interface LiveLike {
  lastSuccessAt?: number;
  stale?: boolean;
  sessionCount?: number | null;
  cpuPercent?: number | null;
  memoryUsedMb?: number | null;
  memoryTotalMb?: number | null;
  statsUpdatedAt?: number | null;
}

export type ClassState = 'unknown' | 'fresh' | 'stale';

export function sessionsState(data: LiveLike | undefined): ClassState {
  if (!data || data.sessionCount == null) return 'unknown';
  return data.stale ? 'stale' : 'fresh';
}

export function statsState(data: LiveLike | undefined): ClassState {
  if (!data || data.cpuPercent == null) return 'unknown';
  return data.stale ? 'stale' : 'fresh';
}

/** Pourcentage mémoire, ou null si le total est inconnu. */
export function memoryPercent(used: number | null | undefined, total: number | null | undefined): number | null {
  if (used == null || total == null || !(total > 0)) return null;
  return Math.round((used / total) * 100);
}

/** CPU : '' / undefined / NaN → null (inconnu) ; "0" → 0. */
export function cpuValue(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
