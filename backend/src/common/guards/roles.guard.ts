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
// TICKET_VERIFIER is a DISJOINT role: it never participates in the ranking
// (never inherits MEMBER rights, and no non-verifier can satisfy a verifier
// requirement by rank). Access is granted only when the required list
// explicitly contains TICKET_VERIFIER and the current user has that exact role.
const RANK: Record<Exclude<UserRole, 'TICKET_VERIFIER'>, number> = {
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
    if (!user) throw new ForbiddenException('Session invalide, reconnectez-vous.');

    // Disjoint role: TICKET_VERIFIER passes iff explicitly listed.
    if (user.role === UserRole.TICKET_VERIFIER) {
      if (required.includes(UserRole.TICKET_VERIFIER)) return true;
      throw new ForbiddenException("Vous n'avez pas les droits pour cette action.");
    }
    // Other roles: ranking over non-disjoint requirements only.
    const ranked = required.filter((r) => r !== UserRole.TICKET_VERIFIER);
    if (ranked.length === 0) {
      throw new ForbiddenException("Vous n'avez pas les droits pour cette action.");
    }
    const min = Math.min(...ranked.map((r) => RANK[r as keyof typeof RANK]));
    if (RANK[user.role as keyof typeof RANK] < min) {
      throw new ForbiddenException("Vous n'avez pas les droits pour cette action.");
    }
    return true;
  }
}
