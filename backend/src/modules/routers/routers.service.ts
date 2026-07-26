import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, ManagementMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { getTenantContext } from '../../common/context/tenant-context';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateRouterDto, UpdateRouterDto } from './dto/router.schemas';
import { TicketTemplateDto } from './dto/ticket-template.schemas';

// Never expose credEncrypted to the API.
const ROUTER_PUBLIC = {
  id: true,
  identity: true,
  alias: true,
  model: true,
  localAddress: true,
  mode: true,
  health: true,
  lastHeartbeat: true,
  ticketTemplate: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RouterSelect;

@Injectable()
export class RoutersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // Remote (cloud + WireGuard) management is a PRO-only feature.
  private async assertRemoteAllowed(mode?: ManagementMode): Promise<void> {
    if (mode !== ManagementMode.REMOTE) return;
    const tenantId = getTenantContext()?.tenantId;
    if (!tenantId || !(await this.subscriptions.isRemoteAllowed(tenantId))) {
      throw new ForbiddenException(
        'La gestion à distance nécessite un abonnement PRO actif',
      );
    }
  }

  async create(dto: CreateRouterDto) {
    await this.assertRemoteAllowed(dto.mode);
    const credEncrypted = dto.credentials
      ? this.crypto.encrypt(JSON.stringify(dto.credentials))
      : null;

    // A previously soft-deleted router with the same identity still occupies the
    // (tenantId, identity) unique index, so re-adding it must restore that record
    // instead of 409ing. Soft delete is never a cascade — we reuse the row.
    const soft = await this.prisma.router.findFirst({
      where: { identity: dto.identity, deletedAt: { not: null } },
      select: { id: true },
    });
    if (soft) {
      // Middleware rewrites update→updateMany (tenant-scoped); no select here.
      await this.prisma.router.update({
        where: { id: soft.id },
        data: {
          deletedAt: null,
          alias: dto.alias ?? null,
          model: dto.model ?? null,
          localAddress: dto.localAddress ?? null,
          mode: dto.mode,
          credEncrypted,
        },
      });
      await this.audit(AuditAction.CREATE, soft.id, {
        identity: dto.identity,
        restored: true,
      });
      return this.findOne(soft.id);
    }

    try {
      // tenantId injected by the Prisma tenant middleware.
      const created = await this.prisma.router.create({
        data: {
          identity: dto.identity,
          alias: dto.alias,
          model: dto.model,
          localAddress: dto.localAddress,
          mode: dto.mode,
          credEncrypted: credEncrypted ?? undefined,
        } as Prisma.RouterCreateInput,
        select: ROUTER_PUBLIC,
      });
      await this.audit(AuditAction.CREATE, created.id, { identity: dto.identity });
      return created;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Router identity already exists');
      }
      throw e;
    }
  }

  findAll() {
    return this.prisma.router.findMany({
      where: { deletedAt: null },
      select: ROUTER_PUBLIC,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const router = await this.prisma.router.findFirst({
      where: { id, deletedAt: null },
      select: ROUTER_PUBLIC,
    });
    if (!router) throw new NotFoundException('Router not found');
    return router;
  }

  async update(id: string, dto: UpdateRouterDto) {
    await this.findOne(id); // ownership + existence (404 if cross-tenant)
    await this.assertRemoteAllowed(dto.mode);

    const data: Prisma.RouterUpdateInput = {};
    if (dto.alias !== undefined) data.alias = dto.alias;
    if (dto.model !== undefined) data.model = dto.model;
    if (dto.localAddress !== undefined) data.localAddress = dto.localAddress;
    if (dto.mode !== undefined) data.mode = dto.mode;
    if (dto.credentials !== undefined) {
      data.credEncrypted = dto.credentials
        ? this.crypto.encrypt(JSON.stringify(dto.credentials))
        : null;
    }

    // Middleware rewrites update→updateMany (tenant-scoped); no select here.
    await this.prisma.router.update({ where: { id }, data });
    return this.findOne(id);
  }

  async updateTicketTemplate(id: string, dto: TicketTemplateDto) {
    await this.findOne(id); // ownership + existence (404 if cross-tenant)
    await this.prisma.router.update({
      where: { id },
      data: { ticketTemplate: dto as Prisma.InputJsonValue },
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.router.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit(AuditAction.DELETE, id, {});
    return { deleted: true };
  }

  private async audit(
    action: AuditAction,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    const ctx = getTenantContext();
    if (!ctx) return;
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          action,
          entityType: 'Router',
          entityId,
          metadata,
        },
      });
    } catch {
      // append-only, best-effort
    }
  }
}
