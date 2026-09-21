import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  ManagementMode,
  Prisma,
  RemotePeerStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WireGuardService, SSH_PORT_OFFSET, WINBOX_PORT_OFFSET } from '../../common/wireguard/wireguard.service';
import { generateWgKeyPair } from '../../common/wireguard/wg-keys';
import { getTenantContext } from '../../common/context/tenant-context';
import type { AppConfig } from '../../config/configuration';
import { EventLogService, describeFailure } from '../events/event-log.service';

function ipToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, oct) => (acc << 8) + Number.parseInt(oct, 10), 0)>>>0;
}
function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

export interface ProvisionBundle {
  routerId: string;
  wgIp: string;
  allocatedPort: number;
  serverPublicKey: string;
  endpoint: string;
  peerPublicKey: string;
  // Returned exactly once — the router's private key is never stored server-side.
  routerPrivateKey: string;
  // Echo back the service ports the DNAT actually targets, so the mobile app
  // can display them and detect drift on the next provision.
  webfigPort: number;
  sshPort: number;
  winboxPort: number;
}

@Injectable()
export class RemoteAccessService {
  private readonly logger = new Logger(RemoteAccessService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly wg: WireGuardService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly eventLog: EventLogService,
  ) {}

  provision(
    routerId: string,
    actorId: string,
    servicePorts: {
      webfigPort?: number;
      sshPort?: number;
      winboxPort?: number;
    } = {},
  ) {
    return this.eventLog.guard({ action: AuditAction.PROVISION, entityType: 'Router', entityId: routerId, actor: { userId: actorId } }, () => this.provisionInner(routerId, actorId, servicePorts));
  }

