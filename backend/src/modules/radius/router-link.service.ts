import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  AuditAction,
  ManagementMode,
  Prisma,
  RouterLinkAuthMode,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EventLogService } from '../events/event-log.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import type { AppConfig } from '../../config/configuration';
import {
  disableHotspotRadius,
  ensureHotspotUsesRadius,
  ensureRadiusClient,
  hotspotProfileUsesRadius,
  profileNameForServer,
  HS_SERVER,
} from '../../common/routeros/hotspot.ops';

/**
 * Dérive l'IP du serveur RADIUS (= gateway WireGuard, premier host du
 * WG_SUBNET_BASE, p. ex. 10.20.0.1 pour 10.20.0.0/24) : c'est l'adresse que le
 * NAS doit cibler comme client RADIUS, le VPS étant le seul point joignable via
 * le tunnel. Logique alignée sur l'allocation d'IP de remote-access.service.
 */
export function deriveWgServerIp(subnetBase: string): string {
  const [network] = subnetBase.split('/');
  const baseInt =
    network.split('.').reduce((acc, oct) => (acc << 8) + Number.parseInt(oct, 10), 0) >>> 0;
  const serverInt = (baseInt + 1) >>> 0; // .1 réservé au serveur
  return [24, 16, 8, 0].map((s) => (serverInt >>> s) & 255).join('.');
}

/** Projection publique d'un lien : aucun secret (radiusSecretEncrypted vit sur Router, jamais exposé ici). */
const ROUTER_LINK_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  authMode: true,
  createdAt: true,
  updatedAt: true,
  routers: {
    select: {
      routerId: true,
      radiusReadyAt: true,
      router: { select: { identity: true, alias: true, mode: true } },
    },
  },
} satisfies Prisma.RouterLinkSelect;

export type RouterLinkView = Prisma.RouterLinkGetPayload<{
  select: typeof ROUTER_LINK_SELECT;
}>;

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'lien'
  );
}

