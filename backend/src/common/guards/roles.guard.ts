import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { TenantContext } from '../context/tenant-context';

// Intra-tenant hierarchy; SUPER_ADMIN (platform) satisfies any requirement.
const RANK: Record<UserRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
  SUPER_ADMIN: 4,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context
      .switchToHttp()
      .getRequest<{ user?: TenantContext }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('No authenticated user');

    const min = Math.min(...required.map((r) => RANK[r]));
    if (RANK[user.role] < min) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
