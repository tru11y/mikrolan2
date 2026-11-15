/**
 * Compteurs glissants sur 1 h (60 seaux d'une minute, mémoire constante) des requêtes Prisma :
 * durée (qui inclut l'attente d'une connexion du pool) et erreurs P2024 « Timed out fetching a new connection ».
 * Aucune donnée métier : uniquement des durées et des compteurs.
 */
export const POOL_STATS_BUCKETS = 60;
const BUCKET_MS = 60_000;
export const SLOW_QUERY_MS = 2_000;

interface Bucket {
  minute: number;
  queries: number;
  totalMs: number;
  maxMs: number;
  slow: number;
  p2024: number;
}

export interface PrismaPoolSnapshot {
  windowMinutes: 60;
  queriesLast1h: number;
  avgQueryMsLast1h: number;
  maxQueryMsLast1h: number;
  slowQueriesLast1h: number;
  p2024Last1h: number;
  p2024Total: number;
  lastP2024At: string | null;
}

const empty = (minute: number): Bucket => ({ minute, queries: 0, totalMs: 0, maxMs: 0, slow: 0, p2024: 0 });

export function isPoolTimeout(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2024';
}

export class PrismaPoolStats {
  private readonly buckets: Bucket[] = Array.from({ length: POOL_STATS_BUCKETS }, () => empty(-1));
  private p2024Total = 0;
  private lastP2024AtMs: number | null = null;

  private bucketFor(nowMs: number): Bucket {
    const minute = Math.floor(nowMs / BUCKET_MS);
    const i = minute % POOL_STATS_BUCKETS;
    if (this.buckets[i].minute !== minute) this.buckets[i] = empty(minute);
    return this.buckets[i];
  }

  recordQuery(durationMs: number, nowMs: number = Date.now()): void {
    const b = this.bucketFor(nowMs);
    b.queries += 1;
    b.totalMs += durationMs;
    b.maxMs = Math.max(b.maxMs, durationMs);
    if (durationMs >= SLOW_QUERY_MS) b.slow += 1;
  }

  recordPoolTimeout(nowMs: number = Date.now()): void {
    this.bucketFor(nowMs).p2024 += 1;
    this.p2024Total += 1;
    this.lastP2024AtMs = nowMs;
  }

  snapshot(nowMs: number = Date.now()): PrismaPoolSnapshot {
    const minute = Math.floor(nowMs / BUCKET_MS);
    const live = this.buckets.filter((b) => b.minute > minute - POOL_STATS_BUCKETS && b.minute <= minute);
    const queries = live.reduce((n, b) => n + b.queries, 0);
    const totalMs = live.reduce((n, b) => n + b.totalMs, 0);
    return {
      windowMinutes: 60,
      queriesLast1h: queries,
      avgQueryMsLast1h: queries ? Math.round(totalMs / queries) : 0,
      maxQueryMsLast1h: live.reduce((m, b) => Math.max(m, b.maxMs), 0),
      slowQueriesLast1h: live.reduce((n, b) => n + b.slow, 0),
      p2024Last1h: live.reduce((n, b) => n + b.p2024, 0),
      p2024Total: this.p2024Total,
      lastP2024At: this.lastP2024AtMs === null ? null : new Date(this.lastP2024AtMs).toISOString(),
    };
  }
}
