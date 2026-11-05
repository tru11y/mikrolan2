import type { HealthLevel } from './ops-health.service';

/** Au-delà, un routeur REMOTE hors ligne ou jamais vu est un risque opérationnel. */
export const ROUTER_STALE_AFTER_MINUTES = 24 * 60;
export const ROUTER_ITEMS_MAX = 50;

export type RouterMode = 'LOCAL' | 'REMOTE';
export type RouterHealthState = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'ERROR';

/** Ligne minimale lue en base : jamais de secret (credEncrypted est réduit à un booléen). */
export interface RouterRow {
  id: string;
  name: string;
  mode: RouterMode;
  health: RouterHealthState;
  credentialsConfigured: boolean;
  lastHeartbeat: Date | null;
  createdAt: Date;
}

export interface RouterItem {
  id: string;
  name: string;
  mode: RouterMode;
  health: RouterHealthState;
  credentialsConfigured: boolean;
  lastHeartbeatAt: Date | null;
  /** OFFLINE déjà vu : minutes depuis le dernier heartbeat. */
  offlineMinutes: number | null;
  /** Jamais vu : minutes depuis la création. */
  provisionPendingMinutes: number | null;
}

export interface RoutersHealth {
  level: HealthLevel;
  total: number;
  remote: number;
  /** LOCAL : non supervisables par heartbeat/WireGuard depuis le backend, exclus de level. */
  local: number;
  online: number;
  degraded: number;
  offline: number;
  /** REMOTE au health UNKNOWN ou ERROR (jamais LOCAL) : remote = online + degraded + offline + unknown. */
  unknown: number;
  offlineOver24h: number;
  remoteWithoutCredentials: number;
  neverSeen: number;
  oldestOfflineMinutes: number | null;
  lastHeartbeatAt: Date | null;
  items: RouterItem[];
}

const minutesSince = (d: Date, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60_000));

/** Priorité RED > ORANGE > GREEN, sur les routeurs REMOTE uniquement. */
export function routersLevel(
  c: Pick<RoutersHealth, 'offlineOver24h' | 'degraded' | 'unknown' | 'remoteWithoutCredentials'> & {
    offlineRecent: number;
    neverSeenOver24h: number;
  },
): HealthLevel {
  if (c.offlineOver24h > 0) return 'RED';
  if (c.offlineRecent + c.degraded + c.unknown + c.remoteWithoutCredentials + c.neverSeenOver24h > 0) {
    return 'ORANGE';
  }
  return 'GREEN';
}

/** OFFLINE vus, jamais vus, ERROR, DEGRADED, UNKNOWN, puis le reste (ONLINE). */
function rank(r: RouterRow): number {
  if (r.health === 'OFFLINE' && r.lastHeartbeat) return 0;
  if (!r.lastHeartbeat) return 1;
  if (r.health === 'ERROR') return 2;
  if (r.health === 'DEGRADED') return 3;
  if (r.health === 'UNKNOWN') return 4;
  return 5;
}

export function summarizeRouters(rows: RouterRow[], now: Date = new Date()): RoutersHealth {
  const remote = rows.filter((r) => r.mode === 'REMOTE');
  const count = (h: RouterHealthState) => remote.filter((r) => r.health === h).length;

  const offlineSeen = remote.filter((r) => r.health === 'OFFLINE' && r.lastHeartbeat);
  const offlineAges = offlineSeen.map((r) => minutesSince(r.lastHeartbeat as Date, now));
  const offlineOver24h = offlineAges.filter((m) => m >= ROUTER_STALE_AFTER_MINUTES).length;
  const neverSeenRows = remote.filter((r) => !r.lastHeartbeat);
  const heartbeats = remote.flatMap((r) => (r.lastHeartbeat ? [r.lastHeartbeat.getTime()] : []));
  const remoteWithoutCredentials = remote.filter((r) => !r.credentialsConfigured).length;
  const degraded = count('DEGRADED');
  const unknown = count('UNKNOWN') + count('ERROR');

  // Période de grâce : jamais vu ET créé depuis moins de 24 h. Elle n'affecte que le niveau,
  // jamais les compteurs descriptifs (neverSeen, remoteWithoutCredentials, unknown…).
  const settled = remote.filter(
    (r) => r.lastHeartbeat !== null || minutesSince(r.createdAt, now) >= ROUTER_STALE_AFTER_MINUTES,
  );
  const settledCount = (pred: (r: RouterRow) => boolean) => settled.filter(pred).length;

  const level = routersLevel({
    offlineOver24h,
    offlineRecent: offlineAges.length - offlineOver24h,
    degraded: settledCount((r) => r.health === 'DEGRADED'),
    unknown: settledCount((r) => r.health === 'UNKNOWN' || r.health === 'ERROR'),
    remoteWithoutCredentials: settledCount((r) => !r.credentialsConfigured),
    neverSeenOver24h: settledCount((r) => r.lastHeartbeat === null),
  });

  const items = [...remote]
    .sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      // OFFLINE / jamais vus : le plus ancien d'abord ; sinon ordre stable par nom.
      const ka = a.lastHeartbeat ?? a.createdAt;
      const kb = b.lastHeartbeat ?? b.createdAt;
      if (rank(a) <= 1) return ka.getTime() - kb.getTime();
      return a.name.localeCompare(b.name);
    })
    .slice(0, ROUTER_ITEMS_MAX)
    .map<RouterItem>((r) => ({
      id: r.id.slice(0, 8),
      name: r.name,
      mode: r.mode,
      health: r.health,
      credentialsConfigured: r.credentialsConfigured,
      lastHeartbeatAt: r.lastHeartbeat,
      offlineMinutes:
        r.health === 'OFFLINE' && r.lastHeartbeat ? minutesSince(r.lastHeartbeat, now) : null,
      provisionPendingMinutes: r.lastHeartbeat ? null : minutesSince(r.createdAt, now),
    }));

  return {
    level,
    total: rows.length,
    remote: remote.length,
    local: rows.length - remote.length,
    online: count('ONLINE'),
    degraded,
    offline: count('OFFLINE'),
    unknown,
    offlineOver24h,
    remoteWithoutCredentials,
    neverSeen: neverSeenRows.length,
    oldestOfflineMinutes: offlineAges.length ? Math.max(...offlineAges) : null,
    lastHeartbeatAt: heartbeats.length ? new Date(Math.max(...heartbeats)) : null,
    items,
  };
}
