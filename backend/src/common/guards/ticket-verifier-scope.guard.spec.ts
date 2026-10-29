import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantStatus, UserRole, UserStatus } from '@prisma/client';
import { TicketVerifierScopeGuard } from './ticket-verifier-scope.guard';

type Req = {
  user?: { role: UserRole; tenantId: string; userId: string };
  verifierScope?: unknown;
};

function ctxFor(req: Req): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const activeUser = {
  id: 'u1',
  tenantId: 't1',
  role: UserRole.TICKET_VERIFIER,
  status: UserStatus.ACTIVE,
  deletedAt: null,
};
const activeAssignment = {
  tenantId: 't1',
  routerId: 'r1',
  router: {
    tenantId: 't1',
    deletedAt: null,
    tenant: { status: TenantStatus.ACTIVE },
  },
};

function makeGuard(overrides: {
  user?: unknown;
  assignment?: unknown;
}): TicketVerifierScopeGuard {
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.user === undefined ? activeUser : overrides.user,
        ),
    },
    ticketVerifierAssignment: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.assignment === undefined
            ? activeAssignment
            : overrides.assignment,
        ),
    },
  };
  return new TicketVerifierScopeGuard(prisma as never);
}

describe('TicketVerifierScopeGuard', () => {
  it('injects scope for an active verifier with a valid assignment', async () => {
    const guard = makeGuard({});
    const req: Req = {
      user: { role: UserRole.TICKET_VERIFIER, tenantId: 't1', userId: 'u1' },
    };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.verifierScope).toEqual({
      userId: 'u1',
      tenantId: 't1',
      routerId: 'r1',
    });
  });

  it('refuses a non-verifier role (cannot reach verifier endpoints)', async () => {
    const guard = makeGuard({});
    await expect(
      guard.canActivate(
        ctxFor({ user: { role: UserRole.MEMBER, tenantId: 't1', userId: 'u1' } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses when the JWT has no user attached', async () => {
    const guard = makeGuard({});
    await expect(guard.canActivate(ctxFor({}))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a verifier whose DB role is no longer TICKET_VERIFIER', async () => {
    const guard = makeGuard({
      user: { ...activeUser, role: UserRole.MEMBER },
    });
    await expect(
      guard.canActivate(
        ctxFor({
          user: { role: UserRole.TICKET_VERIFIER, tenantId: 't1', userId: 'u1' },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a disabled verifier (status != ACTIVE)', async () => {
    const guard = makeGuard({
      user: { ...activeUser, status: UserStatus.SUSPENDED },
    });
    await expect(
      guard.canActivate(
        ctxFor({
          user: { role: UserRole.TICKET_VERIFIER, tenantId: 't1', userId: 'u1' },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a deleted verifier', async () => {
    const guard = makeGuard({
      user: { ...activeUser, deletedAt: new Date() },
    });
    await expect(
      guard.canActivate(
        ctxFor({
          user: { role: UserRole.TICKET_VERIFIER, tenantId: 't1', userId: 'u1' },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses when DB tenant does not match the JWT tid', async () => {
    const guard = makeGuard({});
    await expect(
      guard.canActivate(
        ctxFor({
          user: { role: UserRole.TICKET_VERIFIER, tenantId: 'tOTHER', userId: 'u1' },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses when the verifier has no active assignment', async () => {
    const guard = makeGuard({ assignment: null });
    await expect(
      guard.canActivate(
        ctxFor({
          user: { role: UserRole.TICKET_VERIFIER, tenantId: 't1', userId: 'u1' },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses an assignment whose router belongs to another tenant', async () => {
    const guard = makeGuard({
      assignment: {
        ...activeAssignment,
        router: { ...activeAssignment.router, tenantId: 'tOTHER' },
      },
    });
    await expect(
      guard.canActivate(
        ctxFor({
          user: { role: UserRole.TICKET_VERIFIER, tenantId: 't1', userId: 'u1' },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses when the assigned router is deleted', async () => {
    const guard = makeGuard({
      assignment: {
        ...activeAssignment,
        router: { ...activeAssignment.router, deletedAt: new Date() },
      },
    });
    await expect(
      guard.canActivate(
        ctxFor({
          user: { role: UserRole.TICKET_VERIFIER, tenantId: 't1', userId: 'u1' },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(['OFFLINE', 'DEGRADED', 'ERROR', 'UNKNOWN'])(
    'passes even when RouterHealth=%s (verification is DB-only via ticketState)',
    async () => {
      // Health is intentionally not even selected by the guard; the DB can
      // hold any RouterHealth value and the guard must still inject the scope.
      const guard = makeGuard({});
      const req: Req = {
        user: { role: UserRole.TICKET_VERIFIER, tenantId: 't1', userId: 'u1' },
      };
      await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
      expect(req.verifierScope).toEqual({
        userId: 'u1',
        tenantId: 't1',
        routerId: 'r1',
      });
    },
  );

  it('refuses when the tenant is SUSPENDED', async () => {
    const guard = makeGuard({
      assignment: {
        ...activeAssignment,
        router: {
          ...activeAssignment.router,
          tenant: { status: TenantStatus.SUSPENDED },
        },
      },
    });
    await expect(
      guard.canActivate(
        ctxFor({
          user: { role: UserRole.TICKET_VERIFIER, tenantId: 't1', userId: 'u1' },
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
