/**
 * Affichage de l'état WireGuard d'un peer (vue Super Admin). Module SANS import runtime :
 * testable avec `node --test`. Règle : inconnu (null) ≠ 0.
 */
export type WgPeerState =
  | 'HEALTHY'
  | 'STALE'
  | 'NEVER'
  | 'UNKNOWN'
  | 'PENDING'
  | 'REVOKED'
  | 'ERROR';

export type WgTone = 'success' | 'danger' | 'warning' | 'muted' | 'gold';

export const WG_STATE_META: Record<WgPeerState, { label: string; tone: WgTone }> = {
  HEALTHY: { label: 'Healthy', tone: 'success' },
  STALE: { label: 'Stale', tone: 'warning' },
  NEVER: { label: 'Never', tone: 'danger' },
  UNKNOWN: { label: 'Inconnu', tone: 'muted' },
  PENDING: { label: 'Pending', tone: 'gold' },
  REVOKED: { label: 'Revoked', tone: 'muted' },
  ERROR: { label: 'Error', tone: 'danger' },
};

/** `42 s`, `3 min`, `5 h`, `2 j` ; `—` si inconnu. */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} j`;
}

/** `512 o`, `1,5 Ko`, `3,2 Mo`, `1,0 Go` ; `—` si inconnu (0 reste `0 o`). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let value = Math.max(0, bytes);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const text = i === 0 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');
  return `${text} ${units[i]}`;
}

export interface WgHandshakeInfo {
  state: WgPeerState;
  handshakeAgeS: number | null;
  provisionedAt: string | null;
}

export function handshakeLine(row: WgHandshakeInfo, nowMs: number = Date.now()): string {
  if (row.handshakeAgeS != null) return `Handshake il y a ${formatAge(row.handshakeAgeS)}`;
  if (row.state === 'NEVER' && row.provisionedAt) {
    const since = (nowMs - Date.parse(row.provisionedAt)) / 1000;
    if (Number.isFinite(since)) return `Jamais de handshake (actif depuis ${formatAge(since)})`;
  }
  return row.state === 'UNKNOWN' ? 'Handshake indisponible' : 'Jamais de handshake';
}

/** Piste de diagnostic affichée sous la carte ; `null` si rien à signaler. */
export function stateHint(row: WgHandshakeInfo): string | null {
  switch (row.state) {
    case 'NEVER':
      return "Peer actif mais le tunnel ne s'est jamais établi : config WireGuard non poussée sur le routeur ou clés divergentes.";
    case 'STALE':
      return `Tunnel silencieux depuis ${formatAge(row.handshakeAgeS)} : routeur éteint, WAN coupé ou UDP bloqué.`;
    case 'UNKNOWN':
      return "Lecture WireGuard du serveur indisponible : l'état réel du tunnel n'est pas connu.";
    case 'ERROR':
      return 'Peer en erreur côté serveur.';
    case 'PENDING':
      return 'Provisioning en cours ou interrompu.';
    default:
      return null;
  }
}

/** La confirmation de révocation compare le nom saisi à l'alias (ou l'identité), casse ignorée. */
export function revokeConfirmed(typed: string, alias: string | null, identity: string): boolean {
  const expected = (alias || identity).trim().toLowerCase();
  return expected.length > 0 && typed.trim().toLowerCase() === expected;
}
