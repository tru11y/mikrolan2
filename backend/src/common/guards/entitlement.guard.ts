import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALWAYS_ALLOWED_KEY } from '../decorators/always-allowed.decorator';
import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service';
import { TenantContext } from '../context/tenant-context';
import { UserRole } from '@prisma/client';

/**
 * Enforces the paywall. Once the free trial has run out and no PRO plan is
 * active, the tenant's data is off limits until they pay — only the account
 * and the upgrade flow stay reachable (see @AlwaysAllowed).
 *
 * The padlocks drawn in the app mirror this; they are not what enforces it.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bypass = this.reflector.getAllAndOverride<boolean>(
      ALWAYS_ALLOWED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (bypass) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{ user?: TenantContext }>();
    const user = req.user;
    if (!user) return true; // JwtAuthGuard already rejected, nothing to gate

    // Platform staff must keep access to support a locked tenant.
    if (user.role === UserRole.SUPER_ADMIN) return true;

    const entitlement = await this.subscriptions.getEntitlement(user.tenantId);
    if (entitlement.tier !== 'LOCKED') return true;

    throw new ForbiddenException({
      code: 'SUBSCRIPTION_REQUIRED',
      message:
        'Votre période d’essai est terminée. Activez un forfait PRO pour ' +
        'retrouver l’accès à vos routeurs.',
    });
  }
}
