import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  AuditAction,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { EventLogService } from '../events/event-log.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { TenantContext } from '../../common/context/tenant-context';
import type {
  CreateVerifierDto,
  ListVerifiersQuery,
  ResetPasswordDto,
  UpdateStatusDto,
  UpdateVerifierDto,
  UpsertAssignmentDto,
} from './dto/verifier.schemas';

// Same Argon2 params as the auth service (auth.service.ts:50) — one source
// of truth would be nicer but is a cleanup, not a correctness issue.
const ARGON: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

// Shape returned by every verifier endpoint. passwordHash / tokens are
// NEVER selected — projecting with Prisma `select` guarantees it at the
// type level, not just at the serialization layer.
const VERIFIER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  verifierAssignment: {
    select: {
      routerId: true,
      router: { select: { id: true, identity: true, alias: true } },
      assignedById: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

type VerifierRow = Prisma.UserGetPayload<{ select: typeof VERIFIER_SELECT }>;

export interface PublicVerifier {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  assignment: {
    routerId: string;
    routerIdentity: string;
    routerAlias: string | null;
    assignedById: string;
    assignedAt: string;
  } | null;
}

function toPublic(v: VerifierRow): PublicVerifier {
  return {
    id: v.id,
    email: v.email,
    name: v.name,
    status: v.status,
    lastLoginAt: v.lastLoginAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    deletedAt: v.deletedAt?.toISOString() ?? null,
    assignment: v.verifierAssignment
      ? {
          routerId: v.verifierAssignment.routerId,
          routerIdentity: v.verifierAssignment.router.identity,
          routerAlias: v.verifierAssignment.router.alias,
          assignedById: v.verifierAssignment.assignedById,
          assignedAt: v.verifierAssignment.updatedAt.toISOString(),
        }
      : null,
  };
}

@Injectable()
export class TicketVerifiersService {
  private readonly logger = new Logger(TicketVerifiersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventLogService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async create(
    ctx: TenantContext,
    dto: CreateVerifierDto,
  ): Promise<PublicVerifier> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.VERIFIER_EMAIL_TAKEN,
        'Cet email est déjà utilisé.',
      );
    }

    // Pre-check router ownership outside the tx so a tenant-mismatch
    // surfaces a dedicated error code instead of a FK violation.
    if (dto.routerId) {
      await this.assertRouterInTenant(ctx.tenantId, dto.routerId);
    }

    await this.subscriptions.assertUserLimit(ctx.tenantId);

    const passwordHash = await argon2.hash(dto.password, ARGON);

    const createdId = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          tenantId: ctx.tenantId,
          email: dto.email,
          name: dto.name ?? null,
          passwordHash,
          hasPassword: true,
          role: UserRole.TICKET_VERIFIER,
          status: UserStatus.ACTIVE,
          notificationsEnabled: false,
        },
        select: { id: true },
      });
      if (dto.routerId) {
        await tx.ticketVerifierAssignment.create({
          data: {
            userId: u.id,
            tenantId: ctx.tenantId,
            routerId: dto.routerId,
            assignedById: ctx.userId,
          },
        });
      }
      return u.id;
    });

    await this.events.emit({
      action: AuditAction.CREATE,
      entityType: 'User',
      entityId: createdId,
      outcome: 'SUCCESS',
      metadata: {
        kind: 'VERIFIER_CREATED',
        role: UserRole.TICKET_VERIFIER,
        assignedRouterId: dto.routerId ?? null,
      },
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });

    return toPublic(await this.loadOrThrow(ctx.tenantId, createdId));
  }

  async list(
    ctx: TenantContext,
    query: ListVerifiersQuery,
  ): Promise<{ items: PublicVerifier[]; nextCursor: string | null }> {
    const where: Prisma.UserWhereInput = {
      tenantId: ctx.tenantId,
      role: UserRole.TICKET_VERIFIER,
      ...(query.status
        ? { status: query.status }
        : { status: { not: UserStatus.DELETED } }),
      ...(query.routerId
        ? { verifierAssignment: { routerId: query.routerId } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.user.findMany({
      where,
      select: VERIFIER_SELECT,
      take: query.limit + 1,
      ...(query.cursor
        ? { cursor: { id: query.cursor }, skip: 1 }
        : {}),
      orderBy: { createdAt: 'desc' },
    });
    const page = rows.slice(0, query.limit);
    const nextCursor =
      rows.length > query.limit ? page[page.length - 1]!.id : null;
    return { items: page.map(toPublic), nextCursor };
  }

  async get(ctx: TenantContext, id: string): Promise<PublicVerifier> {
    return toPublic(await this.loadOrThrow(ctx.tenantId, id));
  }

  async update(
    ctx: TenantContext,
    id: string,
    dto: UpdateVerifierDto,
  ): Promise<PublicVerifier> {
    await this.loadOrThrow(ctx.tenantId, id);
    await this.prisma.user.update({
      where: { id },
      data: { name: dto.name },
    });
    await this.events.emit({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: id,
      outcome: 'SUCCESS',
      metadata: { kind: 'VERIFIER_UPDATED', fields: ['name'] },
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });
    return toPublic(await this.loadOrThrow(ctx.tenantId, id));
  }

  async upsertAssignment(
    ctx: TenantContext,
    id: string,
    dto: UpsertAssignmentDto,
  ): Promise<PublicVerifier> {
    const current = await this.loadOrThrow(ctx.tenantId, id);
    this.assertActiveVerifier(current);
    await this.assertRouterInTenant(ctx.tenantId, dto.routerId);

    const oldRouterId = current.verifierAssignment?.routerId ?? null;

    await this.prisma.$transaction(async (tx) => {
      await tx.ticketVerifierAssignment.upsert({
        where: { userId: id },
        create: {
          userId: id,
          tenantId: ctx.tenantId,
          routerId: dto.routerId,
          assignedById: ctx.userId,
        },
        update: {
          routerId: dto.routerId,
          assignedById: ctx.userId,
        },
      });
      // Revoke refresh tokens inside the transaction so no reassign
      // can commit without the matching revocation.
      await tx.refreshToken.updateMany({
        where: { userId: id, revoked: false },
        data: { revoked: true },
      });
    });

    await this.events.emit({
      action: AuditAction.UPDATE,
      entityType: 'TicketVerifierAssignment',
      entityId: id,
      outcome: 'SUCCESS',
      metadata: {
        kind: oldRouterId ? 'VERIFIER_REASSIGNED' : 'VERIFIER_ASSIGNED',
        oldRouterId,
        newRouterId: dto.routerId,
      },
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });

    return toPublic(await this.loadOrThrow(ctx.tenantId, id));
  }

  async removeAssignment(
    ctx: TenantContext,
    id: string,
  ): Promise<PublicVerifier> {
    const current = await this.loadOrThrow(ctx.tenantId, id);
    const oldRouterId = current.verifierAssignment?.routerId ?? null;
    if (!oldRouterId) {
      // Idempotent — nothing to remove, nothing to revoke.
      return toPublic(current);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketVerifierAssignment.delete({ where: { userId: id } });
      await tx.refreshToken.updateMany({
        where: { userId: id, revoked: false },
        data: { revoked: true },
      });
    });
    await this.events.emit({
      action: AuditAction.UPDATE,
      entityType: 'TicketVerifierAssignment',
      entityId: id,
      outcome: 'SUCCESS',
      metadata: {
        kind: 'VERIFIER_UNASSIGNED',
        oldRouterId,
        newRouterId: null,
      },
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });
    return toPublic(await this.loadOrThrow(ctx.tenantId, id));
  }

  async setStatus(
    ctx: TenantContext,
    id: string,
    dto: UpdateStatusDto,
  ): Promise<PublicVerifier> {
    const current = await this.loadOrThrow(ctx.tenantId, id);
    const next = dto.status as UserStatus;
    if (current.status === UserStatus.DELETED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.VERIFIER_INVALID_STATUS_TRANSITION,
        'Compte supprimé, transition impossible.',
      );
    }
    if (current.status === next) {
      return toPublic(current);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { status: next },
      });
      if (next === UserStatus.SUSPENDED) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revoked: false },
          data: { revoked: true },
        });
      }
    });
    await this.events.emit({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: id,
      outcome: 'SUCCESS',
      metadata: {
        kind:
          next === UserStatus.SUSPENDED
            ? 'VERIFIER_SUSPENDED'
            : 'VERIFIER_REACTIVATED',
        oldStatus: current.status,
        newStatus: next,
      },
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });
    return toPublic(await this.loadOrThrow(ctx.tenantId, id));
  }

  async resetPassword(
    ctx: TenantContext,
    id: string,
    dto: ResetPasswordDto,
  ): Promise<{ reset: true }> {
    const current = await this.loadOrThrow(ctx.tenantId, id);
    if (current.status === UserStatus.DELETED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.VERIFIER_INVALID_STATUS_TRANSITION,
        'Compte supprimé, opération impossible.',
      );
    }
    // Hash OUTSIDE the transaction so a slow argon2 run (65 MiB) doesn't
    // hold a DB row lock. The subsequent two writes are atomic together.
    const passwordHash = await argon2.hash(dto.newPassword, ARGON);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: { passwordHash, hasPassword: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revoked: false },
        data: { revoked: true },
      }),
    ]);
    await this.events.emit({
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: id,
      outcome: 'SUCCESS',
      // NEVER the password nor its hash — only the fact that a reset
      // happened, by whom.
      metadata: { kind: 'VERIFIER_PASSWORD_RESET' },
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });
    return { reset: true };
  }

  async revokeSessions(ctx: TenantContext, id: string): Promise<{ revoked: true }> {
    await this.loadOrThrow(ctx.tenantId, id);
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revoked: false },
      data: { revoked: true },
    });
    await this.events.emit({
      action: AuditAction.REVOKE,
      entityType: 'User',
      entityId: id,
      outcome: 'SUCCESS',
      metadata: { kind: 'VERIFIER_SESSIONS_REVOKED' },
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });
    return { revoked: true };
  }

  async softDelete(ctx: TenantContext, id: string): Promise<{ deleted: true }> {
    const current = await this.loadOrThrow(ctx.tenantId, id);
    if (current.status === UserStatus.DELETED) {
      return { deleted: true };
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // RESTRICT FK on TicketVerifierAssignment → must drop it before the
      // user carries a DELETED status so the row doesn't dangle on a
      // tombstone. Keeping the assignment on a DELETED user would also
      // leave TicketVerifierScopeGuard pointing at a usable router.
      if (current.verifierAssignment) {
        await tx.ticketVerifierAssignment.delete({ where: { userId: id } });
      }
      await tx.user.update({
        where: { id },
        data: { status: UserStatus.DELETED, deletedAt: now },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revoked: false },
        data: { revoked: true },
      });
    });
    await this.events.emit({
      action: AuditAction.DELETE,
      entityType: 'User',
      entityId: id,
      outcome: 'SUCCESS',
      metadata: {
        kind: 'VERIFIER_DELETED',
        hadAssignmentOnRouterId: current.verifierAssignment?.routerId ?? null,
      },
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });
    return { deleted: true };
  }

  // ── helpers ─────────────────────────────────────────────────────

  private async loadOrThrow(
    tenantId: string,
    id: string,
  ): Promise<VerifierRow> {
    const u = await this.prisma.user.findFirst({
      where: {
        id,
        tenantId,
        role: UserRole.TICKET_VERIFIER,
      },
      select: VERIFIER_SELECT,
    });
    if (!u) {
      // Generic 404 — hides the existence of a verifier belonging to another
      // tenant.
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        ErrorCode.VERIFIER_NOT_FOUND,
        'Vendeur introuvable.',
      );
    }
    return u;
  }

  private assertActiveVerifier(v: VerifierRow): void {
    if (v.status === UserStatus.DELETED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.VERIFIER_INVALID_STATUS_TRANSITION,
        'Compte supprimé, opération impossible.',
      );
    }
  }

  private async assertRouterInTenant(
    tenantId: string,
    routerId: string,
  ): Promise<void> {
    const r = await this.prisma.router.findFirst({
      where: { id: routerId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!r) {
      // Dedicated code: a router that exists but belongs to another tenant
      // must look identical to a non-existent one to prevent enumeration.
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        ErrorCode.VERIFIER_ROUTER_FOREIGN,
        'Routeur introuvable dans ce tenant.',
      );
    }
  }
}
