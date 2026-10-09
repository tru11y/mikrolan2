import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RouterHealth, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { setTenantContext, tenantStore } from '../../common/context/tenant-context';
import { DeadlineExceededError, withDeadline } from '../../common/utils/with-deadline';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { RouterGatewayService, type SyncFeedListener } from './router-gateway.service';

/**
 * Phase 1B (Option A) — sonde CPU/RAM/uptime pour les routeurs dont les sessions viennent de syncActivations.
 *
 * Elle ne fait QU'UNE chose : `/system/resource/print` (1 connexion, 1 login, 1 commande), 4 s après une
 * synchro CA réussie, au plus toutes les 120 s par routeur. Elle ne lit jamais `/ip/hotspot/active`, ne modifie
 * ni la synchro CA ni son ordonnanceur, et n'écrit que les champs stats du snapshot (`applyStats`).
 *
 * Anti-collision : la synchro suivante démarre ≈ `startedAt + max(25 s, 2 × durée)` (RouterSyncScheduler) ; la sonde
 * démarre à END + 4 s et sa durée est BORNÉE (3 étapes × 3 s = 9 s, deadline dure 13 s) : elle est terminée ≥ 9 s avant.
 * Jamais pendant une synchro : elle n'est armée que depuis la publication d'une synchro réussie, et annulée dès qu'une
 * synchro échoue. Une seule sonde par routeur, pool global = 1.
 *
 * Flags : `ROUTER_LIVE_STATS_PROBE_ENABLED=true` ET routeur listé dans `ROUTER_LIVE_STATS_ROUTER_IDS` (liste explicite,
 * vide = aucun) ET `ROUTER_LIVE_SYNC_PUBLISH_ENABLED` pour ce routeur. Tous OFF par défaut.
 */
export const STATS_START_DELAY_MS = 4_000;
export const STATS_CADENCE_MS = 120_000;
export const STATS_NORMAL_CADENCE_MS = 300_000;
export const STATS_SLOW_CADENCE_MS = 600_000;
export const STATS_BACKOFF_BASE_MS = 120_000;
export const STATS_BACKOFF_CAP_MS = 600_000;
/** Timeout de CHAQUE étape (connexion, login, commande) : pire cas 3 × 3 s = 9 s. */
export const STATS_STEP_TIMEOUT_MS = 3_000;
export const STATS_HARD_DEADLINE_MS = 13_000;
export const STATS_CALM_MS = 3_000;
export const STATS_SLOW_PROBE_MS = 5_000;
/** Intervalle entre deux publications de synchro au-delà duquel le routeur est jugé lent (cadence normale ≈ 25–30 s). */
export const STATS_SYNC_INTERVAL_MAX_MS = 40_000;
export const STATS_RECOVERY_SYNCS = 3;
const TUNNEL_STALE_MS = 150_000;
const PROPLIST = '=.proplist=cpu-load,total-memory,free-memory,uptime,version,board-name';

export type SkipReason = 'DISABLED' | 'SHED' | 'SYNC_SLOW' | 'CADENCE' | 'BACKOFF' | 'POOL_BUSY' | 'TUNNEL_DOWN' | 'NO_ROUTER';

interface State {
  lastAttemptAt: number;
  nextAllowedAt: number;
  failures: number;
  prevPublishAt: number | null;
  lastPublishAt: number | null;
  consecutiveSyncOk: number;
  shed: boolean;
  timer?: ReturnType<typeof setTimeout>;
  inflight: boolean;
}

const jitter = (ms: number, spread: number): number => Math.round(ms * (1 - spread + Math.random() * 2 * spread));

