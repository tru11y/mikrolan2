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
import { WireGuardService } from '../../common/wireguard/wireguard.service';
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
  pushNotifications: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RouterSelect;

@Injectable()
export class RoutersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly subscriptions: SubscriptionsService,
    private readonly wg: WireGuardService,
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

  // `routerLimit` was computed in the entitlement (subscriptions.service.ts)
  // and exposed to the app, but never enforced server-side — a tenant could
  // create unlimited routers regardless of their tier. `null` = unlimited.
  private async assertRouterLimit(tenantId: string): Promise<void> {
    const entitlement = await this.subscriptions.getEntitlement(tenantId);
    if (entitlement.routerLimit === null) return;
    const count = await this.prisma.router.count({
      where: { tenantId, deletedAt: null },
    });
    if (count >= entitlement.routerLimit) {
      throw new ForbiddenException(
        `Votre formule autorise ${entitlement.routerLimit} routeur${entitlement.routerLimit > 1 ? 's' : ''}. Passez à une formule supérieure pour en ajouter.`,
      );
    }
  }

  async create(dto: CreateRouterDto) {
    await this.assertRemoteAllowed(dto.mode);
    const tenantId = getTenantContext()?.tenantId;
    if (tenantId) await this.assertRouterLimit(tenantId);
    const credEncrypted = dto.credentials
      ? this.crypto.encrypt(JSON.stringify(dto.credentials))
      : null;

    // If a soft-deleted router with the same identity exists, hard-delete it
    // and all its data so the new one goes through the full onboarding process.
    // Filtered explicitly by tenantId rather than relying solely on the Prisma
    // middleware, which is skipped for SUPER_ADMIN — without this a platform
    // admin creating a router could hard-delete another tenant's data.
    const soft = await this.prisma.router.findFirst({
      where: { identity: dto.identity, tenantId, deletedAt: { not: null } },
      select: { id: true },
    });
    if (soft) {
      await this.hardCleanup(soft.id);
    }

    try {
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
        throw new ConflictException('Un routeur avec cette identité existe déjà.');
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
    if (!router) throw new NotFoundException('Routeur introuvable — il a peut-être été supprimé.');
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
    if (dto.pushNotifications !== undefined) data.pushNotifications = dto.pushNotifications;

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
    await this.hardCleanup(id);
    await this.audit(AuditAction.DELETE, id, {});
    return { deleted: true };
  }

  /**
   * Full hard delete: WG peer + DNAT iptables + every DB row tied to this
   * router. Shared by remove() and create() (stale soft-deleted cleanup).
   */
  private async hardCleanup(routerId: string): Promise<void> {
    const peer = await this.prisma.remotePeer.findFirst({
      where: { routerId },
    });
    if (peer) {
      try {
        await this.wg.removePeer(peer.wgPublicKey);
        await this.wg.removeDnat(peer.wgIp, peer.allocatedPort, {
          webfigPort: peer.webfigPort,
          sshPort: peer.sshPort,
          winboxPort: peer.winboxPort,
        });
      } catch {
        // best-effort — proceed with DB cleanup regardless
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { routerId } });
      await tx.voucher.deleteMany({ where: { routerId } });
      await tx.voucherBatch.deleteMany({ where: { routerId } });
      await tx.plan.deleteMany({ where: { routerId } });
      await tx.notification.deleteMany({ where: { routerId } });
      if (peer) await tx.remotePeer.delete({ where: { id: peer.id } });
      await tx.router.delete({ where: { id: routerId } });
    });
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
