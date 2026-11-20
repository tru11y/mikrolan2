import type { AcctStatusType } from './dto/radius.schemas';

/** 2^32 : palier d'un Gigaword RADIUS (RFC 2869 §5.1/5.2). */
const TWO_POW_32 = 1n << 32n;

/**
 * Reconstitue le compteur d'octets 64 bits transmis par RADIUS en deux parties :
 * les 32 bits de poids faible (`Acct-Input/Output-Octets`) et le nombre de
 * débordements de 2^32 (`Acct-Input/Output-Gigawords`).
 */
export function assembleOctets(low: bigint, gigawords: bigint): bigint {
  return low + gigawords * TWO_POW_32;
}

/**
 * Format `Mikrotik-Rate-Limit` = "rx/tx" du point de vue du CLIENT (rx = upload
 * client, tx = download client), en kbps. Aligné sur `ensureUserProfile`
 * (hotspot.ops). Renvoie `undefined` si l'un des deux débits est absent (illimité).
 */
export function mikrotikRateLimit(
  uploadKbps?: number | null,
  downloadKbps?: number | null,
): string | undefined {
  if (uploadKbps && downloadKbps) return `${uploadKbps}k/${downloadKbps}k`;
  return undefined;
}

/** Évènement au niveau NAS (démarrage/arrêt du NAS), sans session utilisateur. */
export function isNasLevelStatus(status: AcctStatusType): boolean {
  return status === 'Accounting-On' || status === 'Accounting-Off';
}
