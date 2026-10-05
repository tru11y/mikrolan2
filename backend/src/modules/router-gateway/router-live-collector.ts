import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ManagementMode, RemotePeerStatus, RouterHealth, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { setTenantContext, tenantStore } from '../../common/context/tenant-context';
import { withDeadline } from '../../common/utils/with-deadline';
import { RouterGatewayService } from './router-gateway.service';
import {
  COLLECTOR_BACKOFF_BASE_MS,
  COLLECTOR_BACKOFF_CAP_MS,
  COLLECTOR_DUTY_FACTOR,
  COLLECTOR_HOT_IDLE_MS,
  COLLECTOR_HOT_WATCHED_MS,
  COLLECTOR_MAX_INTERVAL_MS,
  COLLECTOR_TICK_MS,
  COLLECTOR_WARM_MS,
  GATEWAY_IDLE_PROBE_MS,
} from './router-gateway.types';

const ROUTER_LIST_TTL_MS = 15_000;
const TUNNEL_STALE_MS = 150_000;
/** Routeurs lus en même temps, toutes flottes confondues (jamais 2 lectures sur le même routeur). */
const POOL_MAX = 2;
/** Garde-fou : libère le verrou même si une lecture reste bloquée (les timeouts socket la bornent déjà). */
const CYCLE_DEADLINE_MS = 90_000;
/** Un cycle plus long que ça = routeur « lent » : on espace aussi le WARM. */
const SLOW_CYCLE_MS = 10_000;

interface Target {
  id: string;
  tenantId: string;
  eligible: boolean;
  tunnelDown: boolean;
}

interface State {
  nextDueAt: number;
  lastStatsAt: number;
  failures: number;
  lastDurationMs: number | null;
  running: boolean;
}

/** Intervalle avant le prochain cycle HOT : cible 8/15 s, jamais plus de ~1/3 du temps d'occupation du routeur. */
export function nextIntervalMs(durationMs: number, watched: boolean): number {
  const base = watched ? COLLECTOR_HOT_WATCHED_MS : COLLECTOR_HOT_IDLE_MS;
  return Math.min(COLLECTOR_MAX_INTERVAL_MS, Math.max(base, durationMs * COLLECTOR_DUTY_FACTOR));
}

