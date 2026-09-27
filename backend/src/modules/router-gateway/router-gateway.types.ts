/**
 * Copie volontaire de la forme `LiveSession` de `SessionsService` (et non un
 * import) : le Gateway ne doit dépendre d'aucun symbole de #43/#44, pour
 * garantir par construction qu'aucune modification ici ne peut se propager
 * vers `syncActivations`.
 */
export interface LiveSession {
  id: string;
  user: string;
  ipAddress: string | null;
  macAddress: string | null;
  bytesIn: string;
  bytesOut: string;
  uptime: string | null;
}

/** File d'attente d'un routeur : P0/P1 ne passent jamais par ici (Phase 1, §7). */
export type GatewayPriority = 'P2_LIVE_UI' | 'P3_TELEMETRY';

export type RouterHealthState = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export interface RouterLiveSnapshot {
  routerId: string;
  /** ms epoch de la dernière lecture RouterOS réussie. */
  lastSuccessAt: number;
  health: RouterHealthState;
  cpuPercent: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  uptime: string | null;
  rosVersion: string | null;
  boardName: string | null;
  sessionCount: number | null;
  /** Présent uniquement si un `want: 'sessions'` a été demandé au moins une fois. */
  sessions: LiveSession[] | null;
}

export interface RouterLiveResult extends RouterLiveSnapshot {
  /** ms écoulées depuis `lastSuccessAt`. */
  ageMs: number;
  /** age > seuil de fraîcheur : servi quand même, jamais un écran vide. */
  stale: boolean;
  /** un refresh est actuellement en vol pour ce routeur. */
  refreshing: boolean;
  /** dernière erreur de refresh, seulement si la donnée servie est plus ancienne qu'elle. */
  lastError: string | null;
}

export type SnapshotWant = 'stats' | 'sessions' | 'both';

export const GATEWAY_FRESH_MS = 8_000;
export const GATEWAY_MAX_STALE_MS = 10 * 60_000;
export const GATEWAY_RETRY_COOLDOWN_MS = 15_000;
// Sonde toutes les 3 min quand aucun watcher n'observe le routeur ; pas de lecture
// du tout si personne ne regarde (Phase 1, §5 : « ne pas faire de liste agressive
// uniquement pour l'UI » — ici étendu à toutes les lectures live).
export const GATEWAY_IDLE_PROBE_MS = 3 * 60_000;