@Injectable()
export class RouterStatsProbe implements OnModuleInit, OnModuleDestroy, SyncFeedListener {
  private readonly logger = new Logger(RouterStatsProbe.name);
  private readonly states = new Map<string, State>();
  /** Pool global = 1 : routerId de la sonde en cours, ou null. */
  private running: string | null = null;
  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
    private readonly gateway: RouterGatewayService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.gateway.onSyncEvent(this);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    for (const s of this.states.values()) if (s.timer) clearTimeout(s.timer);
  }

  enabledFor(routerId: string): boolean {
    if (process.env['ROUTER_LIVE_STATS_PROBE_ENABLED'] !== 'true') return false;
    const ids = (process.env['ROUTER_LIVE_STATS_ROUTER_IDS'] ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return ids.includes(routerId) && this.gateway.syncFeedEnabled(routerId);
  }

  private state(routerId: string): State {
    let s = this.states.get(routerId);
    if (!s) {
      s = { lastAttemptAt: 0, nextAllowedAt: 0, failures: 0, prevPublishAt: null, lastPublishAt: null, consecutiveSyncOk: 0, shed: false, inflight: false };
      this.states.set(routerId, s);
    }
    return s;
  }

  /** Synchro CA réussie : seul point d'armement de la sonde. */
  published(routerId: string): void {
    if (!this.enabledFor(routerId)) return;
    const s = this.state(routerId);
    const now = Date.now();
    s.prevPublishAt = s.lastPublishAt;
    s.lastPublishAt = now;
    s.consecutiveSyncOk += 1;
    if (s.timer || s.inflight) return;
    const reason = this.skipReason(routerId, s, now);
    if (reason) {
      // CADENCE/BACKOFF sont des attentes normales (1 publication ≈ 25 s) : non comptées.
      if (reason !== 'CADENCE' && reason !== 'BACKOFF') this.gateway.statsProbeKpis(routerId).statsProbeSkipped += 1;
      return;
    }
    s.timer = setTimeout(() => void this.run(routerId), STATS_START_DELAY_MS);
    s.timer.unref?.();
  }

  /** Synchro CA en échec : routeur chargé/lent ⇒ la sonde est annulée et suspendue (« shed »). */
  syncFailed(routerId: string): void {
    if (!this.enabledFor(routerId)) return;
    const s = this.state(routerId);
    s.consecutiveSyncOk = 0;
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = undefined;
    }
    this.shed(routerId, s);
  }

  private shed(routerId: string, s: State): void {
    s.shed = true;
    this.gateway.setStatsShed(routerId, true);
  }

  private skipReason(routerId: string, s: State, now: number): SkipReason | null {
    if (!this.enabledFor(routerId)) return 'DISABLED';
    if (s.shed) {
      // Reprise : 3 synchros calmes consécutives ET fin du backoff.
      if (s.consecutiveSyncOk >= STATS_RECOVERY_SYNCS && now >= s.nextAllowedAt) {
        s.shed = false;
        this.gateway.setStatsShed(routerId, false);
      } else {
        return 'SHED';
      }
    }
    if (s.prevPublishAt !== null && s.lastPublishAt !== null && s.lastPublishAt - s.prevPublishAt > STATS_SYNC_INTERVAL_MAX_MS) return 'SYNC_SLOW';
    if (now - s.lastAttemptAt < STATS_CADENCE_MS) return 'CADENCE';
    if (now < s.nextAllowedAt) return 'BACKOFF';
    if (this.running !== null) return 'POOL_BUSY';
    return null;
  }

  /** Exécute UNE sonde (appelé par le timer ; public pour les tests). */
  async run(routerId: string): Promise<void> {
    const s = this.state(routerId);
    s.timer = undefined;
    const kpis = this.gateway.statsProbeKpis(routerId);
    const now = Date.now();
    // Les conditions peuvent avoir changé pendant les 4 s d'attente (sync échouée, pool pris, flag retiré).
    const reason = this.skipReason(routerId, s, now);
    if (reason && reason !== 'CADENCE') {
      if (reason !== 'BACKOFF') kpis.statsProbeSkipped += 1;
      return;
    }
    this.running = routerId;
    s.inflight = true;
    s.lastAttemptAt = now;
    try {
      const target = await this.prisma.router.findFirst({
        where: { id: routerId, deletedAt: null },
        select: { tenantId: true, health: true, lastHeartbeat: true },
      });
      if (!target) {
        kpis.statsProbeSkipped += 1;
        return;
      }
      const tunnelDown = target.health === RouterHealth.OFFLINE && (target.lastHeartbeat === null || now - target.lastHeartbeat.getTime() > TUNNEL_STALE_MS);
      if (tunnelDown) {
        kpis.statsProbeSkipped += 1;
        return;
      }

      kpis.statsProbeCount += 1;
      const t0 = Date.now();
      const rows = await withDeadline(
        tenantStore.run({}, () => {
          setTenantContext({ tenantId: target.tenantId, userId: 'system-live-stats', role: UserRole.OWNER });
          // UNE commande, aucun retry ; chaque étape bornée à 3 s.
          return this.remote.run(routerId, (c) => c.command(['/system/resource/print', PROPLIST]), { timeoutMs: STATS_STEP_TIMEOUT_MS, retries: 0 });
        }),
        STATS_HARD_DEADLINE_MS,
        `Stats probe ${routerId}`,
      );
      const duration = Date.now() - t0;
      kpis.statsProbeDurationMs = duration;
      this.gateway.applyStats(routerId, rows[0] ?? {});
      s.failures = 0;
      // Routeur calme : 120 s ; un peu lent : 300 s ; lent : 600 s.
      const next = duration < STATS_CALM_MS ? STATS_CADENCE_MS : duration <= STATS_SLOW_PROBE_MS ? STATS_NORMAL_CADENCE_MS : STATS_SLOW_CADENCE_MS;
      s.nextAllowedAt = Date.now() + jitter(next, 0.1);
    } catch (e) {
      kpis.statsProbeFailures += 1;
      if (e instanceof DeadlineExceededError) kpis.collisionAborted += 1;
      s.failures += 1;
      // Jamais de nouvelle tentative immédiate : 2 → 4 → 8 → 10 min (±20 %).
      const backoff = Math.min(STATS_BACKOFF_CAP_MS, STATS_BACKOFF_BASE_MS * 2 ** (s.failures - 1));
      s.nextAllowedAt = Date.now() + jitter(backoff, 0.2);
      s.consecutiveSyncOk = 0;
      this.shed(routerId, s);
      this.logger.warn(`stats probe failed routerId=${routerId} failures=${s.failures} nextInMs=${s.nextAllowedAt - Date.now()} err=${(e as Error).message}`);
    } finally {
      s.inflight = false;
      this.running = null;
    }
  }
}
