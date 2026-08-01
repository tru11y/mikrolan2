import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContext } from '../../common/context/tenant-context';
import { AdminController } from './admin.controller';
import { EventsController } from '../events/events.controller';

/**
 * Le back-office traverse l'isolation par tenant : le middleware Prisma laisse
 * un SUPER_ADMIN lire toutes les lignes de la plateforme. La seule chose qui
 * sépare un client de l'ensemble des comptes est donc `@Roles` — d'où ce test,
 * qui vérifie la fermeture par défaut plutôt que de faire confiance à la
 * relecture.
 */

function contextFor(
  controller: new (...args: never[]) => object,
  method: string,
  role: UserRole,
): ExecutionContext {
  const user: TenantContext = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    role,
  };
  const handler = (controller.prototype as Record<string, unknown>)[method];
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AdminController — fermeture par rôle', () => {
  const guard = new RolesGuard(new Reflector());

  // Toute méthode publique du contrôleur, pour qu'une route ajoutée demain
  // soit couverte sans qu'on pense à compléter la liste.
  const routes = Object.getOwnPropertyNames(AdminController.prototype).filter(
    (name) => name !== 'constructor',
  );

  it('expose au moins les routes attendues', () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        'listTenants',
        'getTenant',
        'setTenantStatus',
        'listUsers',
        'setUserStatus',
        'listInvoices',
        'metrics',
        'listAudit',
        'listTiers',
        'createTier',
        'updateTier',
        'archiveTier',
      ]),
    );
  });

  for (const role of [UserRole.MEMBER, UserRole.ADMIN, UserRole.OWNER]) {
    it(`refuse ${role} sur toutes les routes admin`, () => {
      for (const route of routes) {
        expect(() =>
          guard.canActivate(contextFor(AdminController, route, role)),
        ).toThrow(ForbiddenException);
      }
    });
  }

  it('laisse passer SUPER_ADMIN', () => {
    for (const route of routes) {
      expect(
        guard.canActivate(contextFor(AdminController, route, UserRole.SUPER_ADMIN)),
      ).toBe(true);
    }
  });

  it('refuse un utilisateur non authentifié', () => {
    const ctx = {
      getHandler: () => AdminController.prototype.metrics,
      getClass: () => AdminController,
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

describe('EventsController — flux plateforme', () => {
  const guard = new RolesGuard(new Reflector());

  it('réserve /events/platform au SUPER_ADMIN', () => {
    for (const role of [UserRole.MEMBER, UserRole.ADMIN, UserRole.OWNER]) {
      expect(() =>
        guard.canActivate(contextFor(EventsController, 'platform', role)),
      ).toThrow(ForbiddenException);
    }
    expect(
      guard.canActivate(contextFor(EventsController, 'platform', UserRole.SUPER_ADMIN)),
    ).toBe(true);
  });

  it('ouvre /events/stream à tout compte authentifié', () => {
    expect(
      guard.canActivate(contextFor(EventsController, 'stream', UserRole.MEMBER)),
    ).toBe(true);
  });
});
