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
 * Enforces the paywall. FREE accounts keep permanent local access.
 * Only manually suspended tenants are blocked.
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
    if (!user) return true;

    // Platform staff must keep access to support any tenant.
    if (user.role === UserRole.SUPER_ADMIN) return true;

    // FREE = permanent local access, never locked. This guard only blocks
    // manually suspended tenants.
    const entitlement = await this.subscriptions.getEntitlement(user.tenantId);
    if (entitlement.localAllowed) return true;

    throw new ForbiddenException({
      code: 'ACCOUNT_SUSPENDED',
      message: 'Votre compte est suspendu. Contactez le support.',
    });
  }
}