@Injectable()
export class RouterLinkService {
  private readonly logger = new Logger(RouterLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
    private readonly crypto: CryptoService,
    private readonly eventLog: EventLogService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private wgServerIp(): string {
    return deriveWgServerIp(this.config.get('WG_SUBNET_BASE', { infer: true }));
  }

  // ─── CRUD des liens (isolation tenant explicite) ────────────────────────
  // RouterLink / RouterLinkMember ne sont PAS couverts par le middleware Prisma
  // (hors TENANT_MODELS) : chaque requête porte tenantId à la main, dans les
  // deux sens (where en lecture, data en écriture).

  async createLink(
    tenantId: string,
    actorId: string,
    dto: { name: string; authMode: RouterLinkAuthMode; routerIds: string[] },
  ): Promise<RouterLinkView> {
    await this.subscriptions.assertRouterLinking(tenantId);
    const uniqueRouterIds = [...new Set(dto.routerIds)];
    await this.assertRoutersOwned(uniqueRouterIds);
    if (dto.authMode === RouterLinkAuthMode.RADIUS) {
      for (const routerId of uniqueRouterIds) {
        await this.assertRouterAllowedInRadiusLink(routerId);
      }
    }

    const slug = await this.uniqueSlug(tenantId, slugify(dto.name));
    const link = await this.prisma.routerLink.create({
      data: {
        tenantId,
        name: dto.name,
        slug,
        authMode: dto.authMode,
        routers: {
          create: uniqueRouterIds.map((routerId) => ({ tenantId, routerId })),
        },
      },
      select: ROUTER_LINK_SELECT,
    });

    await this.eventLog.success(
      AuditAction.CREATE,
      'RouterLink',
      link.id,
      { authMode: dto.authMode, routerIds: uniqueRouterIds },
      { tenantId, userId: actorId },
    );
    return link;
  }

  async listLinks(tenantId: string): Promise<RouterLinkView[]> {
    return this.prisma.routerLink.findMany({
      where: { tenantId },
      select: ROUTER_LINK_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLink(tenantId: string, id: string): Promise<RouterLinkView> {
    const link = await this.prisma.routerLink.findFirst({
      where: { id, tenantId },
      select: ROUTER_LINK_SELECT,
    });
    if (!link) throw this.linkNotFound();
    return link;
  }

  async addMembers(
    tenantId: string,
    actorId: string,
    id: string,
    routerIds: string[],
  ): Promise<RouterLinkView> {
    const link = await this.assertOwnLink(tenantId, id);
    const uniqueRouterIds = [...new Set(routerIds)];
    await this.assertRoutersOwned(uniqueRouterIds);
    if (link.authMode === RouterLinkAuthMode.RADIUS) {
      for (const routerId of uniqueRouterIds) {
        await this.assertRouterAllowedInRadiusLink(routerId);
      }
    }

    await this.prisma.routerLinkMember.createMany({
      data: uniqueRouterIds.map((routerId) => ({ linkId: id, tenantId, routerId })),
      skipDuplicates: true,
    });
    await this.eventLog.success(
      AuditAction.UPDATE,
      'RouterLink',
      id,
      { op: 'addMembers', routerIds: uniqueRouterIds },
      { tenantId, userId: actorId },
    );
    return this.getLink(tenantId, id);
  }

  async removeMember(
    tenantId: string,
    actorId: string,
    id: string,
    routerId: string,
  ): Promise<RouterLinkView> {
    await this.assertOwnLink(tenantId, id);
    await this.prisma.routerLinkMember.deleteMany({
      where: { linkId: id, tenantId, routerId },
    });
    await this.eventLog.success(
      AuditAction.UPDATE,
      'RouterLink',
      id,
      { op: 'removeMember', routerId },
      { tenantId, userId: actorId },
    );
    return this.getLink(tenantId, id);
  }

  /** Bascule DIRECT↔RADIUS. →RADIUS re-valide les membres ; →DIRECT rollback. */
  async setAuthMode(
    tenantId: string,
    actorId: string,
    id: string,
    authMode: RouterLinkAuthMode,
  ): Promise<RouterLinkView> {
    const link = await this.assertOwnLink(tenantId, id);
    if (link.authMode === authMode) return this.getLink(tenantId, id);

    if (authMode === RouterLinkAuthMode.RADIUS) {
      const members = await this.prisma.routerLinkMember.findMany({
        where: { linkId: id, tenantId },
        select: { routerId: true },
      });
      for (const member of members) {
        await this.assertRouterAllowedInRadiusLink(member.routerId);
      }
      await this.prisma.routerLink.updateMany({
        where: { id, tenantId },
        data: { authMode },
      });
    } else {
      // RADIUS → DIRECT : retirer la délégation RADIUS avant de rebasculer.
      await this.deactivateLink(id);
      await this.prisma.routerLink.updateMany({
        where: { id, tenantId },
        data: { authMode },
      });
    }

    await this.eventLog.success(
      AuditAction.UPDATE,
      'RouterLink',
      id,
      { op: 'setAuthMode', authMode },
      { tenantId, userId: actorId },
    );
    return this.getLink(tenantId, id);
  }

  /** Activation RADIUS, gatée par l'interrupteur plateforme + isolation tenant. */
  async activate(
    tenantId: string,
    actorId: string,
    id: string,
  ): Promise<{ total: number; ready: number }> {
    if (!this.config.get('RADIUS_ENABLED', { infer: true })) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.RADIUS_DISABLED,
        "La fonctionnalité RADIUS est désactivée sur la plateforme (RADIUS_ENABLED=false).",
      );
    }
    await this.subscriptions.assertRouterLinking(tenantId);
    await this.assertOwnLink(tenantId, id);
    const result = await this.activateLink(id);
    await this.eventLog.success(
      AuditAction.PROVISION,
      'RouterLink',
      id,
      { op: 'activate', ...result },
      { tenantId, userId: actorId },
    );
    return result;
  }

  /** Rollback de la délégation RADIUS + isolation tenant. */
  async deactivate(tenantId: string, actorId: string, id: string): Promise<void> {
    await this.assertOwnLink(tenantId, id);
    await this.deactivateLink(id);
    await this.eventLog.success(
      AuditAction.REVOKE,
      'RouterLink',
      id,
      { op: 'deactivate' },
      { tenantId, userId: actorId },
    );
  }

  private async assertOwnLink(
    tenantId: string,
    id: string,
  ): Promise<{ id: string; authMode: RouterLinkAuthMode }> {
    const link = await this.prisma.routerLink.findFirst({
      where: { id, tenantId },
      select: { id: true, authMode: true },
    });
    if (!link) throw this.linkNotFound();
    return link;
  }

  /**
   * Vérifie que chaque routeur appartient bien au tenant courant. Router est
   * tenant-scoped par le middleware Prisma : un id d'un autre tenant (ou absent)
   * ne ressort pas et est rejeté en ROUTER_NOT_FOUND.
   */
  private async assertRoutersOwned(routerIds: string[]): Promise<void> {
    if (routerIds.length === 0) return;
    const found = await this.prisma.router.findMany({
      where: { id: { in: routerIds }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== routerIds.length) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        ErrorCode.ROUTER_NOT_FOUND,
        'Routeur introuvable — il a peut-être été supprimé ou appartient à un autre compte.',
      );
    }
  }

  private async uniqueSlug(tenantId: string, base: string): Promise<string> {
    const existing = await this.prisma.routerLink.findMany({
      where: { tenantId, slug: { startsWith: base } },
      select: { slug: true },
    });
    const taken = new Set(existing.map((l) => l.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private linkNotFound(): BusinessException {
    return new BusinessException(
      HttpStatus.NOT_FOUND,
      ErrorCode.REMOTE_ACCESS_NOT_FOUND,
      'Lien introuvable.',
    );
  }

  private interimUpdate(): string {
    return `${this.config.get('RADIUS_INTERIM_INTERVAL', { infer: true })}s`;
  }

  /**
   * Garde-fou composition : un routeur LOCAL ne peut jamais rejoindre un lien
   * RADIUS (le VPS n'est pas joignable depuis un LAN privé — V1 REMOTE/WG seul).
   * À appeler avant d'ajouter un membre à un lien RADIUS.
   */
  async assertRouterAllowedInRadiusLink(routerId: string): Promise<void> {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { mode: true },
    });
    if (!router) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        ErrorCode.ROUTER_NOT_FOUND,
        'Routeur introuvable — il a peut-être été supprimé.',
      );
    }
    if (router.mode === ManagementMode.LOCAL) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.ROUTER_LINK_LOCAL_NOT_ALLOWED_IN_RADIUS,
        'Un routeur en mode LOCAL ne peut pas déléguer au RADIUS : la liaison RADIUS exige des routeurs distants (REMOTE/WireGuard).',
      );
    }
  }

  /**
   * Active la délégation RADIUS d'un lien : pour chaque NAS membre REMOTE, pose
   * le client RADIUS (→ serveur WG) et passe son profil hotspot en use-radius,
   * puis confirme. Échec PER-ROUTEUR (un membre injoignable n'empêche pas les
   * autres). Quand TOUS les membres sont prêts → les vouchers du lien deviennent
   * distribuables ; sinon la distribuabilité retombe à false.
   */
  async activateLink(linkId: string): Promise<{ total: number; ready: number }> {
    const link = await this.prisma.routerLink.findFirst({
      where: { id: linkId },
      select: { id: true, authMode: true },
    });
    if (!link) {
      throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.REMOTE_ACCESS_NOT_FOUND, 'Lien introuvable.');
    }
    if (link.authMode !== RouterLinkAuthMode.RADIUS) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.ROUTER_LINK_LOCAL_NOT_ALLOWED_IN_RADIUS,
        "Ce lien n'est pas en mode RADIUS.",
      );
    }

    const members = await this.prisma.routerLinkMember.findMany({
      where: { linkId },
      select: { id: true, routerId: true, router: { select: { mode: true } } },
    });

    const server = this.wgServerIp();
    const interimUpdate = this.interimUpdate();

    for (const member of members) {
      // V1 : seuls les routeurs REMOTE sont provisionnables (VPS injoignable en LAN).
      if (member.router.mode !== ManagementMode.REMOTE) {
        this.logger.warn({
          errorCode: ErrorCode.ROUTER_LINK_LOCAL_NOT_ALLOWED_IN_RADIUS,
          linkId,
          routerId: member.routerId,
        });
        continue;
      }
      try {
        const secret = await this.ensureRouterSecret(member.routerId);
        const ready = await this.remote.run(member.routerId, async (c) => {
          await ensureRadiusClient(c, { server, secret });
          const profile = await profileNameForServer(c, HS_SERVER);
          await ensureHotspotUsesRadius(c, profile, { interimUpdate });
          return hotspotProfileUsesRadius(c, profile);
        });
        if (!ready) {
          throw new Error('use-radius non confirmé sur le profil hotspot');
        }
        await this.prisma.routerLinkMember.update({
          where: { id: member.id },
          data: { radiusReadyAt: new Date() },
        });
      } catch (err) {
        // Échec per-routeur : on log et on continue, sans casser les autres.
        this.logger.error({
          errorCode: ErrorCode.RADIUS_PROVISION_FAILED,
          linkId,
          routerId: member.routerId,
          error: err instanceof Error ? err.message : String(err),
        });
        await this.eventLog.warning(AuditAction.UPDATE, 'RouterLinkMember', member.id, {
          routerId: member.routerId,
          linkId,
          errorCode: ErrorCode.RADIUS_PROVISION_FAILED,
        });
      }
    }

    return this.reconcileDistributable(linkId);
  }

  /**
   * Rollback : retire la délégation RADIUS de chaque membre (use-radius=no),
   * remet radiusReadyAt=null, et rend les vouchers non distribuables.
   */
  async deactivateLink(linkId: string): Promise<void> {
    const members = await this.prisma.routerLinkMember.findMany({
      where: { linkId },
      select: { id: true, routerId: true, router: { select: { mode: true } } },
    });
    for (const member of members) {
      if (member.router.mode === ManagementMode.REMOTE) {
        try {
          await this.remote.run(member.routerId, async (c) => {
            const profile = await profileNameForServer(c, HS_SERVER);
            await disableHotspotRadius(c, profile);
          });
        } catch (err) {
          this.logger.warn({
            errorCode: ErrorCode.RADIUS_PROVISION_FAILED,
            linkId,
            routerId: member.routerId,
            stage: 'deactivate',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      await this.prisma.routerLinkMember.update({
        where: { id: member.id },
        data: { radiusReadyAt: null },
      });
    }
    await this.prisma.voucher.updateMany({
      where: { linkId },
      data: { radiusDistributable: false },
    });
  }

  /**
   * Distribuabilité = tous les membres radiusReady. Met à jour le flag
   * dénormalisé sur les vouchers du lien dans les deux sens.
   */
  private async reconcileDistributable(
    linkId: string,
  ): Promise<{ total: number; ready: number }> {
    const [total, ready] = await Promise.all([
      this.prisma.routerLinkMember.count({ where: { linkId } }),
      this.prisma.routerLinkMember.count({
        where: { linkId, radiusReadyAt: { not: null } },
      }),
    ]);
    const allReady = total > 0 && total === ready;
    await this.prisma.voucher.updateMany({
      where: { linkId },
      data: { radiusDistributable: allReady },
    });
    return { total, ready };
  }

  /**
   * Garantit qu'un secret RADIUS chiffré existe pour ce routeur. S'il est absent,
   * en génère un fort, le chiffre (CryptoService) et le persiste. Point d'ancrage
   * infra : la génération de clients.conf côté VPS (PR3) doit être régénérée après
   * création d'un nouveau secret — non codé ici.
   */
  private async ensureRouterSecret(routerId: string): Promise<string> {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId },
      select: { radiusSecretEncrypted: true },
    });
    if (router?.radiusSecretEncrypted) {
      return this.crypto.decrypt(router.radiusSecretEncrypted);
    }
    const secret = randomBytes(24).toString('base64url');
    await this.prisma.router.update({
      where: { id: routerId },
      data: { radiusSecretEncrypted: this.crypto.encrypt(secret) },
    });
    this.logger.warn({
      event: 'radius.router_secret_generated',
      routerId,
      note: 'clients.conf (infra PR3) doit être régénéré pour ce NAS',
    });
    return secret;
  }
}
