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
export type GatewayPriority = 'P2_LIVE_UI' | 'P3_TELEMETRY' | 'P2_COLLECTOR_HOT' | 'P3_COLLECTOR_WARM';

export type RouterOsState = 'RESPONSIVE' | 'SLOW' | 'UNREACHABLE' | 'UNKNOWN';

export type SessionsSource = 'SYNC_ACTIVATIONS' | 'COLLECTOR' | 'ON_DEMAND';

export type RouterHealthState = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export interface RouterLiveSnapshot {
  routerId: string;
  /** ms epoch de la dernière lecture RouterOS réussie. */
  lastSuccessAt: number;
  health: RouterHealthState;
  /** État du moteur API RouterOS, distinct du tunnel : SLOW = timeout mais routeur pas déclaré hors ligne. */
  routerOsState: RouterOsState;
  /** ms epoch de la dernière lecture réussie de la liste/compteur de sessions (HOT). */
  sessionsUpdatedAt: number | null;
  /** Origine de la dernière liste de sessions : une seule lecture active/print peut servir CA + live. */
  sessionsSource: SessionsSource | null;
  /** ms epoch de la dernière lecture réussie CPU/RAM/uptime (WARM ; version/board = COLD, même commande). */
  statsUpdatedAt: number | null;
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
  sessionsAgeMs: number | null;
  statsAgeMs: number | null;
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

// ── Collecteur proactif (cadence adaptative) ────────────────────────────────
export const COLLECTOR_TICK_MS = 2_000;
export const COLLECTOR_HOT_WATCHED_MS = 8_000;
export const COLLECTOR_HOT_IDLE_MS = 15_000;
export const COLLECTOR_WARM_MS = 30_000;
/** Une lecture ne doit pas occuper le routeur plus de ~1/3 du temps : intervalle ≥ durée × 3. */
export const COLLECTOR_DUTY_FACTOR = 3;
export const COLLECTOR_MAX_INTERVAL_MS = 120_000;
export const COLLECTOR_BACKOFF_BASE_MS = 30_000;
export const COLLECTOR_BACKOFF_CAP_MS = 5 * 60_000;
/** Échecs consécutifs avant de déclarer le routeur OFFLINE (un seul timeout = SLOW, pas OFFLINE). */
export const COLLECTOR_OFFLINE_AFTER_FAILURES = 3;

// ── Phase 1A : sessions alimentées par syncActivations (aucune lecture RouterOS en plus) ──
// syncActivations ≈ 25 s : au-delà de ~1,8 cycle la donnée est annoncée « retardée » (jamais « 0 session »).
export const SYNC_FEED_STALE_MS = 45_000;
