import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { listActive } from '../../common/routeros/hotspot.ops';
import { RouterLiveEventsService } from './router-live-events.service';
import {
  SYNC_FEED_STALE_MS,
  GATEWAY_FRESH_MS,
  GATEWAY_MAX_STALE_MS,
  GATEWAY_RETRY_COOLDOWN_MS,
  type GatewayPriority,
  type LiveSession,
  type RouterHealthState,
  type RouterLiveResult,
  type RouterLiveSnapshot,
  type SessionsSource,
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

/** KPIs par routeur (compteurs cumulés depuis le démarrage du process). */
export interface RouterKpis {
  commandsExecuted: number;
  lastCommandMs: number | null;
  commandMsTotal: number;
  refreshCount: number;
  physicalConnectionsOpened: number;
  cacheHit: number;
  cacheMiss: number;
  joinCount: number;
  timeoutCount: number;
  backoffCount: number;
  /** Cycles collecteur sautés car une lecture était déjà en vol (jamais de 2e commande concurrente). */
  queueDepth: number;
  /** Listes de sessions reçues de syncActivations (une lecture active/print → CA + live). */
  syncPublishCount: number;
  syncReadFailures: number;
  /** Phase 1B — sonde stats (/system/resource) : lectures tentées, écartées, échouées, mises en « shed », abandonnées par la deadline dure. */
  statsProbeCount: number;
  statsProbeSkipped: number;
  statsProbeFailures: number;
  statsShedCount: number;
  statsProbeDurationMs: number | null;
  collisionAborted: number;
}

const newKpis = (): RouterKpis => ({
  commandsExecuted: 0,
  lastCommandMs: null,
  commandMsTotal: 0,
  refreshCount: 0,
  physicalConnectionsOpened: 0,
  cacheHit: 0,
  cacheMiss: 0,
  joinCount: 0,
  timeoutCount: 0,
  backoffCount: 0,
  queueDepth: 0,
  syncPublishCount: 0,
  syncReadFailures: 0,
  statsProbeCount: 0,
  statsProbeSkipped: 0,
  statsProbeFailures: 0,
  statsShedCount: 0,
  statsProbeDurationMs: null,
  collisionAborted: 0,
});

/** Abonné aux événements de la synchro CA (lecture seule) : la sonde stats s'y accroche sans toucher au CA. */
export interface SyncFeedListener {
  published(routerId: string): void;
  syncFailed(routerId: string): void;
}

export type StatsState = 'PENDING' | 'FRESH' | 'STALE' | 'SHED';
const STATS_STALE_MS = 5 * 60_000;

interface ReadPlan {
  /** 'list' = liste complète (+ compteur) ; 'count' = compteur seul. */
  sessions: 'list' | 'count';
  /** Collecteur : sessions (HOT) AVANT resource (WARM) pour qu'un timeout sur CPU ne perde pas les sessions. */
  hotFirst: boolean;
  /** false = n'interroge pas CPU/RAM (WARM pas encore dû) ; les dernières valeurs sont conservées. */
  stats: boolean;
}

interface Entry {
  value?: RouterLiveSnapshot;
  inflight?: Promise<RouterLiveSnapshot>;
  lastError?: { at: number; message: string };
  /** Nombre d'abonnés ayant déclaré vouloir la liste des sessions (§5 : 0 → plus de lecture liste). */
  sessionWatchers: number;
  /** Géré par le collecteur proactif : les lecteurs HTTP ne déclenchent plus de refresh RouterOS. */
  managed: boolean;
  failures: number;
  kpis: RouterKpis;
  /** Dernière erreur RouterOS vue par syncActivations (état API, jamais l'état du tunnel). */
  syncError?: string;
  /** Phase 1B : la sonde stats est suspendue (routeur lent/chargé) ; reprise après 3 syncs calmes. */
  statsShed: boolean;
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
 *
 * Lorsque le `RouterLiveCollector` gère un routeur (`setManaged`), les lecteurs ne
 * déclenchent plus aucun refresh : ils lisent le snapshot (multi-âge) du collecteur.
 */
@Injectable()
export class RouterGatewayService {
  private readonly logger = new Logger(RouterGatewayService.name);
  private readonly entries = new Map<string, Entry>();
  private readonly syncListeners = new Set<SyncFeedListener>();

  constructor(
    private readonly remote: RemoteRouterService,
    private readonly liveEvents: RouterLiveEventsService,
  ) {}

  private entry(routerId: string): Entry {
    let e = this.entries.get(routerId);
    if (!e) {
      e = { sessionWatchers: 0, managed: false, failures: 0, kpis: newKpis(), statsShed: false };
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
   * suivants ne relisent plus que les stats + le compteur (§5). Le collecteur
   * s'en sert aussi pour accélérer la cadence HOT.
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
   * Phase 1A : les sessions de ce routeur sont alimentées par syncActivations (flag
   * ROUTER_LIVE_SYNC_PUBLISH_ENABLED, restreint à ROUTER_LIVE_ROUTER_IDS si défini).
   * Dans ce cas les lecteurs ET le collecteur ne lisent JAMAIS RouterOS pour les sessions.
   */
  syncFeedEnabled(routerId: string): boolean {
    if (process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'] !== 'true') return false;
    const ids = (process.env['ROUTER_LIVE_ROUTER_IDS'] ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return ids.length === 0 || ids.includes(routerId);
  }

  /**
   * Publie la liste lue par syncActivations (aucune lecture RouterOS ici). Best effort :
   * ne lève JAMAIS, pour que le CA reste indépendant du live.
   */
  publishSessions(routerId: string, rows: ApiRow[]): void {
    try {
      if (!this.syncFeedEnabled(routerId)) return;
      const entry = this.entry(routerId);
      const now = Date.now();
      const sessions = rows.map(mapActive);
      const prev = entry.value;
      const changed =
        !prev ||
        prev.sessionCount !== sessions.length ||
        this.signature(prev.sessions) !== this.signature(sessions);
      const wasDegraded = entry.syncError !== undefined || prev?.routerOsState === 'SLOW' || prev?.routerOsState === 'UNREACHABLE';
      const snapshot: RouterLiveSnapshot = {
        routerId,
        lastSuccessAt: now,
        health: prev?.health ?? 'ONLINE',
        routerOsState: 'RESPONSIVE',
        sessionsUpdatedAt: now,
        sessionsSource: 'SYNC_ACTIVATIONS',
        statsUpdatedAt: prev?.statsUpdatedAt ?? null,
        cpuPercent: prev?.cpuPercent ?? null,
        memoryUsedMb: prev?.memoryUsedMb ?? null,
        memoryTotalMb: prev?.memoryTotalMb ?? null,
        uptime: prev?.uptime ?? null,
        rosVersion: prev?.rosVersion ?? null,
        boardName: prev?.boardName ?? null,
        sessionCount: sessions.length,
        sessions,
      };
      entry.value = snapshot;
      entry.syncError = undefined;
      entry.lastError = undefined;
      entry.failures = 0;
      entry.kpis.syncPublishCount += 1;
      if (wasDegraded) this.liveEvents.emit({ type: 'ROUTER_LIVE_RECOVERED', routerId });
      // ROUTER_STATS à chaque publication : réinitialise l'âge côté mobile même sans changement.
      this.liveEvents.emit({ type: 'ROUTER_STATS', routerId, snapshot: this.toResult(entry, false) });
      if (changed) {
        this.liveEvents.emit({ type: 'SESSION_COUNT_CHANGED', routerId, sessionCount: sessions.length });
        this.liveEvents.emit({ type: 'SESSIONS_CHANGED', routerId, sessions });
      }
      this.notifySync('published', routerId);
    } catch (e) {
      this.logger.warn('gateway.publishSessions failed routerId=' + routerId + ' err=' + (e as Error).message);
    }
  }

  /**
   * syncActivations n'a pas pu lire RouterOS : on garde le dernier snapshot (l'âge grandit)
   * et on signale SLOW/UNREACHABLE (état de l'API, jamais le tunnel). Ne lève jamais.
   */
  noteSyncReadFailure(routerId: string, err: unknown): void {
    try {
      if (!this.syncFeedEnabled(routerId)) return;
      const entry = this.entry(routerId);
      const message = err instanceof Error ? err.message : String(err);
      const slow = this.noteFailureKind(entry, err);
      entry.kpis.syncReadFailures += 1;
      entry.syncError = message;
      entry.lastError = { at: Date.now(), message };
      if (entry.value) {
        entry.value = { ...entry.value, routerOsState: slow ? 'SLOW' : 'UNREACHABLE' };
        this.liveEvents.emit({ type: 'ROUTER_LIVE_STALE', routerId, reason: slow ? 'SLOW' : 'UNREACHABLE' });
      }
      this.notifySync('syncFailed', routerId);
    } catch (e) {
      this.logger.warn('gateway.noteSyncReadFailure failed routerId=' + routerId + ' err=' + (e as Error).message);
    }
  }

  /** S'abonne aux publications/échecs de la synchro CA. Les erreurs d'un abonné ne remontent jamais. */
  onSyncEvent(listener: SyncFeedListener): () => void {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  private notifySync(kind: keyof SyncFeedListener, routerId: string): void {
    for (const l of this.syncListeners) {
      try {
        l[kind](routerId);
      } catch (e) {
        this.logger.warn('gateway.syncListener failed routerId=' + routerId + ' err=' + (e as Error).message);
      }
    }
  }

  /**
   * Phase 1B : intègre une lecture `/system/resource` (WARM) au snapshot SANS toucher aux sessions ni à
   * `lastSuccessAt`/`routerOsState` (ils restent pilotés par la synchro CA). Ne lève jamais.
   */
  applyStats(routerId: string, res: ApiRow): boolean {
    try {
      const entry = this.entries.get(routerId);
      if (!entry?.value) return false;
      const total = res['total-memory'] ? Math.round(parseInt(res['total-memory'], 10) / 1048576) : null;
      const free = res['free-memory'] ? Math.round(parseInt(res['free-memory'], 10) / 1048576) : null;
      const cpu = res['cpu-load'] !== undefined && res['cpu-load'] !== '' ? Number(res['cpu-load']) : null;
      entry.value = {
        ...entry.value,
        statsUpdatedAt: Date.now(),
        cpuPercent: cpu !== null && Number.isFinite(cpu) ? cpu : entry.value.cpuPercent,
        memoryTotalMb: total ?? entry.value.memoryTotalMb,
        memoryUsedMb: total !== null && free !== null ? total - free : entry.value.memoryUsedMb,
        uptime: res['uptime'] ?? entry.value.uptime,
        rosVersion: res['version'] ?? entry.value.rosVersion,
        boardName: res['board-name'] ?? entry.value.boardName,
      };
      this.liveEvents.emit({ type: 'ROUTER_STATS', routerId, snapshot: this.toResult(entry, false) });
      return true;
    } catch (e) {
      this.logger.warn('gateway.applyStats failed routerId=' + routerId + ' err=' + (e as Error).message);
      return false;
    }
  }

  /** Compteurs de la sonde stats (mutation contrôlée par RouterStatsProbe uniquement). */
  statsProbeKpis(routerId: string): RouterKpis {
    return this.entry(routerId).kpis;
  }

  setStatsShed(routerId: string, shed: boolean): void {
    const e = this.entry(routerId);
    if (shed && !e.statsShed) e.kpis.statsShedCount += 1;
    e.statsShed = shed;
  }

  private signature(list: LiveSession[] | null): string {
    return list ? list.map((x) => x.id + '|' + x.user).join(',') : '';
  }

  /** Le collecteur prend (ou rend) la responsabilité des refresh de ce routeur. */
  setManaged(routerId: string, managed: boolean): void {
    this.entry(routerId).managed = managed;
  }

  isManaged(routerId: string): boolean {
    return this.entries.get(routerId)?.managed ?? false;
  }

  /** Le collecteur signale qu'il a espacé un routeur (backoff / ralentissement) : visible dans les KPIs. */
  noteBackoff(routerId: string): void {
    this.entry(routerId).kpis.backoffCount += 1;
  }

  kpis(routerId: string): RouterKpis & { sessionsAgeMs: number | null; statsAgeMs: number | null; watcherCount: number; statsState: StatsState } {
    const e = this.entry(routerId);
    const now = Date.now();
    const v = e.value;
    return {
      ...e.kpis,
      sessionsAgeMs: v?.sessionsUpdatedAt ? now - v.sessionsUpdatedAt : null,
      statsAgeMs: v?.statsUpdatedAt ? now - v.statsUpdatedAt : null,
      watcherCount: e.sessionWatchers,
      statsState: e.statsShed ? 'SHED' : !v?.statsUpdatedAt ? 'PENDING' : now - v.statsUpdatedAt > STATS_STALE_MS ? 'STALE' : 'FRESH',
    };
  }

  /** Dernier snapshot connu, sans jamais toucher RouterOS ; `null` si rien n'a encore été lu. */
  peek(routerId: string): RouterLiveResult | null {
    const e = this.entries.get(routerId);
    if (!e?.value) return null;
    e.kpis.cacheHit += 1;
    return this.toResult(e, e.lastError !== undefined);
  }

  /**
   * Un cycle de collecte (appelé UNIQUEMENT par le collecteur). Une seule lecture
   * en vol par routeur : si une est déjà en cours, ne lance rien (renvoie `null`).
   */
  async collect(routerId: string, plan: { stats: boolean }): Promise<RouterLiveSnapshot | null> {
    const entry = this.entry(routerId);
    if (entry.inflight) {
      entry.kpis.queueDepth += 1;
      return null;
    }
    return this.refresh(routerId, entry, { sessions: 'list', stats: plan.stats, hotFirst: true }, 'P2_COLLECTOR_HOT');
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

    // Collecteur proactif : le VPS connaît déjà l'état. On sert le snapshot tel quel
    // (avec ses âges), jamais de lecture RouterOS déclenchée par un lecteur.
    const feed = this.syncFeedEnabled(routerId);
    if (entry.value && (entry.managed || feed)) {
      entry.kpis.cacheHit += 1;
      return this.toResult(entry, entry.lastError !== undefined);
    }
    // Phase 1A, aucun snapshot encore (redémarrage du VPS) : état INCONNU, jamais « 0 session »
    // ni lecture RouterOS déclenchée par le mobile — le prochain cycle syncActivations le remplit.
    if (!entry.value && feed) {
      entry.kpis.cacheMiss += 1;
      return this.unknownResult(routerId);
    }

    if (entry.value && age < minFreshnessMs) {
      entry.kpis.cacheHit += 1;
      this.log('cache', routerId, { status: 'HIT', ageMs: age, priority });
      return this.toResult(entry, false);
    }

    if (entry.value && age < GATEWAY_MAX_STALE_MS) {
      const cooling =
        entry.lastError !== undefined && now - entry.lastError.at < GATEWAY_RETRY_COOLDOWN_MS;
      if (entry.inflight) {
        entry.kpis.joinCount += 1;
        this.log('cache', routerId, { status: 'JOIN', ageMs: age, priority });
      } else if (!cooling) {
        this.log('cache', routerId, { status: 'STALE', ageMs: age, priority });
        void this.refresh(routerId, entry, this.onDemandPlan(entry, wantSessions), priority);
      } else {
        this.log('cache', routerId, { status: 'STALE_COOLDOWN', ageMs: age, priority });
      }
      return this.toResult(entry, true);
    }

    if (entry.inflight) {
      entry.kpis.joinCount += 1;
      this.log('cache', routerId, { status: 'JOIN', priority });
      const snapshot = await entry.inflight;
      return this.toResult({ ...entry, value: snapshot }, false);
    }

    // Cold-start (aucun snapshot n'a jamais réussi) : sans ce garde, chaque appel
    // rouvrirait sa propre connexion RouterOS pendant que le routeur est en panne
    // (trouvé lors du test terrain Gateway ON — le RB951 martelé sans frein).
    // Le cooldown est indépendant de l'existence d'un snapshot : `entry.lastError`
    // seul suffit à le déclencher, qu'il y ait ou non une valeur en cache.
    const cooling = entry.lastError !== undefined && now - entry.lastError.at < GATEWAY_RETRY_COOLDOWN_MS;
    if (cooling) {
      this.log('cache', routerId, { status: 'COLD_COOLDOWN', priority });
      throw new BusinessException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.ROUTER_UNREACHABLE,
        entry.lastError!.message,
      );
    }

    entry.kpis.cacheMiss += 1;
    this.log('cache', routerId, { status: 'MISS', priority });
    const snapshot = await this.refresh(routerId, entry, this.onDemandPlan(entry, wantSessions), priority);
    return this.toResult({ ...entry, value: snapshot }, false);
  }

  private unknownResult(routerId: string): RouterLiveResult {
    return {
      routerId,
      lastSuccessAt: 0,
      health: 'UNKNOWN',
      routerOsState: 'UNKNOWN',
      sessionsUpdatedAt: null,
      sessionsSource: null,
      statsUpdatedAt: null,
      cpuPercent: null,
      memoryUsedMb: null,
      memoryTotalMb: null,
      uptime: null,
      rosVersion: null,
      boardName: null,
      sessionCount: null,
      sessions: null,
      ageMs: 0,
      sessionsAgeMs: null,
      statsAgeMs: null,
      stale: true,
      refreshing: false,
      lastError: null,
    };
  }

  private toResult(entry: Entry, staleIn: boolean): RouterLiveResult {
    const value = entry.value as RouterLiveSnapshot;
    const now = Date.now();
    // Alimentation par sync : une liste trop vieille est « retardée », jamais « à jour ».
    const stale =
      staleIn ||
      (value.sessionsSource === 'SYNC_ACTIVATIONS' &&
        value.sessionsUpdatedAt !== null &&
        now - value.sessionsUpdatedAt > SYNC_FEED_STALE_MS);
    return {
      ...value,
      ageMs: now - value.lastSuccessAt,
      sessionsAgeMs: value.sessionsUpdatedAt ? now - value.sessionsUpdatedAt : null,
      statsAgeMs: value.statsUpdatedAt ? now - value.statsUpdatedAt : null,
      stale,
      refreshing: entry.inflight !== undefined,
      lastError: stale ? (entry.lastError?.message ?? null) : null,
    };
  }

  private onDemandPlan(entry: Entry, wantSessions: boolean): ReadPlan {
    return {
      sessions: wantSessions || entry.sessionWatchers > 0 ? 'list' : 'count',
      hotFirst: false,
      stats: true,
    };
  }

  /** Mesure une commande RouterOS (toujours awaitée séquentiellement : UNE à la fois). */
  private async timed<T>(entry: Entry, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      const d = Date.now() - t;
      entry.kpis.commandsExecuted += 1;
      entry.kpis.lastCommandMs = d;
      entry.kpis.commandMsTotal += d;
    }
  }

  /** Compte les timeouts ; vrai si l'erreur est un timeout (routeur lent plutôt qu'injoignable). */
  private noteFailureKind(entry: Entry, err: unknown): boolean {
    const slow = /timeout|timed out/i.test(err instanceof Error ? err.message : String(err));
    if (slow) entry.kpis.timeoutCount += 1;
    return slow;
  }

  /** Un seul refresh par routeur ; jamais deux commandes RouterOS concurrentes sur la même connexion. */
  private refresh(
    routerId: string,
    entry: Entry,
    plan: ReadPlan,
    priority: GatewayPriority,
  ): Promise<RouterLiveSnapshot> {
    const t0 = Date.now();
    const includeSessions = plan.sessions === 'list';
    entry.kpis.refreshCount += 1;
    entry.kpis.physicalConnectionsOpened += 1;
    const inflight = this.remote
      .run(routerId, async (c) => {
        const readResource = () =>
          this.timed(entry, () =>
            c.command([
              '/system/resource/print',
              '=.proplist=cpu-load,total-memory,free-memory,uptime,version,board-name',
            ]),
          );
        const readSessions = async (): Promise<{ active: ApiRow[] | null; count: number | null }> => {
          // `count-only` n'étant pas plus rapide de façon garantie (bench RB951), on ne le
          // préfère que lorsque la liste n'est pas demandée — jamais les deux lectures.
          if (plan.sessions === 'list') {
            const active = await this.timed(entry, () => listActive(c));
            return { active, count: active.length };
          }
          const rows = await this.timed(entry, () => c.command(['/ip/hotspot/active/print', '=count-only=']));
          const ret = rows[0]?.['ret'];
          return { active: null, count: ret !== undefined ? Number.parseInt(ret, 10) : null };
        };

        let resource: ApiRow[] | null = null;
        let sessionsRead: { active: ApiRow[] | null; count: number | null };
        if (plan.hotFirst) {
          sessionsRead = await readSessions();
          if (plan.stats) {
            try {
              resource = await readResource();
            } catch (e) {
              // Les sessions (HOT) sont déjà lues : un échec sur CPU/RAM (WARM) ne les jette pas.
              this.noteFailureKind(entry, e);
            }
          }
        } else {
          resource = await readResource();
          sessionsRead = await readSessions();
        }

        const now = Date.now();
        const prev = entry.value;
        const res = resource ? (resource[0] ?? {}) : null;
        const total = res?.['total-memory'] ? Math.round(parseInt(res['total-memory'], 10) / 1048576) : null;
        const free = res?.['free-memory'] ? Math.round(parseInt(res['free-memory'], 10) / 1048576) : null;
        const snapshot: RouterLiveSnapshot = {
          routerId,
          lastSuccessAt: now,
          health: 'ONLINE',
          routerOsState: 'RESPONSIVE',
          sessionsUpdatedAt: now,
          sessionsSource: priority === 'P2_COLLECTOR_HOT' ? 'COLLECTOR' : 'ON_DEMAND',
          statsUpdatedAt: res ? now : (prev?.statsUpdatedAt ?? null),
          cpuPercent: res ? (res['cpu-load'] ? Number(res['cpu-load']) : null) : (prev?.cpuPercent ?? null),
          memoryUsedMb: res ? (total !== null && free !== null ? total - free : null) : (prev?.memoryUsedMb ?? null),
          memoryTotalMb: res ? total : (prev?.memoryTotalMb ?? null),
          uptime: res ? (res['uptime'] ?? null) : (prev?.uptime ?? null),
          rosVersion: res ? (res['version'] ?? null) : (prev?.rosVersion ?? null),
          boardName: res ? (res['board-name'] ?? null) : (prev?.boardName ?? null),
          sessionCount: sessionsRead.count,
          sessions: sessionsRead.active ? sessionsRead.active.map(mapActive) : null,
        };
        return snapshot;
      })
      .then(
        (snapshot) => {
          // Une session non redemandée depuis reste affichée (mieux qu'un trou) tant
          // qu'un futur refresh ne la remplace pas explicitement.
          if (!includeSessions && entry.value?.sessions) snapshot.sessions = entry.value.sessions;
          const wasOffline = entry.value?.health === 'OFFLINE';
          const previousCount = entry.value?.sessionCount ?? null;
          entry.value = snapshot;
          entry.lastError = undefined;
          entry.failures = 0;
          entry.inflight = undefined;
          this.log('refresh', routerId, { status: 'DONE', durationMs: Date.now() - t0, includeSessions, priority });
          if (wasOffline) this.liveEvents.emit({ type: 'ROUTER_LIVE_RECOVERED', routerId });
          this.liveEvents.emit({ type: 'ROUTER_STATS', routerId, snapshot: this.toResult(entry, false) });
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
          const slow = this.noteFailureKind(entry, err);
          entry.failures += 1;
          // Collecteur : API RouterOS en échec ≠ tunnel coupé. L'état du tunnel vient du heartbeat
          // WireGuard (jamais d'ici) : un routeur géré reste ONLINE, seul `routerOsState` change.
          const goesOffline = !entry.managed;
          const wasHealthy = entry.value === undefined || entry.value.health !== 'OFFLINE';
          entry.lastError = { at: Date.now(), message };
          entry.inflight = undefined;
          if (entry.value) {
            entry.value = {
              ...entry.value,
              health: goesOffline ? 'OFFLINE' : entry.value.health,
              routerOsState: slow ? 'SLOW' : 'UNREACHABLE',
            };
          }
          this.log('refresh', routerId, { status: 'ERROR', durationMs: Date.now() - t0, error: message, failures: entry.failures });
          if (entry.value && (entry.managed || (goesOffline && wasHealthy))) {
            this.liveEvents.emit({ type: 'ROUTER_LIVE_STALE', routerId, reason: slow ? 'SLOW' : 'UNREACHABLE' });
          }
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
