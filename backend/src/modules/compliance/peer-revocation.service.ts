import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  ManagementMode,
  Prisma,
  RemotePeer,
  RemotePeerStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';
import { ErrorCode } from '../../common/error-codes';
import { EventLogService, describeFailure } from '../events/event-log.service';

export type PeerRevocationReason =
  | 'AUTHORIZATION_REVOKED'
  | 'TENANT_DELETED';

/**
 * Coupe les accès WireGuard d'un tenant sans dépendre d'un contexte de requête
 * (utilisable depuis un cron). Même séquence que RemoteAccessService.revoke :
 * si le retrait WireGuard échoue, la base est tout de même révoquée et le
 * réconciliateur élaguera le pair au prochain cycle.
 */
@Injectable()
export class PeerRevocationService {
  private readonly logger = new Logger(PeerRevocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wg: WireGuardService,
    private readonly eventLog: EventLogService,
  ) {}

  async revokePeer(
    peer: RemotePeer,
    reason: PeerRevocationReason,
    actorId?: string,
  ): Promise<void> {
    let removalFailure: Prisma.InputJsonObject | null = null;
    try {
      await this.wg.removePeer(peer.wgPublicKey);
      await this.wg.removeDnat(peer.wgIp, peer.allocatedPort, {
        webfigPort: peer.webfigPort,
        sshPort: peer.sshPort,
        winboxPort: peer.winboxPort,
      });
    } catch (err) {
      this.logger.warn(
        `WireGuard removal failed for router ${peer.routerId} (${reason}): ${err instanceof Error ? err.message : err}`,
      );
      removalFailure = {
        ...describeFailure(err),
        errorCode: ErrorCode.WG_PEER_REMOVAL_FAILED,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.remotePeer.update({
        where: { id: peer.id },
        data: { status: RemotePeerStatus.REVOKED, revokedAt: new Date() },
      });
      await tx.router.update({
        where: { id: peer.routerId },
        data: { mode: ManagementMode.LOCAL },
      });
    });

    const actor = { tenantId: peer.tenantId, userId: actorId };
    const metadata: Prisma.InputJsonObject = { reason, ...removalFailure };
    if (removalFailure) {
      await this.eventLog.warning(AuditAction.REVOKE, 'Router', peer.routerId, metadata, actor);
    } else {
      await this.eventLog.success(AuditAction.REVOKE, 'Router', peer.routerId, metadata, actor);
    }
  }

  /** Révoque chaque pair actif ; l'échec d'un pair n'empêche pas les suivants. */
  async revokeAllForTenant(
    tenantId: string,
    reason: PeerRevocationReason,
    actorId?: string,
  ): Promise<number> {
    const peers = await this.prisma.remotePeer.findMany({
      where: { tenantId, status: RemotePeerStatus.ACTIVE },
    });
    return this.revokeEach(peers, reason, actorId);
  }

  async revokeAllForDeletedTenants(): Promise<number> {
    const peers = await this.prisma.remotePeer.findMany({
      where: {
        status: RemotePeerStatus.ACTIVE,
        router: { tenant: { status: 'DELETED' } },
      },
    });
    return this.revokeEach(peers, 'TENANT_DELETED');
  }

  private async revokeEach(
    peers: RemotePeer[],
    reason: PeerRevocationReason,
    actorId?: string,
  ): Promise<number> {
    let revoked = 0;
    for (const peer of peers) {
      try {
        await this.revokePeer(peer, reason, actorId);
        revoked += 1;
      } catch (err) {
        this.logger.error(
          `Peer revocation failed for router ${peer.routerId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return revoked;
  }
}
