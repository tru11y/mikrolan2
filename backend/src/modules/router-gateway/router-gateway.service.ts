import { Injectable, Logger } from '@nestjs/common';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { listActive } from '../../common/routeros/hotspot.ops';
import { RouterLiveEventsService } from './router-live-events.service';
import {
  GATEWAY_FRESH_MS,
  GATEWAY_MAX_STALE_MS,
  GATEWAY_RETRY_COOLDOWN_MS,
  type GatewayPriority,
  type LiveSession,
  type RouterHealthState,
  type RouterLiveResult,
  type RouterLiveSnapshot,
  type SnapshotWant,
} from './router-gateway.types';
import type { ApiRow } from '../../common/routeros/routeros-api.client';

function mapActive(row: ApiRow): LiveSession {
  return {
    id: row['.id'] ?? '',
    user: row.user ?? '',
    ipAddress: row.address ?? null,
    macAddress: row['mac-address'] ?? null,
    bytesIn: row['bytes-in'] ?? '0',
    bytesOut: row['bytes-out'] ?? '0',
    uptime: row.uptime ?? null,
  };
}

interface Entry {
  value?: RouterLiveSnapshot;
  inflight?: Promise<RouterLiveSnapshot>;
  lastError?: { at: number; message: string };
  /** Nombre d'abonnés ayant déclaré vouloir la liste des sessions (§5 : 0 → plus de lecture liste). */
  sessionWatchers: number;
}

/**
 * Coordonne les lectures live RouterOS par routeur, pour l'UI et la télémétrie
 * (Phase 1, `docs`/§ 1-5 du cadrage). `syncActivations`/`syncRouter` (#44) ne
 * passent PAS par ici et n'en dépendent d'aucune façon : ce service n'a aucune
 * incidence sur le calcul du CA, quel que soit `ROUTER_GATEWAY_ENABLED`.
 *
 * Politique : jamais d'écran vide. La dernière valeur connue est toujours servie
 * immédiatement ; au plus UN refresh RouterOS par routeur est en vol à la fois,
 * quel que soit le nombre d'appelants concurrents (déduplication).
 */
