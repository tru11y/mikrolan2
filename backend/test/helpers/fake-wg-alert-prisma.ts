import { Prisma } from '@prisma/client';

/**
 * Faux Prisma en mémoire pour les tests unitaires des alertes WireGuard : reproduit uniquement les formes de
 * requêtes utilisées, dont l'index unique PARTIEL (un épisode non résolu par peer et type) et l'unicité des tentatives.
 * Les vraies garanties PostgreSQL sont prouvées par les tests e2e.
 */
export interface FakePeer {
  id: string;
  routerId: string;
  tenantId: string;
  wgPublicKey: string;
  status: string;
  lastHandshakeAt: Date | null;
  provisionedAt: Date | null;
  createdAt: Date;
  staleAlertedAt: Date | null;
  router: { alias: string | null; identity: string; deletedAt: Date | null };
}

export interface FakeEpisode {
  id: string;
  remotePeerId: string;
  tenantId: string;
  alertType: string;
  detectedAt: Date;
  resolvedAt: Date | null;
  status: string;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  attemptCount: number;
  emailStatus: string | null;
  pushStatus: string | null;
  providerAcceptedAt: Date | null;
  claimExpiresAt: Date | null;
  legacy: boolean;
  failureCode: string | null;
}

export interface FakeAttempt {
  episodeId: string;
  channel: string;
  attemptNumber: number;
  status: string;
  attemptedAt: Date;
  providerAcceptedAt: Date | null;
  failureCode: string | null;
  recipientCount: number;
}

type Where = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !(v instanceof Date);

function matchField(value: unknown, cond: unknown): boolean {
  if (!isObj(cond)) return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond;
  if ('in' in cond) return (cond.in as unknown[]).includes(value);
  if ('lte' in cond) return value instanceof Date && value.getTime() <= (cond.lte as Date).getTime();
  if ('gt' in cond) return value instanceof Date && value.getTime() > (cond.gt as Date).getTime();
  if ('not' in cond) return value !== cond.not;
  return false;
}

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Where[]).some((w) => matches(row, w));
    return matchField(row[k], cond);
  });
}

export class FakeWgAlertPrisma {
  peers: FakePeer[] = [];
  episodes: FakeEpisode[] = [];
  attempts: FakeAttempt[] = [];
  superAdmins: Array<{ email: string }> = [];
  private seq = 0;
  /** Latence artificielle entre deux accès pour exposer les courses. */
  yieldEvery = true;

  private async tick(): Promise<void> {
    if (this.yieldEvery) await Promise.resolve();
  }

  remotePeer = {
    findMany: async () => {
      await this.tick();
      return this.peers.filter((p) => p.status === 'ACTIVE' && !p.router.deletedAt);
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakePeer> }) => {
      await this.tick();
      const p = this.peers.find((x) => x.id === where.id);
      if (p) Object.assign(p, data);
      return p;
    },
  };

  user = { findMany: async () => this.superAdmins };

  wgAlertEpisode = {
    create: async ({ data }: { data: Partial<FakeEpisode> & { remotePeerId: string; alertType: string } }) => {
      await this.tick();
      const duplicate = this.episodes.some((e) => e.remotePeerId === data.remotePeerId && e.alertType === data.alertType && e.status !== 'RESOLVED');
      if (duplicate) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
      }
      const row = {
        id: `ep-${++this.seq}`,
        resolvedAt: null,
        status: 'OPEN',
        lastAttemptAt: null,
        nextAttemptAt: null,
        attemptCount: 0,
        emailStatus: null,
        pushStatus: null,
        providerAcceptedAt: null,
        claimExpiresAt: null,
        legacy: false,
        failureCode: null,
        ...(data as Partial<FakeEpisode>),
      };
      this.episodes.push(row as FakeEpisode);
      return row as FakeEpisode;
    },
    findFirst: async ({ where }: { where: Where }) => {
      await this.tick();
      return this.episodes.find((e) => matches(e as unknown as Record<string, unknown>, where)) ?? null;
    },
    findMany: async ({ where, take }: { where: Where; take?: number }) => {
      await this.tick();
      return this.episodes
        .filter((e) => matches(e as unknown as Record<string, unknown>, where))
        .slice(0, take ?? 1000)
        .map((e) => ({ ...e, remotePeer: this.peers.find((p) => p.id === e.remotePeerId) }));
    },
    updateMany: async ({ where, data }: { where: Where; data: Partial<FakeEpisode> }) => {
      await this.tick();
      const rows = this.episodes.filter((e) => matches(e as unknown as Record<string, unknown>, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
  };

  wgAlertDeliveryAttempt = {
    createMany: async ({ data }: { data: FakeAttempt[] }) => {
      await this.tick();
      for (const d of data) {
        if (this.attempts.some((a) => a.episodeId === d.episodeId && a.channel === d.channel && a.attemptNumber === d.attemptNumber)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
      }
      this.attempts.push(...data);
      return { count: data.length };
    },
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }

  addPeer(over: Partial<FakePeer> & { id: string }): FakePeer {
    const peer: FakePeer = {
      routerId: `r-${over.id}`,
      tenantId: 't1',
      wgPublicKey: `pk-${over.id}`,
      status: 'ACTIVE',
      lastHandshakeAt: null,
      provisionedAt: null,
      createdAt: new Date(0),
      staleAlertedAt: null,
      router: { alias: 'FREEDOM', identity: 'freedom-id', deletedAt: null },
      ...over,
    };
    this.peers.push(peer);
    return peer;
  }
}
