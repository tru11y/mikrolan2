import { AuditAction, UserRole, UserStatus } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { TicketVerifiersService } from './ticket-verifiers.service';
import type { TenantContext } from '../../common/context/tenant-context';

const CTX_A: TenantContext = {
  tenantId: 'T-A',
  userId: 'U-OWN-A',
  role: UserRole.OWNER,
};

type Row = Record<string, unknown>;

function makeDb(initial: {
  users?: Row[];
  routers?: Row[];
  assignments?: Row[];
  refreshTokens?: Row[];
}) {
  const state = {
    users: [...(initial.users ?? [])],
    routers: [...(initial.routers ?? [])],
    assignments: [...(initial.assignments ?? [])],
    refreshTokens: [...(initial.refreshTokens ?? [])],
  };

  function matchWhere(row: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k === 'OR' || k === 'AND' || k === 'NOT') continue;
      if (v && typeof v === 'object' && 'not' in (v as Record<string, unknown>)) {
        const neq = (v as { not: unknown }).not;
        if (row[k] === neq) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  }

  const db = {
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: Row }): Promise<Row | null> => {
          const row =
            state.users.find((u) =>
              where['id']
                ? u['id'] === where['id']
                : where['email']
                  ? u['email'] === where['email']
                  : false,
            ) ?? null;
          return row;
        },
      ),
      findFirst: jest.fn(
        async ({ where }: { where: Row }): Promise<Row | null> => {
          const row =
            state.users.find((u) => matchWhere(u, where)) ?? null;
          if (!row) return null;
          const assignment = state.assignments.find(
            (a) => a['userId'] === row['id'],
          );
          const router = assignment
            ? state.routers.find((r) => r['id'] === assignment['routerId'])
            : null;
          return {
            ...row,
            verifierAssignment: assignment
              ? {
                  routerId: assignment['routerId'],
                  router: router
                    ? {
                        id: router['id'],
                        identity: router['identity'],
                        alias: router['alias'] ?? null,
                      }
                    : null,
                  assignedById: assignment['assignedById'],
                  createdAt: assignment['createdAt'],
                  updatedAt: assignment['updatedAt'],
                }
              : null,
          };
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where: Row }): Promise<Row[]> =>
          state.users.filter((u) => matchWhere(u, where)),
      ),
      create: jest.fn(async ({ data }: { data: Row }): Promise<Row> => {
        const now = new Date();
        const row = {
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          lastLoginAt: null,
          ...data,
          id: data['id'] ?? `U-NEW-${state.users.length}`,
        };
        state.users.push(row);
        return { id: row['id'] };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Row;
          data: Row;
        }): Promise<Row> => {
          const u = state.users.find((x) => x['id'] === where['id']);
          if (!u) throw new Error('not found');
          Object.assign(u, data);
          return u;
        },
      ),
    },
    router: {
      findFirst: jest.fn(async ({ where }: { where: Row }): Promise<Row | null> => {
        return state.routers.find((r) => matchWhere(r, where)) ?? null;
      }),
    },
    ticketVerifierAssignment: {
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: Row;
          update: Row;
        }): Promise<Row> => {
          const existing = state.assignments.find((a) => a['userId'] === where.userId);
          if (existing) {
            Object.assign(existing, update, { updatedAt: new Date() });
            return existing;
          }
          const row = { ...create, createdAt: new Date(), updatedAt: new Date() };
          state.assignments.push(row);
          return row;
        },
      ),
      create: jest.fn(async ({ data }: { data: Row }): Promise<Row> => {
        const row = { ...data, createdAt: new Date(), updatedAt: new Date() };
        state.assignments.push(row);
        return row;
      }),
      delete: jest.fn(async ({ where }: { where: { userId: string } }): Promise<Row> => {
        const idx = state.assignments.findIndex((a) => a['userId'] === where.userId);
        if (idx < 0) throw new Error('P2025');
        const [row] = state.assignments.splice(idx, 1);
        return row!;
      }),
    },
    refreshToken: {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Row;
          data: Row;
        }): Promise<{ count: number }> => {
          let n = 0;
          for (const t of state.refreshTokens) {
            if (matchWhere(t, where)) {
              Object.assign(t, data);
              n++;
            }
          }
          return { count: n };
        },
      ),
    },
    $transaction: jest.fn(
      async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb(db),
    ),
  } as const;
  return { db, state };
}

