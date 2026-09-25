/**
 * Ordonnanceur de la synchronisation des activations, par routeur.
 *
 * Il décide QUAND lire chaque routeur et AVEC QUELLE CONCURRENCE ; ce qu'une
 * lecture fait (lecture RouterOS, réconciliation, revenu) est délégué tel quel à
 * `run` et n'est jamais dupliqué ici.
 *
 * - un dispatcheur léger (appelé toutes les ~5 s) lance les routeurs « dus » ;
 * - pool global borné (`poolMax`), jamais plus d'une opération par routeur ;
 * - au plus `poolMax - 1` routeurs lents/dégradés en même temps : il reste
 *   toujours un emplacement pour les routeurs sains ;
 * - cadence propre à chaque routeur, backoff exponentiel en cas d'échecs ;
 * - routeur sans identifiants ou sans tunnel provisionné : jamais lu ;
 * - tunnel manifestement mort : une seule lecture de sonde toutes les 3 min.
 */

export const SYNC_BASE_MS = 25_000;
export const SYNC_POOL_MAX = 3;
export const SYNC_SLOW_MS = 5_000;
export const SYNC_BACKOFF_CAP_MS = 5 * 60_000;
export const SYNC_TUNNEL_DOWN_PROBE_MS = 3 * 60_000;
export const SYNC_ROUTER_LIST_TTL_MS = 15_000;
export const SYNC_SUMMARY_EVERY_MS = 60_000;
// Un « skipped » (verrou du routeur déjà pris) ne compte ni comme succès ni comme échec.
const SKIPPED_RETRY_MS = 5_000;

export type SyncRunStatus = 'ok' | 'failed' | 'skipped';

export interface SchedulerRouter {
  id: string;
  tenantId: string;
  hasCredentials: boolean;
  hasActivePeer: boolean;
  /** Handshake WireGuard périmé : le tunnel est manifestement mort. */
  tunnelDown: boolean;
}

export interface SchedulerDeps {
  now: () => number;
  listRouters: () => Promise<SchedulerRouter[]>;
  run: (router: { id: string; tenantId: string }) => Promise<SyncRunStatus>;
  log: (line: string) => void;
  warn: (line: string) => void;
  poolMax?: number;
}

type Eligibility = 'OK' | 'NO_CREDENTIALS' | 'NO_TUNNEL';

interface RouterState {
  id: string;
  tenantId: string;
  eligibility: Eligibility;
  tunnelDown: boolean;
  nextDueAt: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastEndedAt: number | null;
  lastDurationMs: number | null;
  inFlight: boolean;
}

const short = (id: string): string => id.slice(0, 8);
const iso = (t: number): string => new Date(t).toISOString();

export class RouterSyncScheduler {
  private readonly states = new Map<string, RouterState>();
  private readonly poolMax: number;
  private listAt = -Infinity;
  private summaryAt = -Infinity;
  private dispatching = false;

  constructor(private readonly deps: SchedulerDeps) {
    this.poolMax = deps.poolMax ?? SYNC_POOL_MAX;
  }

  get poolActive(): number {
    let n = 0;
    for (const s of this.states.values()) if (s.inFlight) n += 1;
    return n;
  }

