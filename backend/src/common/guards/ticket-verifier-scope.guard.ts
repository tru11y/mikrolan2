import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  RouterHealth,
  TenantStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext, isAdminBypass, setAdminBypass } from '../context/tenant-context';

export interface TicketVerifierScope {
  userId: string;
  tenantId: string;
  routerId: string;
}

// Augment Fastify request type via module augmentation would be heavy; use
// a loose shape at the guard boundary. Downstream code reads
// `req.verifierScope` with the same interface.
interface ScopedRequest {
  user?: TenantContext;
  verifierScope?: TicketVerifierScope;
}

/**
 * Server-side scope control for TICKET_VERIFIER endpoints. For every request:
 *  1. the User still exists and is not deleted;
 *  2. its role is still TICKET_VERIFIER (JWT role claim is not trusted alone);
 *  3. its status is ACTIVE;
 *  4. it still belongs to the tenant in the JWT (tid);
 *  5. an active TicketVerifierAssignment exists;
 *  6. the assigned Router belongs to the same tenant and is not deleted;
 *  7. the assigned Router's tenant is ACTIVE.
 *
 * The scope (userId, tenantId, routerId) is injected on the request as
 * `verifierScope`. Downstream handlers MUST use this value — never a routerId
 * sent by the mobile client.
 *
 * NOTE: assignment is loaded with an admin bypass of the tenant middleware,
 * because this guard also protects the "no assignment" and "foreign tenant
 * router" cases that must be unambiguously detected even if the JWT tenant
 * claim is stale.
 */
@Injectable()
export class TicketVerifierScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ScopedRequest>();
    const ctx = req.user;
    if (!ctx) throw new ForbiddenException('Session invalide, reconnectez-vous.');
    if (ctx.role !== UserRole.TICKET_VERIFIER) {
      // Only TICKET_VERIFIER accounts can pass this guard; everything else is
      // deliberately refused so a stale/stolen non-verifier JWT cannot reach
      // a verifier-scoped endpoint.
      throw new ForbiddenException("Vous n'avez pas les droits pour cette action.");
    }

    // The scope lookup must bypass the tenant middleware's auto-filter on
    // Router because we want to detect foreign-tenant assignments explicitly
    // (and refuse them) rather than silently returning "null".
    if (!isAdminBypass()) setAdminBypass();

    const user = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: {
        id: true,
        tenantId: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });
    if (
      !user ||
      user.deletedAt ||
      user.status !== UserStatus.ACTIVE ||
      user.role !== UserRole.TICKET_VERIFIER
    ) {
      throw new ForbiddenException('Compte vendeur indisponible.');
    }
    if (user.tenantId !== ctx.tenantId) {
      throw new ForbiddenException('Compte vendeur indisponible.');
    }

    const assignment = await this.prisma.ticketVerifierAssignment.findUnique({
      where: { userId: user.id },
      select: {
        tenantId: true,
        routerId: true,
        router: {
          select: {
            tenantId: true,
            deletedAt: true,
            health: true,
            tenant: { select: { status: true } },
          },
        },
      },
    });

    if (!assignment) {
      // Caller distinguishes NO_ASSIGNED_HOTSPOT via the exception type if
      // needed; for the foundation guard we return a stable ForbiddenException.
      throw new ForbiddenException('Aucun hotspot affecté.');
    }
    if (
      assignment.tenantId !== user.tenantId ||
      assignment.router.tenantId !== user.tenantId
    ) {
      throw new ForbiddenException('Affectation incohérente.');
    }
    if (
      assignment.router.deletedAt ||
      assignment.router.tenant.status !== TenantStatus.ACTIVE
    ) {
      throw new ForbiddenException('Hotspot indisponible.');
    }
    // RouterHealth is informational here; verification remains possible even
    // if the router is OFFLINE because voucher state lives in the DB.
    void (assignment.router.health as RouterHealth);

    req.verifierScope = {
      userId: user.id,
      tenantId: user.tenantId,
      routerId: assignment.routerId,
    };
    return true;
  }
}
