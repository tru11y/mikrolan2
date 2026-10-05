/**
 * Logique pure de l'écran « Vérifier un ticket », isolée SANS import runtime (react-native,
 * axios…) pour pouvoir la couvrir avec `node --test` (convention : `metricsCsvRows.test.ts`).
 *
 * Expiration = première connexion + durée du forfait, calculée côté backend (`expiresAt`, à partir
 * de `Plan.durationMinutes`, jamais du nom du forfait). Le temps restant est calculé localement à
 * partir de `expiresAt` : aucune requête réseau pour faire descendre le compteur.
 */

/** Doit refléter `TicketState` du backend (voucher.service.ts). */
export type TicketState = 'AVAILABLE' | 'IN_USE' | 'ENDED' | 'EXPIRED' | 'REVOKED' | 'UNAVAILABLE';

export type VerdictTone = 'valid' | 'used' | 'invalid';

export interface VerdictSpec {
  tone: VerdictTone;
  icon: 'shield-checkmark-outline' | 'wifi-outline' | 'checkmark-done-outline' | 'time-outline' | 'ban-outline' | 'warning-outline';
  /** Clés i18n sous `verifyTicket.`. */
  title: string;
  detail: string;
}

const SPEC: Record<TicketState, VerdictSpec> = {
  AVAILABLE: { tone: 'valid', icon: 'shield-checkmark-outline', title: 'states.AVAILABLE', detail: 'stateDetails.AVAILABLE' },
  IN_USE: { tone: 'valid', icon: 'wifi-outline', title: 'states.IN_USE', detail: 'stateDetails.IN_USE' },
  ENDED: { tone: 'used', icon: 'checkmark-done-outline', title: 'states.ENDED', detail: 'stateDetails.ENDED' },
  EXPIRED: { tone: 'invalid', icon: 'time-outline', title: 'states.EXPIRED', detail: 'stateDetails.EXPIRED' },
  REVOKED: { tone: 'invalid', icon: 'ban-outline', title: 'states.REVOKED', detail: 'stateDetails.REVOKED' },
  UNAVAILABLE: { tone: 'invalid', icon: 'warning-outline', title: 'states.UNAVAILABLE', detail: 'stateDetails.UNAVAILABLE' },
};

/** Titre et ton du verdict d'après l'état métier du backend (jamais « valide » si non provisionné). */
export function verdictSpec(state: TicketState): VerdictSpec {
  return SPEC[state] ?? SPEC.UNAVAILABLE;
}

/**
 * Temps restant en millisecondes, jamais négatif.
 * - jamais utilisé (`expiresAt` null) : durée complète du forfait (la validité n'a pas commencé) ;
 * - activé : `expiresAt` − maintenant (corrigé de l'écart d'horloge serveur/téléphone).
 */
export function remainingMs(input: {
  expiresAt: string | null;
  durationSeconds: number;
  nowMs: number;
  clockOffsetMs?: number;
}): number {
  if (!input.expiresAt) return Math.max(0, input.durationSeconds * 1000);
  const exp = new Date(input.expiresAt).getTime();
  if (Number.isNaN(exp)) return 0;
  return Math.max(0, exp - (input.nowMs + (input.clockOffsetMs ?? 0)));
}

/**
 * L'état explicite du backend garde la priorité : seul un ticket EN COURS dont le temps est écoulé
 * (pendant que l'écran reste affiché) devient « Expiré ». REVOKED / UNAVAILABLE ne sont jamais ressuscités.
 */
export function effectiveState(state: TicketState, usedAt: string | null, remaining: number): TicketState {
  return state === 'IN_USE' && usedAt && remaining <= 0 ? 'EXPIRED' : state;
}

/** Format humain : `3 j`, `2 j 4 h`, `8 h 17 min`, `42 min`, `< 1 min`, `Expiré` (jamais de durée négative). */
export function fmtRemaining(ms: number, expiredLabel = 'Expiré'): string {
  if (!(ms > 0)) return expiredLabel;
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d} j ${h} h` : `${d} j`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return '< 1 min';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `05/10/2026 à 08:30` (heure locale), `null` si la date est absente ou invalide. */
export function fmtDayTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} à ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Durée du forfait compacte : `3 j`, `1 j 12 h`, `2 h 30 min`, `45 min`. */
export function fmtPlanDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} j`);
  if (h) parts.push(`${h} h`);
  if (m || parts.length === 0) parts.push(`${m} min`);
  return parts.join(' ');
}