  private async provisionInner(
    routerId: string,
    actorId: string,
    servicePorts: {
      webfigPort?: number;
      sshPort?: number;
      winboxPort?: number;
    } = {},
  ): Promise<ProvisionBundle> {
    const tenantId = getTenantContext()?.tenantId;
    if (!tenantId || !(await this.subscriptions.isRemoteAllowed(tenantId))) {
      throw new BusinessException(HttpStatus.FORBIDDEN, ErrorCode.SUBSCRIPTION_TIER_INSUFFICIENT, 'La gestion à distance nécessite un abonnement payant actif.');
    }

    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true },
    });
    if (!router) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.ROUTER_NOT_FOUND, 'Routeur introuvable — il a peut-être été supprimé.');

    const existing = await this.prisma.remotePeer.findFirst({
      where: { routerId },
    });
    if (existing && existing.status === RemotePeerStatus.ACTIVE) {
      throw new BusinessException(HttpStatus.CONFLICT, ErrorCode.REMOTE_ACCESS_ALREADY_ACTIVE, 'La gestion à distance est déjà activée pour ce routeur.');
    }

    // Reuse the router's existing tunnel IP/port on re-provision (previously
    // revoked) so the address stays stable and never drifts from what the
    // router already holds; only allocate fresh for a brand-new router.
    const { wgIp, allocatedPort } = existing
      ? { wgIp: existing.wgIp, allocatedPort: existing.allocatedPort }
      : await this.allocate();
    const keys = generateWgKeyPair();
    const serverPublicKey = this.wg.serverPublicKey;
    const endpoint = this.wg.endpoint;

    // Fall back to RouterOS out-of-the-box values when the client hasn't
    // probed them (older mobile builds, or the router API was unreachable).
    // The reconciler + DB defaults keep these consistent.
    const webfigPort = servicePorts.webfigPort ?? 80;
    const sshPort = servicePorts.sshPort ?? 22;
    const winboxPort = servicePorts.winboxPort ?? 8291;

    try {
      await this.wg.addPeer(keys.publicKey, wgIp);
      await this.wg.addDnat(wgIp, allocatedPort, {
        webfigPort,
        sshPort,
        winboxPort,
      });
    } catch (err) {
      this.logger.warn(`WireGuard provision failed for router ${routerId}: ${err instanceof Error ? err.message : err}`);
      const failure = new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.ROUTER_PROVISION_FAILED, "Impossible d'activer la gestion à distance pour le moment. Réessayez plus tard.");
      await this.eventLog.failure(AuditAction.PROVISION, 'Router', routerId, failure, {
        cause: describeFailure(err).error,
      }, { tenantId, userId: actorId });
      throw failure;
    }

    const data = {
      wgPublicKey: keys.publicKey,
      wgIp,
      allocatedPort,
      serverPublicKey,
      endpoint,
      status: RemotePeerStatus.ACTIVE,
      provisionedAt: new Date(),
      revokedAt: null,
      webfigPort,
      sshPort,
      winboxPort,
    };

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.remotePeer.update({ where: { id: existing.id }, data });
      } else {
        await tx.remotePeer.create({ data: { routerId, tenantId, ...data } });
      }
      await tx.router.update({
        where: { id: routerId },
        data: { mode: ManagementMode.REMOTE },
      });
    });

    await this.audit(tenantId, actorId, AuditAction.PROVISION, routerId, {
      wgIp,
      allocatedPort,
    });

    return {
      routerId,
      wgIp,
      allocatedPort,
      serverPublicKey,
      endpoint,
      peerPublicKey: keys.publicKey,
      routerPrivateKey: keys.privateKey,
      webfigPort,
      sshPort,
      winboxPort,
    };
  }

  revoke(routerId: string, actorId: string) {
    return this.eventLog.guard({ action: AuditAction.REVOKE, entityType: 'Router', entityId: routerId, actor: { userId: actorId } }, () => this.revokeInner(routerId, actorId));
  }

  private async revokeInner(routerId: string, actorId: string) {
    const tenantId = getTenantContext()?.tenantId;
    const peer = await this.prisma.remotePeer.findFirst({ where: { routerId } });
    if (!peer) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.REMOTE_ACCESS_NOT_FOUND, 'Aucun accès à distance actif pour ce routeur.');

    let wgRemovalFailure: Prisma.InputJsonObject | null = null;
    try {
      await this.wg.removePeer(peer.wgPublicKey);
      await this.wg.removeDnat(peer.wgIp, peer.allocatedPort, {
        webfigPort: peer.webfigPort,
        sshPort: peer.sshPort,
        winboxPort: peer.winboxPort,
      });
    } catch (err) {
      this.logger.warn(`WireGuard peer removal failed (proceeding with DB revocation): ${err instanceof Error ? err.message : err}`);
      wgRemovalFailure = { ...describeFailure(err), errorCode: ErrorCode.WG_PEER_REMOVAL_FAILED };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.remotePeer.update({
        where: { id: peer.id },
        data: { status: RemotePeerStatus.REVOKED, revokedAt: new Date() },
      });
      await tx.router.update({
        where: { id: routerId },
        data: { mode: ManagementMode.LOCAL },
      });
    });

    if (wgRemovalFailure) {
      await this.eventLog.warning(AuditAction.REVOKE, 'Router', routerId, wgRemovalFailure, { tenantId, userId: actorId });
    } else {
      await this.audit(tenantId, actorId, AuditAction.REVOKE, routerId, {});
    }
    return { revoked: true };
  }

  async status(routerId: string) {
    const peer = await this.prisma.remotePeer.findFirst({
      where: { routerId },
      select: {
        status: true,
        wgIp: true,
        allocatedPort: true,
        endpoint: true,
        provisionedAt: true,
        revokedAt: true,
        webfigPort: true,
        sshPort: true,
        winboxPort: true,
      },
    });
    if (!peer) return { status: 'NONE' as const };

    const vpsIp = this.wg.vpsPublicIp;
    const accessUrls =
      peer.status === 'ACTIVE' && vpsIp
        ? {
            webfig: { url: `http://${vpsIp}:${peer.allocatedPort}`, port: peer.allocatedPort },
            ssh: {
              host: vpsIp,
              port: peer.allocatedPort + SSH_PORT_OFFSET,
              command: `ssh admin@${vpsIp} -p ${peer.allocatedPort + SSH_PORT_OFFSET}`,
            },
            winbox: {
              host: vpsIp,
              port: peer.allocatedPort + WINBOX_PORT_OFFSET,
              address: `${vpsIp}:${peer.allocatedPort + WINBOX_PORT_OFFSET}`,
            },
          }
        : null;

    return { ...peer, accessUrls };
  }

  /**
   * Allocates the next free tunnel IP and DNAT port across ALL tenants.
   * Uses a raw query to bypass the tenant middleware (global uniqueness).
   */
  private async allocate(): Promise<{ wgIp: string; allocatedPort: number }> {
    const rows = await this.prisma.$queryRaw<
      { wgIp: string; allocatedPort: number }[]
    >(Prisma.sql`SELECT "wgIp", "allocatedPort" FROM "RemotePeer"`);

    const subnet = this.config.get('WG_SUBNET_BASE', { infer: true });
    const [network, prefixStr] = subnet.split('/');
    const prefix = Number.parseInt(prefixStr, 10);
    const baseInt = ipToInt(network);
    const maxHost = 2 ** (32 - prefix) - 2; // exclude network + broadcast

    const usedHosts = new Set(
      rows.map((r) => (ipToInt(r.wgIp) - baseInt) >>> 0),
    );
    let host = 2; // .1 reserved for the server
    while (host <= maxHost && usedHosts.has(host)) host += 1;
    if (host > maxHost) {
      throw new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.ROUTER_PROVISION_FAILED, "Impossible d'activer la gestion à distance pour le moment. Réessayez plus tard.");
    }
    const wgIp = intToIp((baseInt + host) >>> 0);

    const portMin = this.config.get('WG_PORT_MIN', { infer: true });
    const portMax = this.config.get('WG_PORT_MAX', { infer: true });
    const usedPorts = new Set(rows.map((r) => r.allocatedPort));
    let port = portMin;
    while (port <= portMax && usedPorts.has(port)) port += 1;
    if (port > portMax) {
      throw new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.ROUTER_PROVISION_FAILED, "Impossible d'activer la gestion à distance pour le moment. Réessayez plus tard.");
    }

    return { wgIp, allocatedPort: port };
  }

  private audit(
    tenantId: string | undefined,
    userId: string,
    action: AuditAction,
    routerId: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    return this.eventLog.success(action, 'Router', routerId, metadata, { tenantId, userId });
  }
}