function makeEvents() {
  return { emit: jest.fn(async () => undefined), failure: jest.fn(async () => undefined) };
}

const ROUTER_A1 = { id: 'R-A1', tenantId: 'T-A', identity: 'ra1', deletedAt: null };
const ROUTER_A2 = { id: 'R-A2', tenantId: 'T-A', identity: 'ra2', deletedAt: null };
const ROUTER_B1 = { id: 'R-B1', tenantId: 'T-B', identity: 'rb1', deletedAt: null };
const ROUTER_A1_DELETED = { ...ROUTER_A1, id: 'R-A1-DEL', deletedAt: new Date() };

describe('TicketVerifiersService', () => {
  describe('create', () => {
    it('forces role=TICKET_VERIFIER and tenantId=ctx (never from body)', async () => {
      const { db } = makeDb({ users: [], routers: [ROUTER_A1] });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await svc.create(CTX_A, { email: 'v@x', password: 'LongPass#1' } as never);
      const createCall = (db.user.create as jest.Mock).mock.calls[0]![0] as { data: Row };
      expect(createCall.data['role']).toBe(UserRole.TICKET_VERIFIER);
      expect(createCall.data['tenantId']).toBe('T-A');
      expect(createCall.data['status']).toBe(UserStatus.ACTIVE);
      // passwordHash is NEVER one of the user-provided values.
      expect(createCall.data['passwordHash']).not.toBe('LongPass#1');
    });

    it('creates assignment atomically when routerId provided', async () => {
      const { db, state } = makeDb({ users: [], routers: [ROUTER_A1] });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await svc.create(CTX_A, {
        email: 'v@x',
        password: 'LongPass#1',
        routerId: ROUTER_A1.id,
      } as never);
      expect(state.assignments.length).toBe(1);
      expect(state.assignments[0]!['routerId']).toBe('R-A1');
      expect(state.assignments[0]!['assignedById']).toBe(CTX_A.userId);
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('409 VERIFIER_EMAIL_TAKEN on duplicate email', async () => {
      const { db } = makeDb({
        users: [{ id: 'EXIST', email: 'v@x', tenantId: 'T-OTHER' }],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await expect(
        svc.create(CTX_A, { email: 'v@x', password: 'LongPass#1' } as never),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.VERIFIER_EMAIL_TAKEN,
      });
    });

    it('404 VERIFIER_ROUTER_FOREIGN when routerId belongs to another tenant', async () => {
      const { db } = makeDb({ users: [], routers: [ROUTER_B1] });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await expect(
        svc.create(CTX_A, {
          email: 'v@x',
          password: 'LongPass#1',
          routerId: ROUTER_B1.id,
        } as never),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VERIFIER_ROUTER_FOREIGN });
    });

    it('404 VERIFIER_ROUTER_FOREIGN when routerId is soft-deleted', async () => {
      const { db } = makeDb({ users: [], routers: [ROUTER_A1_DELETED] });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await expect(
        svc.create(CTX_A, {
          email: 'v@x',
          password: 'LongPass#1',
          routerId: ROUTER_A1_DELETED.id,
        } as never),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VERIFIER_ROUTER_FOREIGN });
    });

    it('audits CREATE without any password or secret in metadata', async () => {
      const { db } = makeDb({ users: [], routers: [ROUTER_A1] });
      const events = makeEvents();
      const svc = new TicketVerifiersService(db as never, events as never);
      await svc.create(CTX_A, {
        email: 'v@x',
        password: 'LongPass#1',
        routerId: ROUTER_A1.id,
      } as never);
      const emitArg = (events.emit as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;
      expect(emitArg['action']).toBe(AuditAction.CREATE);
      expect(JSON.stringify(emitArg['metadata'])).not.toContain('LongPass#1');
      expect(JSON.stringify(emitArg['metadata'])).not.toMatch(/passwordHash/i);
    });
  });

  describe('list / get — tenant isolation', () => {
    it('list filters by tenant and role', async () => {
      const { db } = makeDb({
        users: [
          { id: 'V1', tenantId: 'T-A', role: UserRole.TICKET_VERIFIER, status: UserStatus.ACTIVE, email: 'a', name: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, lastLoginAt: null },
          { id: 'V2', tenantId: 'T-B', role: UserRole.TICKET_VERIFIER, status: UserStatus.ACTIVE, email: 'b', name: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, lastLoginAt: null },
          { id: 'M1', tenantId: 'T-A', role: UserRole.MEMBER, status: UserStatus.ACTIVE, email: 'm', name: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, lastLoginAt: null },
        ],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await svc.list(CTX_A, { limit: 50 } as never);
      const call = (db.user.findMany as jest.Mock).mock.calls[0]![0] as { where: Row };
      expect(call.where['tenantId']).toBe('T-A');
      expect(call.where['role']).toBe(UserRole.TICKET_VERIFIER);
      // DELETED excluded by default.
      expect(JSON.stringify(call.where)).toContain('DELETED');
    });

    it('get returns 404 for a verifier of another tenant', async () => {
      const { db } = makeDb({
        users: [{ id: 'V-B', tenantId: 'T-B', role: UserRole.TICKET_VERIFIER, status: UserStatus.ACTIVE, email: 'x', name: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, lastLoginAt: null }],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await expect(svc.get(CTX_A, 'V-B')).rejects.toMatchObject({
        errorCode: ErrorCode.VERIFIER_NOT_FOUND,
      });
    });

    it('get returns 404 for a MEMBER user id (never surfaces non-verifier)', async () => {
      const { db } = makeDb({
        users: [{ id: 'M', tenantId: 'T-A', role: UserRole.MEMBER, status: UserStatus.ACTIVE, email: 'x', name: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, lastLoginAt: null }],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await expect(svc.get(CTX_A, 'M')).rejects.toMatchObject({
        errorCode: ErrorCode.VERIFIER_NOT_FOUND,
      });
    });
  });

  describe('assignment / reassignment', () => {
    const baseVerifier = {
      id: 'V1',
      tenantId: 'T-A',
      role: UserRole.TICKET_VERIFIER,
      status: UserStatus.ACTIVE,
      email: 'v@x',
      name: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      lastLoginAt: null,
    };

    it('creates initial assignment and revokes refresh tokens in the same tx', async () => {
      const { db, state } = makeDb({
        users: [baseVerifier],
        routers: [ROUTER_A1],
        refreshTokens: [
          { id: 'RT1', userId: 'V1', revoked: false },
          { id: 'RT2', userId: 'V1', revoked: false },
        ],
      });
      const events = makeEvents();
      const svc = new TicketVerifiersService(db as never, events as never);
      await svc.upsertAssignment(CTX_A, 'V1', { routerId: ROUTER_A1.id });
      expect(state.assignments.length).toBe(1);
      expect(state.refreshTokens.every((t) => t['revoked'] === true)).toBe(true);
      // Audit mentions old/new routerId.
      const meta = (events.emit as jest.Mock).mock.calls[0]![0] as { metadata: Record<string, unknown> };
      expect(meta.metadata['oldRouterId']).toBeNull();
      expect(meta.metadata['newRouterId']).toBe('R-A1');
      expect(meta.metadata['kind']).toBe('VERIFIER_ASSIGNED');
    });

    it('reassignment updates the SAME row (no second row)', async () => {
      const { db, state } = makeDb({
        users: [baseVerifier],
        routers: [ROUTER_A1, ROUTER_A2],
        assignments: [
          {
            userId: 'V1',
            tenantId: 'T-A',
            routerId: 'R-A1',
            assignedById: 'U-OWN-A',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        refreshTokens: [{ id: 'RT', userId: 'V1', revoked: false }],
      });
      const events = makeEvents();
      const svc = new TicketVerifiersService(db as never, events as never);
      await svc.upsertAssignment(CTX_A, 'V1', { routerId: ROUTER_A2.id });
      expect(state.assignments.length).toBe(1);
      expect(state.assignments[0]!['routerId']).toBe('R-A2');
      expect(state.refreshTokens[0]!['revoked']).toBe(true);
      const meta = (events.emit as jest.Mock).mock.calls[0]![0] as { metadata: Record<string, unknown> };
      expect(meta.metadata['kind']).toBe('VERIFIER_REASSIGNED');
      expect(meta.metadata['oldRouterId']).toBe('R-A1');
      expect(meta.metadata['newRouterId']).toBe('R-A2');
    });

    it('refuses assignment to a router of another tenant', async () => {
      const { db } = makeDb({
        users: [baseVerifier],
        routers: [ROUTER_B1],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await expect(
        svc.upsertAssignment(CTX_A, 'V1', { routerId: ROUTER_B1.id }),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VERIFIER_ROUTER_FOREIGN });
    });

    it('removeAssignment deletes the row and revokes tokens', async () => {
      const { db, state } = makeDb({
        users: [baseVerifier],
        routers: [ROUTER_A1],
        assignments: [
          {
            userId: 'V1',
            tenantId: 'T-A',
            routerId: 'R-A1',
            assignedById: 'U-OWN-A',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        refreshTokens: [{ id: 'RT', userId: 'V1', revoked: false }],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await svc.removeAssignment(CTX_A, 'V1');
      expect(state.assignments.length).toBe(0);
      expect(state.refreshTokens[0]!['revoked']).toBe(true);
    });

    it('removeAssignment is idempotent when none exists', async () => {
      const { db } = makeDb({ users: [baseVerifier] });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await expect(svc.removeAssignment(CTX_A, 'V1')).resolves.toBeDefined();
    });
  });

  describe('status transitions', () => {
    const base = {
      id: 'V1',
      tenantId: 'T-A',
      role: UserRole.TICKET_VERIFIER,
      status: UserStatus.ACTIVE,
      email: 'v@x',
      name: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      lastLoginAt: null,
    };

    it('SUSPENDED revokes all refresh tokens in the tx', async () => {
      const { db, state } = makeDb({
        users: [base],
        refreshTokens: [{ id: 'RT', userId: 'V1', revoked: false }],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await svc.setStatus(CTX_A, 'V1', { status: 'SUSPENDED' });
      expect(state.users[0]!['status']).toBe(UserStatus.SUSPENDED);
      expect(state.refreshTokens[0]!['revoked']).toBe(true);
    });

    it('REACTIVATED does NOT un-revoke tokens', async () => {
      const { db, state } = makeDb({
        users: [{ ...base, status: UserStatus.SUSPENDED }],
        refreshTokens: [{ id: 'RT', userId: 'V1', revoked: true }],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await svc.setStatus(CTX_A, 'V1', { status: 'ACTIVE' });
      expect(state.users[0]!['status']).toBe(UserStatus.ACTIVE);
      expect(state.refreshTokens[0]!['revoked']).toBe(true);
    });

    it('refuses status transition from DELETED', async () => {
      const { db } = makeDb({
        users: [{ ...base, status: UserStatus.DELETED }],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await expect(
        svc.setStatus(CTX_A, 'V1', { status: 'ACTIVE' }),
      ).rejects.toBeInstanceOf(BusinessException);
    });
  });

  describe('revokeSessions / softDelete', () => {
    const base = {
      id: 'V1',
      tenantId: 'T-A',
      role: UserRole.TICKET_VERIFIER,
      status: UserStatus.ACTIVE,
      email: 'v@x',
      name: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      lastLoginAt: null,
    };

    it('revokeSessions updates all unrevoked refresh tokens', async () => {
      const { db, state } = makeDb({
        users: [base],
        refreshTokens: [
          { id: 'A', userId: 'V1', revoked: false },
          { id: 'B', userId: 'V1', revoked: false },
          { id: 'C', userId: 'OTHER', revoked: false },
        ],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await svc.revokeSessions(CTX_A, 'V1');
      expect(state.refreshTokens.filter((t) => t['userId'] === 'V1').every((t) => t['revoked'])).toBe(true);
      expect(state.refreshTokens.find((t) => t['id'] === 'C')!['revoked']).toBe(false);
    });

    it('softDelete sets status=DELETED, drops assignment, revokes tokens', async () => {
      const { db, state } = makeDb({
        users: [base],
        routers: [ROUTER_A1],
        assignments: [
          { userId: 'V1', tenantId: 'T-A', routerId: 'R-A1', assignedById: 'U-OWN-A', createdAt: new Date(), updatedAt: new Date() },
        ],
        refreshTokens: [{ id: 'RT', userId: 'V1', revoked: false }],
      });
      const svc = new TicketVerifiersService(db as never, makeEvents() as never);
      await svc.softDelete(CTX_A, 'V1');
      expect(state.users[0]!['status']).toBe(UserStatus.DELETED);
      expect(state.users[0]!['deletedAt']).toBeInstanceOf(Date);
      expect(state.assignments.length).toBe(0);
      expect(state.refreshTokens[0]!['revoked']).toBe(true);
    });
  });
});
