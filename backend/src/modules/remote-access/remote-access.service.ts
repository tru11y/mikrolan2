import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  ManagementMode,
  Prisma,
  RemotePeerStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';
import { generateWgKeyPair } from '../../common/wireguard/wg-keys';
import { getTenantContext } from '../../common/context/tenant-context';
import type { AppConfig } from '../../config/configuration';

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
}

@Injectable()
export class RemoteAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly wg: WireGuardService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async provision(routerId: string, actorId: string): Promise<ProvisionBundle> {
    const tenantId = getTenantContext()?.tenantId;
    if (!tenantId || !(await this.subscriptions.isRemoteAllowed(tenantId))) {
      throw new ForbiddenException(
        'La gestion à distance nécessite un abonnement PRO actif',
      );
    }

    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true },
    });
    if (!router) throw new NotFoundException('Routeur introuvable — il a peut-être été supprimé.');

    const existing = await this.prisma.remotePeer.findFirst({
      where: { routerId },
    });
    if (existing && existing.status === RemotePeerStatus.ACTIVE) {
      throw new ConflictException('La gestion à distance est déjà activée pour ce routeur.');
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

    try {
      await this.wg.addPeer(keys.publicKey, wgIp);
    } catch {
      throw new ServiceUnavailableException(
        "Impossible d'activer la gestion à distance pour le moment. Réessayez plus tard.",
      );
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
    };
  }

  async revoke(routerId: string, actorId: string) {
    const tenantId = getTenantContext()?.tenantId;
    const peer = await this.prisma.remotePeer.findFirst({ where: { routerId } });
    if (!peer) throw new NotFoundException('Aucun accès à distance actif pour ce routeur.');

    try {
      await this.wg.removePeer(peer.wgPublicKey);
    } catch {
      // proceed with DB revocation even if the peer removal call fails
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

    if (tenantId) {
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
      },
    });
    return peer ?? { status: 'NONE' as const };
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
      throw new ServiceUnavailableException(
        "Impossible d'activer la gestion à distance pour le moment. Réessayez plus tard.",
      );
    }
    const wgIp = intToIp((baseInt + host) >>> 0);

    const portMin = this.config.get('WG_PORT_MIN', { infer: true });
    const portMax = this.config.get('WG_PORT_MAX', { infer: true });
    const usedPorts = new Set(rows.map((r) => r.allocatedPort));
    let port = portMin;
    while (port <= portMax && usedPorts.has(port)) port += 1;
    if (port > portMax) {
      throw new ServiceUnavailableException(
        "Impossible d'activer la gestion à distance pour le moment. Réessayez plus tard.",
      );
    }

    return { wgIp, allocatedPort: port };
  }

  private async audit(
    tenantId: string,
    userId: string,
    action: AuditAction,
    routerId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          action,
          entityType: 'Router',
          entityId: routerId,
          metadata,
        },
      });
    } catch {
      // append-only, best-effort
    }
  }
}