/** Backoff exponentiel plafonné après `failures` échecs consécutifs (30 s, 60 s, 120 s… 5 min). */
export function backoffMs(failures: number): number {
  return Math.min(COLLECTOR_BACKOFF_CAP_MS, COLLECTOR_BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
}

/**
 * Collecte proactive VPS des données live RouterOS (sessions HOT, CPU/RAM WARM),
 * indépendante de tout téléphone. Le mobile ne fait que lire le snapshot du Gateway.
 *
 * - UNE lecture à la fois par routeur (cycle séquentiel : sessions → stats, une connexion) ;
 * - pool global borné, le plus en retard d'abord ;
 * - cadence adaptative : durée × 3 minimum, plus rapide si un écran regarde (watchers) ;
 * - échec/timeout → backoff exponentiel + jitter, dernier snapshot conservé ;
 * - ne touche ni `syncActivations` ni le calcul du CA.
 *
 * OFF par défaut (`ROUTER_LIVE_COLLECTOR_ENABLED=true` pour activer).
 */
@Injectable()
export class RouterLiveCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RouterLiveCollector.name);
  private readonly states = new Map<string, State>();
  private timer?: ReturnType<typeof setInterval>;
  private targets: Target[] = [];
  private targetsAt = 0;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RouterGatewayService,
  ) {}

  onModuleInit(): void {
    if (process.env['ROUTER_LIVE_COLLECTOR_ENABLED'] !== 'true') return;
    this.timer = setInterval(() => void this.tick(), COLLECTOR_TICK_MS);
    this.timer.unref?.();
    this.logger.log('live collector ON');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: number = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.refreshTargets(now);
      const running = [...this.states.values()].filter((s) => s.running).length;
      const due = this.targets
        .filter((t) => t.eligible)
        .map((t) => ({ t, s: this.stateFor(t.id, now) }))
        .filter(({ s }) => !s.running && s.nextDueAt <= now)
        .sort((a, b) => a.s.nextDueAt - b.s.nextDueAt)
        .slice(0, Math.max(0, POOL_MAX - running));
      for (const { t, s } of due) void this.runCycle(t, s);
    } finally {
      this.ticking = false;
    }
  }

  private stateFor(id: string, now: number): State {
    let s = this.states.get(id);
    if (!s) {
      // Départs étalés : pas de rafale sur toute la flotte au démarrage.
      s = { nextDueAt: now + Math.random() * COLLECTOR_HOT_IDLE_MS, lastStatsAt: 0, failures: 0, lastDurationMs: null, running: false };
      this.states.set(id, s);
    }
    return s;
  }

  private async refreshTargets(now: number): Promise<void> {
    if (now - this.targetsAt < ROUTER_LIST_TTL_MS && this.targets.length > 0) return;
    const rows = await this.prisma.router.findMany({
      where: { mode: ManagementMode.REMOTE, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        health: true,
        lastHeartbeat: true,
        credEncrypted: true,
        remotePeer: { select: { status: true } },
      },
    });
    this.targetsAt = now;
    const next = rows.map((r): Target => ({
      id: r.id,
      tenantId: r.tenantId,
      // Phase 1A : un routeur dont les sessions viennent de syncActivations n'est jamais lu par le collecteur
      // (pas de 2e login API en parallèle de la synchro CA ; CPU/RAM = Phase 1B).
      eligible:
        Boolean(r.credEncrypted) &&
        r.remotePeer?.status === RemotePeerStatus.ACTIVE &&
        !this.gateway.syncFeedEnabled(r.id),
      tunnelDown: r.health === RouterHealth.OFFLINE && (r.lastHeartbeat === null || now - r.lastHeartbeat.getTime() > TUNNEL_STALE_MS),
    }));
    const live = new Set(next.filter((t) => t.eligible).map((t) => t.id));
    for (const old of this.targets) {
      if (!live.has(old.id)) {
        this.gateway.setManaged(old.id, false);
        this.states.delete(old.id);
      }
    }
    this.targets = next;
    for (const id of live) this.gateway.setManaged(id, true);
  }

  private async runCycle(target: Target, s: State): Promise<void> {
    s.running = true;
    const t0 = Date.now();
    const slow = (s.lastDurationMs ?? 0) > SLOW_CYCLE_MS;
    const statsDue = t0 - s.lastStatsAt >= (slow ? COLLECTOR_WARM_MS * 2 : COLLECTOR_WARM_MS);
    // Même si CPU/RAM échoue, on ne le retente pas avant le prochain délai WARM (pas de martèlement).
    if (statsDue) s.lastStatsAt = t0;
    try {
      const snap = await withDeadline(
        tenantStore.run({}, () => {
          setTenantContext({ tenantId: target.tenantId, userId: 'system-live-collector', role: UserRole.OWNER });
          return this.gateway.collect(target.id, { stats: statsDue });
        }),
        CYCLE_DEADLINE_MS,
        `Live collect ${target.id}`,
      );
      if (snap === null) {
        s.nextDueAt = Date.now() + COLLECTOR_TICK_MS * 2; // une lecture était déjà en vol
        return;
      }
      const dur = Date.now() - t0;
      s.lastDurationMs = dur;
      s.failures = 0;
      s.nextDueAt = Date.now() + nextIntervalMs(dur, this.gateway.watchers(target.id) > 0);
    } catch (e) {
      s.failures += 1;
      s.lastDurationMs = Date.now() - t0;
      this.gateway.noteBackoff(target.id);
      const jitter = 0.8 + Math.random() * 0.4;
      // Tunnel manifestement mort : une sonde toutes les 3 min, jamais plus.
      const delay = target.tunnelDown ? GATEWAY_IDLE_PROBE_MS : backoffMs(s.failures) * jitter;
      s.nextDueAt = Date.now() + delay;
      this.logger.warn(`live collect failed routerId=${target.id} failures=${s.failures} nextInMs=${Math.round(delay)} err=${(e as Error).message}`);
    } finally {
      s.running = false;
    }
  }
}
