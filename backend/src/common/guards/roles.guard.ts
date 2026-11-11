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
import { isVerifierAllowed } from './verifier-allowlist';

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
    const req = context
      .switchToHttp()
      .getRequest<{ user?: TenantContext }>();
    const user = req.user;

    // TICKET_VERIFIER : deny-by-default. Passe seulement si la route le déclare explicitement
    // (@Roles(TICKET_VERIFIER)) ou figure dans l'allowlist centralisée. Une route sans @Roles
    // ne lui est JAMAIS ouverte par défaut.
    if (user?.role === UserRole.TICKET_VERIFIER) {
      if (
        required?.includes(UserRole.TICKET_VERIFIER) ||
        isVerifierAllowed(context.getClass().name, context.getHandler().name)
      ) {
        return true;
      }
      throw new ForbiddenException("Vous n'avez pas les droits pour cette action.");
    }

    if (!required?.length) return true;
    if (!user) throw new ForbiddenException('Session invalide, reconnectez-vous.');

    if (user.role === UserRole.SUPER_ADMIN) return true;

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
