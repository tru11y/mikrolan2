/**
 * Logique pure de l'écran « Vérifier un ticket », isolée SANS import runtime (react-native,
 * axios…) pour pouvoir la couvrir avec `node --test` (convention : `metricsCsvRows.test.ts`).
 *
 * Aucune date d'expiration ni temps restant : MikroLan ne persiste pas d'expiration et
 * `limit-uptime` RouterOS compte le temps de connexion cumulé, une estimation serait trompeuse.
 */

/** Doit refléter `TicketState` du backend (voucher.service.ts). */
export type TicketState =
  | 'AVAILABLE'
  | 'IN_USE'
  | 'USED'
  | 'ENDED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'UNAVAILABLE';

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
  USED: { tone: 'used', icon: 'checkmark-done-outline', title: 'states.USED', detail: 'stateDetails.USED' },
  ENDED: { tone: 'used', icon: 'checkmark-done-outline', title: 'states.ENDED', detail: 'stateDetails.ENDED' },
  EXPIRED: { tone: 'invalid', icon: 'time-outline', title: 'states.EXPIRED', detail: 'stateDetails.EXPIRED' },
  REVOKED: { tone: 'invalid', icon: 'ban-outline', title: 'states.REVOKED', detail: 'stateDetails.REVOKED' },
  UNAVAILABLE: { tone: 'invalid', icon: 'warning-outline', title: 'states.UNAVAILABLE', detail: 'stateDetails.UNAVAILABLE' },
};

/** Titre et ton du verdict d'après l'état métier renvoyé par le backend (jamais « valide » si non provisionné). */
export function verdictSpec(state: TicketState): VerdictSpec {
  return SPEC[state] ?? SPEC.UNAVAILABLE;
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
