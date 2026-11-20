import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  AuditAction,
  ManagementMode,
  RouterLinkAuthMode,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
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

@Injectable()
export class RouterLinkService {
  private readonly logger = new Logger(RouterLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
    private readonly crypto: CryptoService,
    private readonly eventLog: EventLogService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private wgServerIp(): string {
    return deriveWgServerIp(this.config.get('WG_SUBNET_BASE', { infer: true }));
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
