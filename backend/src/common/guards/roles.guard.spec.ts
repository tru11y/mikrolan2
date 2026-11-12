import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

function ctxFor(role?: UserRole): ExecutionContext {
  const req = role ? { user: { role, tenantId: 't1', userId: 'u1' } } : {};
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function someHandler() {},
    getClass: () => class SomeController {},
  } as unknown as ExecutionContext;
}

function guardFor(required: UserRole[] | undefined): RolesGuard {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key) => (key === ROLES_KEY ? required : undefined));
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('passes when no @Roles() metadata is set', () => {
    expect(guardFor(undefined).canActivate(ctxFor(UserRole.MEMBER))).toBe(true);
  });

  it('throws when no user is attached to the request', () => {
    expect(() =>
      guardFor([UserRole.MEMBER]).canActivate(ctxFor(undefined)),
    ).toThrow(ForbiddenException);
  });

  describe('existing hierarchy — non-regression', () => {
    it('MEMBER passes a MEMBER requirement', () => {
      expect(
        guardFor([UserRole.MEMBER]).canActivate(ctxFor(UserRole.MEMBER)),
      ).toBe(true);
    });
    it('MEMBER cannot pass an ADMIN requirement', () => {
      expect(() =>
        guardFor([UserRole.ADMIN]).canActivate(ctxFor(UserRole.MEMBER)),
      ).toThrow(ForbiddenException);
    });
    it('ADMIN passes an ADMIN requirement', () => {
      expect(
        guardFor([UserRole.ADMIN]).canActivate(ctxFor(UserRole.ADMIN)),
      ).toBe(true);
    });
    it('OWNER passes an ADMIN requirement (hierarchy)', () => {
      expect(
        guardFor([UserRole.ADMIN]).canActivate(ctxFor(UserRole.OWNER)),
      ).toBe(true);
    });
    it('SUPER_ADMIN passes any non-verifier requirement', () => {
      expect(
        guardFor([UserRole.OWNER]).canActivate(ctxFor(UserRole.SUPER_ADMIN)),
      ).toBe(true);
    });
    it('SUPER_ADMIN also passes MEMBER / ADMIN requirements', () => {
      expect(
        guardFor([UserRole.MEMBER]).canActivate(ctxFor(UserRole.SUPER_ADMIN)),
      ).toBe(true);
      expect(
        guardFor([UserRole.ADMIN]).canActivate(ctxFor(UserRole.SUPER_ADMIN)),
      ).toBe(true);
    });
    it('OWNER cannot pass a SUPER_ADMIN requirement', () => {
      expect(() =>
        guardFor([UserRole.SUPER_ADMIN]).canActivate(ctxFor(UserRole.OWNER)),
      ).toThrow(ForbiddenException);
    });
  });

  describe('TICKET_VERIFIER is a disjoint role', () => {
    it('TICKET_VERIFIER passes when explicitly required', () => {
      expect(
        guardFor([UserRole.TICKET_VERIFIER]).canActivate(
          ctxFor(UserRole.TICKET_VERIFIER),
        ),
      ).toBe(true);
    });

    it('TICKET_VERIFIER does NOT inherit MEMBER rights', () => {
      expect(() =>
        guardFor([UserRole.MEMBER]).canActivate(
          ctxFor(UserRole.TICKET_VERIFIER),
        ),
      ).toThrow(ForbiddenException);
    });

    it('TICKET_VERIFIER cannot reach ADMIN endpoints', () => {
      expect(() =>
        guardFor([UserRole.ADMIN]).canActivate(
          ctxFor(UserRole.TICKET_VERIFIER),
        ),
      ).toThrow(ForbiddenException);
    });

    it('TICKET_VERIFIER cannot reach OWNER endpoints', () => {
      expect(() =>
        guardFor([UserRole.OWNER]).canActivate(
          ctxFor(UserRole.TICKET_VERIFIER),
        ),
      ).toThrow(ForbiddenException);
    });

    it('MEMBER cannot pass a TICKET_VERIFIER-only requirement', () => {
      expect(() =>
        guardFor([UserRole.TICKET_VERIFIER]).canActivate(
          ctxFor(UserRole.MEMBER),
        ),
      ).toThrow(ForbiddenException);
    });

    it('OWNER cannot impersonate a TICKET_VERIFIER requirement', () => {
      expect(() =>
        guardFor([UserRole.TICKET_VERIFIER]).canActivate(
          ctxFor(UserRole.OWNER),
        ),
      ).toThrow(ForbiddenException);
    });

    it('SUPER_ADMIN DOES satisfy a verifier-only requirement at RolesGuard level (project convention: SUPER_ADMIN is omnipotent). The TicketVerifierScopeGuard will still refuse it because its DB role is not TICKET_VERIFIER.', () => {
      expect(
        guardFor([UserRole.TICKET_VERIFIER]).canActivate(
          ctxFor(UserRole.SUPER_ADMIN),
        ),
      ).toBe(true);
    });

    it('mixed required [ADMIN, TICKET_VERIFIER]: ADMIN passes', () => {
      expect(
        guardFor([UserRole.ADMIN, UserRole.TICKET_VERIFIER]).canActivate(
          ctxFor(UserRole.ADMIN),
        ),
      ).toBe(true);
    });

    it('mixed required [ADMIN, TICKET_VERIFIER]: TICKET_VERIFIER passes', () => {
      expect(
        guardFor([UserRole.ADMIN, UserRole.TICKET_VERIFIER]).canActivate(
          ctxFor(UserRole.TICKET_VERIFIER),
        ),
      ).toBe(true);
    });

    it('mixed required [ADMIN, TICKET_VERIFIER]: MEMBER refused', () => {
      expect(() =>
        guardFor([UserRole.ADMIN, UserRole.TICKET_VERIFIER]).canActivate(
          ctxFor(UserRole.MEMBER),
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('TICKET_VERIFIER : deny-by-default', () => {
    it('route SANS @Roles : refusée au vendeur (403) mais ouverte à un MEMBER', () => {
      expect(() => guardFor(undefined).canActivate(ctxFor(UserRole.TICKET_VERIFIER))).toThrow(ForbiddenException);
      expect(guardFor(undefined).canActivate(ctxFor(UserRole.MEMBER))).toBe(true);
    });
    it('route SANS @Roles mais dans l’allowlist : ouverte au vendeur', () => {
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ user: { role: UserRole.TICKET_VERIFIER, tenantId: 't', userId: 'u' } }) }),
        getHandler: () => ({ name: 'me' }),
        getClass: () => ({ name: 'AuthController' }),
      } as unknown as ExecutionContext;
      expect(guardFor(undefined).canActivate(ctx)).toBe(true);
    });
  });
});