@Injectable()
export class RouterGatewayService {
  private readonly logger = new Logger(RouterGatewayService.name);
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly remote: RemoteRouterService,
    private readonly liveEvents: RouterLiveEventsService,
  ) {}

  private entry(routerId: string): Entry {
    let e = this.entries.get(routerId);
    if (!e) {
      e = { sessionWatchers: 0 };
      this.entries.set(routerId, e);
    }
    return e;
  }

  /** Nombre d'abonnés « sessions » actifs pour ce routeur (observabilité + décision de refresh). */
  watchers(routerId: string): number {
    return this.entries.get(routerId)?.sessionWatchers ?? 0;
  }

  /**
   * Déclare un intérêt actif pour la LISTE des sessions d'un routeur (écran
   * Sessions ouvert). Tant qu'au moins un abonné est présent, les refresh
   * incluent la liste complète ; dès le dernier désabonnement, les refresh
   * suivants ne relisent plus que les stats + le compteur (§5).
   */
  watch(routerId: string): () => void {
    const e = this.entry(routerId);
    e.sessionWatchers += 1;
    let released = false;
    return () => {
      if (released) return; // idempotent : un double appel ne fait pas mentir le compteur
      released = true;
      e.sessionWatchers = Math.max(0, e.sessionWatchers - 1);
    };
  }

  /**
   * Lit le snapshot courant, en servant immédiatement la dernière valeur connue
   * (même périmée) et en ne déclenchant JAMAIS plus d'un refresh RouterOS en vol
   * par routeur. `want: 'sessions'|'both'` inclut la liste dans CE refresh si un
   * en est déclenché ; `minFreshnessMs` permet à un appelant tolérant (Telemetry)
   * d'accepter une donnée plus ancienne sans forcer de lecture.
   */
  async getLiveSnapshot(
    routerId: string,
    want: SnapshotWant,
    opts?: { priority?: GatewayPriority; minFreshnessMs?: number },
  ): Promise<RouterLiveResult> {
    const priority = opts?.priority ?? 'P2_LIVE_UI';
    const minFreshnessMs = opts?.minFreshnessMs ?? GATEWAY_FRESH_MS;
    const entry = this.entry(routerId);
    const wantSessions = want === 'sessions' || want === 'both';
    const now = Date.now();
    const age = entry.value ? now - entry.value.lastSuccessAt : Infinity;

    if (entry.value && age < minFreshnessMs) {
      this.log('cache', routerId, { status: 'HIT', ageMs: age, priority });
      return this.toResult(entry, false);
    }

    if (entry.value && age < GATEWAY_MAX_STALE_MS) {
      const cooling =
        entry.lastError !== undefined && now - entry.lastError.at < GATEWAY_RETRY_COOLDOWN_MS;
      if (entry.inflight) {
        this.log('cache', routerId, { status: 'JOIN', ageMs: age, priority });
      } else if (!cooling) {
        this.log('cache', routerId, { status: 'STALE', ageMs: age, priority });
        void this.refresh(routerId, entry, wantSessions, priority);
      } else {
        this.log('cache', routerId, { status: 'STALE_COOLDOWN', ageMs: age, priority });
      }
      return this.toResult(entry, true);
    }

    this.log('cache', routerId, { status: entry.inflight ? 'JOIN' : 'MISS', priority });
    const snapshot = await (entry.inflight ?? this.refresh(routerId, entry, wantSessions, priority));
    return this.toResult({ ...entry, value: snapshot }, false);
  }

  private toResult(entry: Entry, stale: boolean): RouterLiveResult {
    const value = entry.value as RouterLiveSnapshot;
    return {
      ...value,
      ageMs: Date.now() - value.lastSuccessAt,
      stale,
      refreshing: entry.inflight !== undefined,
      lastError: stale ? (entry.lastError?.message ?? null) : null,
    };
  }

  /** Un seul refresh par routeur ; jamais deux commandes RouterOS concurrentes sur la même connexion. */
  private refresh(
    routerId: string,
    entry: Entry,
    wantSessions: boolean,
    priority: GatewayPriority,
  ): Promise<RouterLiveSnapshot> {
    const t0 = Date.now();
    const includeSessions = wantSessions || entry.sessionWatchers > 0;
    const inflight = this.remote
      .run(
        routerId,
        async (c) => {
          const resource = await c.command([
            '/system/resource/print',
            '=.proplist=cpu-load,total-memory,free-memory,uptime,version,board-name',
          ]);
          // Le compteur de sessions fait toujours partie des « stats » (§2/§5 du
          // cadrage) ; seule la LISTE complète est conditionnée par un intérêt
          // explicite. `count-only` n'étant pas plus rapide de façon garantie
          // (bench RB951), on ne le préfère que lorsque la liste n'est pas
          // demandée — jamais les deux lectures à la fois.
          let active: ApiRow[] | null = null;
          let sessionCount: number | null;
          if (includeSessions) {
            active = await listActive(c);
            sessionCount = active.length;
          } else {
            const countRows = await c.command(['/ip/hotspot/active/print', '=count-only=']);
            const ret = countRows[0]?.['ret'];
            sessionCount = ret !== undefined ? Number.parseInt(ret, 10) : null;
          }
          const res = resource[0] ?? {};
          const total = res['total-memory'] ? Math.round(parseInt(res['total-memory'], 10) / 1048576) : null;
          const free = res['free-memory'] ? Math.round(parseInt(res['free-memory'], 10) / 1048576) : null;
          const snapshot: RouterLiveSnapshot = {
            routerId,
            lastSuccessAt: Date.now(),
            health: 'ONLINE',
            cpuPercent: res['cpu-load'] ? Number(res['cpu-load']) : null,
            memoryUsedMb: total !== null && free !== null ? total - free : null,
            memoryTotalMb: total,
            uptime: res['uptime'] ?? null,
            rosVersion: res['version'] ?? null,
            boardName: res['board-name'] ?? null,
            sessionCount,
            sessions: active ? active.map(mapActive) : null,
          };
          return snapshot;
        },
      )
      .then(
        (snapshot) => {
          // Une session non redemandée depuis reste affichée (mieux qu'un trou) tant
          // qu'un futur refresh ne la remplace pas explicitement.
          if (!includeSessions && entry.value?.sessions) snapshot.sessions = entry.value.sessions;
          const wasOffline = entry.value?.health === 'OFFLINE';
          const previousCount = entry.value?.sessionCount ?? null;
          entry.value = snapshot;
          entry.lastError = undefined;
          entry.inflight = undefined;
          this.log('refresh', routerId, { status: 'DONE', durationMs: Date.now() - t0, includeSessions });
          if (wasOffline) this.liveEvents.emit({ type: 'ROUTER_LIVE_RECOVERED', routerId });
          this.liveEvents.emit({ type: 'ROUTER_STATS', routerId, snapshot });
          if (
            snapshot.sessionCount !== null &&
            previousCount !== null &&
            snapshot.sessionCount !== previousCount
          ) {
            this.liveEvents.emit({ type: 'SESSION_COUNT_CHANGED', routerId, sessionCount: snapshot.sessionCount });
            if (includeSessions) this.liveEvents.emit({ type: 'SESSIONS_CHANGED', routerId, sessions: snapshot.sessions ?? [] });
          }
          return snapshot;
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const wasHealthy = entry.value === undefined || entry.value.health !== 'OFFLINE';
          entry.lastError = { at: Date.now(), message };
          entry.inflight = undefined;
          if (entry.value) entry.value = { ...entry.value, health: 'OFFLINE' };
          this.log('refresh', routerId, { status: 'ERROR', durationMs: Date.now() - t0, error: message });
          if (wasHealthy) this.liveEvents.emit({ type: 'ROUTER_LIVE_STALE', routerId });
          throw err;
        },
      );
    // Un refresh de fond dont personne n'attend le résultat ne doit pas rejeter à vide.
    inflight.catch(() => undefined);
    entry.inflight = inflight;
    return inflight;
  }

  private log(event: string, routerId: string, data: Record<string, unknown>): void {
    this.logger.log(`gateway.${event} routerId=${routerId} ${JSON.stringify(data)}`);
  }
}

export type { RouterHealthState, RouterLiveResult, RouterLiveSnapshot, SnapshotWant };