  /** Lance les routeurs dus. N'attend PAS la fin des lectures. */
  async dispatch(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const now = this.deps.now();
      await this.refreshRouters(now);
      this.launchDue(now);
      this.maybeSummary(now);
    } finally {
      this.dispatching = false;
    }
  }

  private async refreshRouters(now: number): Promise<void> {
    if (now - this.listAt < SYNC_ROUTER_LIST_TTL_MS) return;
    let routers: SchedulerRouter[];
    try {
      routers = await this.deps.listRouters();
    } catch (e) {
      this.deps.warn(`sync scheduler LIST_FAILED error=${(e as Error).message}`);
      return; // on garde la liste précédente
    }
    this.listAt = now;

    const seen = new Set<string>();
    for (const r of routers) {
      seen.add(r.id);
      const eligibility: Eligibility = !r.hasCredentials
        ? 'NO_CREDENTIALS'
        : !r.hasActivePeer
          ? 'NO_TUNNEL'
          : 'OK';
      let s = this.states.get(r.id);
      if (!s) {
        s = {
          id: r.id,
          tenantId: r.tenantId,
          eligibility,
          tunnelDown: r.tunnelDown,
          nextDueAt: now,
          consecutiveFailures: 0,
          lastSuccessAt: null,
          lastEndedAt: null,
          lastDurationMs: null,
          inFlight: false,
        };
        this.states.set(r.id, s);
        if (eligibility !== 'OK') this.logEligibility(s);
        continue;
      }
      s.tenantId = r.tenantId;
      if (s.eligibility !== eligibility) {
        s.eligibility = eligibility;
        this.logEligibility(s);
        // Configuration ajoutée (identifiants / tunnel) : lecture immédiate.
        if (eligibility === 'OK') s.nextDueAt = now;
      }
      if (s.tunnelDown && !r.tunnelDown) s.nextDueAt = now; // handshake revenu
      s.tunnelDown = r.tunnelDown;
    }
    // Routeurs supprimés : oubliés (sauf lecture en cours, nettoyée à sa fin).
    for (const [id, s] of this.states) {
      if (!seen.has(id) && !s.inFlight) this.states.delete(id);
    }
  }

  private logEligibility(s: RouterState): void {
    this.deps.log(`sync scheduler ELIGIBILITY routerId=${s.id} status=${s.eligibility}`);
  }

  private dueAt(s: RouterState): number {
    if (!s.tunnelDown || s.lastEndedAt === null) return s.nextDueAt;
    return Math.max(s.nextDueAt, s.lastEndedAt + SYNC_TUNNEL_DOWN_PROBE_MS);
  }

  private isSlow(s: RouterState): boolean {
    return s.consecutiveFailures > 0 || (s.lastDurationMs ?? 0) > SYNC_SLOW_MS;
  }

  /** 0 sain (plus ancienne lecture d'abord) · 1 sans historique · 2 lent · 3 en backoff. */
  private rank(s: RouterState): number {
    if (s.consecutiveFailures > 0) return 3;
    if (this.isSlow(s)) return 2;
    if (s.lastSuccessAt === null) return 1;
    return 0;
  }

  private launchDue(now: number): void {
    const due = [...this.states.values()]
      .filter((s) => s.eligibility === 'OK' && !s.inFlight && this.dueAt(s) <= now)
      .sort((a, b) => this.rank(a) - this.rank(b) || (a.lastSuccessAt ?? 0) - (b.lastSuccessAt ?? 0) || this.dueAt(a) - this.dueAt(b));

    let active = this.poolActive;
    let slowActive = [...this.states.values()].filter((s) => s.inFlight && this.isSlow(s)).length;
    for (const s of due) {
      if (active >= this.poolMax) break;
      const slow = this.isSlow(s);
      // Toujours au moins un emplacement pour les routeurs sains.
      if (slow && slowActive >= this.poolMax - 1) continue;
      active += 1;
      if (slow) slowActive += 1;
      void this.runOne(s);
    }
  }

  private async runOne(s: RouterState): Promise<void> {
    const dueAt = this.dueAt(s);
    s.inFlight = true;
    const startedAt = this.deps.now();
    this.deps.log(
      `sync scheduler DISPATCH routerId=${s.id} dueAt=${iso(dueAt)} queueWaitMs=${Math.max(0, startedAt - dueAt)} poolActive=${this.poolActive} poolMax=${this.poolMax}`,
    );
    let status: SyncRunStatus = 'failed';
    try {
      status = await this.deps.run({ id: s.id, tenantId: s.tenantId });
    } catch (e) {
      this.deps.warn(`sync scheduler RUN_ERROR routerId=${s.id} error=${(e as Error).message}`);
    } finally {
      s.inFlight = false;
    }
    const endedAt = this.deps.now();
    const durationMs = endedAt - startedAt;

    let backoffMs = 0;
    if (status === 'skipped') {
      s.nextDueAt = endedAt + SKIPPED_RETRY_MS;
    } else if (status === 'ok') {
      s.consecutiveFailures = 0;
      s.lastSuccessAt = endedAt;
      s.lastEndedAt = endedAt;
      s.lastDurationMs = durationMs;
      s.nextDueAt = startedAt + Math.max(SYNC_BASE_MS, 2 * durationMs);
    } else {
      s.consecutiveFailures += 1;
      s.lastEndedAt = endedAt;
      s.lastDurationMs = durationMs;
      backoffMs = Math.min(SYNC_BACKOFF_CAP_MS, SYNC_BASE_MS * 2 ** (s.consecutiveFailures - 1));
      s.nextDueAt = endedAt + backoffMs;
    }
    this.deps.log(
      `sync scheduler RESULT routerId=${s.id} status=${status} startedAt=${iso(startedAt)} durationMs=${durationMs} consecutiveFailures=${s.consecutiveFailures} backoffMs=${backoffMs} nextDueAt=${iso(this.dueAt(s))} poolActive=${this.poolActive} poolMax=${this.poolMax} lastSuccessAgeMs=${s.lastSuccessAt === null ? 'none' : endedAt - s.lastSuccessAt}`,
    );
  }

  /** Une ligne par minute : âge de la dernière lecture réussie de chaque routeur (KPI de fraîcheur). */
  private maybeSummary(now: number): void {
    if (now - this.summaryAt < SYNC_SUMMARY_EVERY_MS) return;
    this.summaryAt = now;
    const all = [...this.states.values()];
    const ages = all
      .map((s) => `${short(s.id)}=${s.lastSuccessAt === null ? 'none' : now - s.lastSuccessAt}`)
      .join(',');
    this.deps.log(
      `sync scheduler SUMMARY routers=${all.length} eligible=${all.filter((s) => s.eligibility === 'OK').length} noCredentials=${all.filter((s) => s.eligibility === 'NO_CREDENTIALS').length} noTunnel=${all.filter((s) => s.eligibility === 'NO_TUNNEL').length} tunnelDown=${all.filter((s) => s.tunnelDown).length} poolActive=${this.poolActive} poolMax=${this.poolMax} lastSuccessAgeMs={${ages}}`,
    );
  }
}
