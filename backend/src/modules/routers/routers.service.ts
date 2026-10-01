import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { EventLogService, describeFailure } from '../events/event-log.service';
import { AuditAction, ManagementMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { getTenantContext } from '../../common/context/tenant-context';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';
import { ClientEventDto, CreateRouterDto, UpdateRouterDto } from './dto/router.schemas';
import { TicketTemplateDto } from './dto/ticket-template.schemas';

// credEncrypted n'est jamais renvoyé : `toPublic` le remplace par `hasCredentials`.
const ROUTER_PUBLIC = {
  credEncrypted: true,
  id: true,
  identity: true,
  alias: true,
  model: true,
  localAddress: true,
  mode: true,
  health: true,
  lastHeartbeat: true,
  lastSyncAt: true,
  lastSyncError: true,
  syncFailCount: true,
  ticketTemplate: true,
  pushNotifications: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RouterSelect;

type RouterRow = Prisma.RouterGetPayload<{ select: typeof ROUTER_PUBLIC }>;

function toPublic(row: RouterRow) {
  const { credEncrypted, ...rest } = row;
  return { ...rest, hasCredentials: Boolean(credEncrypted) };
}

@Injectable()
export class RoutersService {
  private readonly logger = new Logger(RoutersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly subscriptions: SubscriptionsService,
    private readonly wg: WireGuardService,
    private readonly eventLog: EventLogService,
  ) {}

  // Remote (cloud + WireGuard) management requires a paid plan.
  private async assertRemoteAllowed(mode?: ManagementMode): Promise<void> {
    if (mode !== ManagementMode.REMOTE) return;
    const tenantId = getTenantContext()?.tenantId;
    if (!tenantId || !(await this.subscriptions.isRemoteAllowed(tenantId))) {
      throw new BusinessException(HttpStatus.FORBIDDEN, ErrorCode.SUBSCRIPTION_TIER_INSUFFICIENT, 'La gestion à distance nécessite un abonnement payant actif.');
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
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ROUTER_LIMIT_REACHED,
        `Votre formule autorise ${entitlement.routerLimit} routeur${entitlement.routerLimit > 1 ? 's' : ''}. Passez à une formule supérieure pour en ajouter.`,
        { limit: entitlement.routerLimit, used: count },
      );
    }
  }

  create(dto: CreateRouterDto) {
    return this.eventLog.track(
      {
        action: AuditAction.CREATE,
        entityType: 'Router',
        metadata: { identity: dto.identity, mode: dto.mode ?? 'LOCAL' },
      },
      () => this.createRouter(dto),
      (router) => ({ entityId: router.id }),
    );
  }

  private async createRouter(dto: CreateRouterDto) {
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
      return toPublic(created);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BusinessException(HttpStatus.CONFLICT, ErrorCode.ROUTER_DUPLICATE_IDENTITY, 'Un routeur avec cette identité existe déjà.');
      }
      throw e;
    }
  }

  async findAll() {
    const rows = await this.prisma.router.findMany({
      where: { deletedAt: null },
      select: ROUTER_PUBLIC,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPublic);
  }

  /** Trace d'une action faite par l'app directement sur le LAN (invisible du serveur). */
  async recordClientEvent(id: string, dto: ClientEventDto) {
    await this.findOne(id);
    const isDiagnostic = dto.kind === 'REBOOT' || dto.kind === 'HOTSPOT_RESET';
    const action =
      dto.kind === 'REBOOT'
        ? AuditAction.REBOOT
        : dto.kind === 'HOTSPOT_RESET'
          ? AuditAction.DIAGNOSE
          : AuditAction.CONNECT;
    await this.eventLog.emit({
      action,
      entityType: isDiagnostic ? 'Diagnostic' : 'Router',
      entityId: id,
      outcome: dto.outcome,
      metadata: {
        source: 'app',
        via: 'lan',
        kind: dto.kind,
        ...(dto.errorCode ? { errorCode: dto.errorCode } : {}),
        ...(dto.message ? { error: dto.message } : {}),
      },
    });
    return { recorded: true };
  }

  async findOne(id: string) {
    const router = await this.prisma.router.findFirst({
      where: { id, deletedAt: null },
      select: ROUTER_PUBLIC,
    });
    if (!router) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.ROUTER_NOT_FOUND, 'Routeur introuvable — il a peut-être été supprimé.');
    return toPublic(router);
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

  /**
   * Secret en clair destiné à la restauration LAN d'un ADMIN (voir contrôleur).
   * Tenant filtré explicitement (le middleware Prisma est contourné pour SUPER_ADMIN).
   * Chaque lecture réussie est auditée ; l'audit ne contient jamais le secret.
   * Routeur sans identifiants → `null` (état normal, pas une erreur).
   */
  async getCredentials(id: string) {
    const tenantId = getTenantContext()?.tenantId;
    const router = tenantId
      ? await this.prisma.router.findFirst({
          where: { id, tenantId, deletedAt: null },
          select: { id: true, credEncrypted: true, localAddress: true },
        })
      : null;
    if (!router) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.ROUTER_NOT_FOUND, 'Routeur introuvable.');
    if (!router.credEncrypted) return null;
    const creds = JSON.parse(this.crypto.decrypt(router.credEncrypted)) as {
      username: string;
      password: string;
    };
    await this.eventLog.emit({
      action: AuditAction.DOWNLOAD,
      entityType: 'Router',
      entityId: id,
      outcome: 'SUCCESS',
      metadata: { purpose: 'lan-credentials-restore' },
    });
    return {
      username: creds.username,
      password: creds.password,
      host: router.localAddress ?? null,
    };
  }

  remove(id: string) {
    return this.eventLog.track(
      { action: AuditAction.DELETE, entityType: 'Router', entityId: id },
      async () => {
        await this.findOne(id);
        await this.hardCleanup(id);
        return { deleted: true };
      },
    );
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
      } catch (err) {
        this.logger.warn(`WireGuard cleanup failed (proceeding): ${err instanceof Error ? err.message : err}`);
        await this.eventLog.warning(AuditAction.DELETE, 'Router', routerId, {
          ...describeFailure(err),
          errorCode: ErrorCode.WG_PEER_REMOVAL_FAILED,
        });
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
}
