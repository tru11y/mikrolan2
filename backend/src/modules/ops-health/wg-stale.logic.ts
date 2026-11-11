/**
 * Inactivité d'un tunnel WireGuard : un peer ACTIVE sans handshake depuis 24 h (ou jamais connecté 24 h
 * après sa mise en service) déclenche une alerte. Fonctions pures, testées aux bornes.
 */
export const WG_STALE_AFTER_MS = 24 * 3_600_000;
/** Écart minimal avant de réécrire `lastHandshakeAt` en base (évite une écriture par cycle). */
export const WG_HANDSHAKE_WRITE_MIN_MS = 60_000;

export type WgStaleState = 'OK' | 'STALE_24H' | 'NEVER_CONNECTED';

export interface WgStaleInput {
  lastHandshakeAt: Date | null;
  provisionedAt: Date | null;
  createdAt: Date;
}

export function classifyWgStale(p: WgStaleInput, nowMs: number): { state: WgStaleState; since: Date; ageMs: number } {
  const since = p.lastHandshakeAt ?? p.provisionedAt ?? p.createdAt;
  const ageMs = Math.max(0, nowMs - since.getTime());
  if (ageMs < WG_STALE_AFTER_MS) return { state: 'OK', since, ageMs };
  return { state: p.lastHandshakeAt ? 'STALE_24H' : 'NEVER_CONNECTED', since, ageMs };
}

/** 1 alerte par peer et par 24 h : jamais alerté, ou dernière alerte vieille de 24 h ou plus. */
export function shouldAlert(state: WgStaleState, staleAlertedAt: Date | null, nowMs: number): boolean {
  if (state === 'OK') return false;
  return staleAlertedAt === null || nowMs - staleAlertedAt.getTime() >= WG_STALE_AFTER_MS;
}

export function formatAge(ageMs: number): string {
  const h = Math.floor(ageMs / 3_600_000);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}
