import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditAction, ManagementMode, Prisma, RemotePeerStatus } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { WireGuardService, type LivePeer } from '../../common/wireguard/wireguard.service';
import { describeFailure, EventLogService } from '../events/event-log.service';
import {
  classifyPeer,
  stateSeverity,
  WG_PEER_STATES,
  type WgPeerState,
} from './wireguard-state';
import type { ListWgPeersQueryDto, RevokeWgPeerDto } from './dto/admin.schemas';

export interface WgPeerRow {
  id: string;
  status: RemotePeerStatus;
  state: WgPeerState;
  tenant: { id: string; name: string };
  router: { id: string; alias: string | null; identity: string; health: string; mode: string };
  wgIp: string;
  allocatedPort: number;
  provisionedAt: string | null;
  revokedAt: string | null;
  lastHandshakeAt: string | null;
  handshakeAgeS: number | null;
  rxBytes: number | null;
  txBytes: number | null;
  clientEndpoint: string | null;
  lastHeartbeat: string | null;
}

export interface WgPeersResponse {
  items: WgPeerRow[];
  total: number;
  summary: Record<Lowercase<WgPeerState>, number> & {
    total: number;
    wgEnabled: boolean;
    liveAvailable: boolean;
    drift: { liveNotInDb: number; dbActiveNotLive: number };
  };
}

type Actor = { userId: string; tenantId: string };

const SEVERITY_TIE = (a: WgPeerRow, b: WgPeerRow) =>
  (a.router.alias ?? a.router.identity).localeCompare(b.router.alias ?? b.router.identity);

/**
 * Vue d'exploitation WireGuard du SUPER_ADMIN. Lecture de l'état réel via `wg` ;
 * aucune re-provision ici (elle génère une clé privée à pousser sur le LAN du
 * routeur : seule l'app du propriétaire peut le faire).
 */
@Injectable()
export class AdminWireGuardService {
  private readonly logger = new Logger(AdminWireGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wg: WireGuardService,
    private readonly eventLog: EventLogService,
  ) {}

  async listPeers(query: ListWgPeersQueryDto): Promise<WgPeersResponse> {
    const peers = await this.prisma.remotePeer.findMany({
      where: { router: { deletedAt: null } },
      select: {
        id: true,
        routerId: true,
        tenantId: true,
        wgPublicKey: true,
        wgIp: true,
        allocatedPort: true,
        status: true,
        provisionedAt: true,
        revokedAt: true,
        router: {
          select: { id: true, alias: true, identity: true, health: true, mode: true, lastHeartbeat: true },
        },
      },
    });

    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: [...new Set(peers.map((p) => p.tenantId))] } },
      select: { id: true, name: true },
    });
    const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

    const live = await this.readLive();
    const nowS = Math.floor(Date.now() / 1000);

    const rows: WgPeerRow[] = peers.map((p) => {
      const lp = live?.[p.wgPublicKey];
      const { state, handshakeAgeS } = classifyPeer(
        p.status,
        live === null ? null : (lp?.latestHandshake ?? 0),
        nowS,
      );
      return {
        id: p.id,
        status: p.status,
        state,
        tenant: { id: p.tenantId, name: tenantName.get(p.tenantId) ?? '—' },
        router: {
          id: p.router.id,
          alias: p.router.alias,
          identity: p.router.identity,
          health: p.router.health,
          mode: p.router.mode,
        },
        wgIp: p.wgIp,
        allocatedPort: p.allocatedPort,
        provisionedAt: p.provisionedAt?.toISOString() ?? null,
        revokedAt: p.revokedAt?.toISOString() ?? null,
        lastHandshakeAt:
          lp && lp.latestHandshake > 0 ? new Date(lp.latestHandshake * 1000).toISOString() : null,
        handshakeAgeS,
        rxBytes: lp ? lp.rxBytes : null,
        txBytes: lp ? lp.txBytes : null,
        clientEndpoint: lp?.endpoint ?? null,
        lastHeartbeat: p.router.lastHeartbeat?.toISOString() ?? null,
      };
    });

    const summary = this.summarize(rows, peers, live);

    const needle = query.q?.toLowerCase();
    const items = rows
      .filter((r) => !query.tenantId || r.tenant.id === query.tenantId)
      .filter((r) => !query.state || r.state === query.state)
      .filter(
        (r) =>
          !needle ||
          (r.router.alias ?? '').toLowerCase().includes(needle) ||
          r.router.identity.toLowerCase().includes(needle) ||
          r.tenant.name.toLowerCase().includes(needle),
      )
      .sort((a, b) => stateSeverity(a.state) - stateSeverity(b.state) || SEVERITY_TIE(a, b));

    return { items: items.slice(0, query.limit), total: items.length, summary };
  }

  resync(routerId: string, actor: Actor): Promise<{ resynced: true }> {
    return this.eventLog.guard(
      {
        action: AuditAction.UPDATE,
        entityType: 'RemotePeer',
        entityId: routerId,
        metadata: { kind: 'wg-resync' },
        actor: { tenantId: actor.tenantId, userId: actor.userId },
      },
      () => this.resyncInner(routerId, actor),
    );
  }

  private async resyncInner(routerId: string, actor: Actor): Promise<{ resynced: true }> {
    this.assertWgEnabled();
    const peer = await this.findPeer(routerId);
    if (peer.status !== RemotePeerStatus.ACTIVE) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.REMOTE_ACCESS_DISABLED,
        `Le peer n'est pas actif (${peer.status}) : rien à resynchroniser.`,
      );
    }

    const ports = {
      webfigPort: peer.webfigPort,
      sshPort: peer.sshPort,
      winboxPort: peer.winboxPort,
    };
    try {
      // `wg set` est idempotent. `addDnat` ajoute en fin de chaîne (-A) : on retire
      // d'abord les règles de CE peer pour ne jamais les dupliquer, sans toucher aux autres.
      await this.wg.addPeer(peer.wgPublicKey, peer.wgIp);
      await this.wg.removeDnat(peer.wgIp, peer.allocatedPort, ports);
      await this.wg.addDnat(peer.wgIp, peer.allocatedPort, ports);
    } catch (err) {
      this.logger.warn(`WG resync failed for router ${routerId}: ${err instanceof Error ? err.message : err}`);
      const failure = new BusinessException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.ROUTER_PROVISION_FAILED,
        'Resynchronisation impossible pour le moment. Réessayez plus tard.',
      );
      await this.eventLog.failure(
        AuditAction.UPDATE,
        'RemotePeer',
        routerId,
        failure,
        { kind: 'wg-resync', targetTenantId: peer.tenantId, cause: describeFailure(err).error },
        { tenantId: actor.tenantId, userId: actor.userId },
      );
      throw failure;
    }

    await this.eventLog.success(
      AuditAction.UPDATE,
      'RemotePeer',
      routerId,
      { kind: 'wg-resync', targetTenantId: peer.tenantId, wgIp: peer.wgIp },
      { tenantId: actor.tenantId, userId: actor.userId },
    );
    return { resynced: true };
  }

  revoke(
    routerId: string,
    dto: RevokeWgPeerDto,
    actor: Actor,
  ): Promise<{ revoked: true; wgRemoved: boolean }> {
    return this.eventLog.guard(
      {
        action: AuditAction.REVOKE,
        entityType: 'RemotePeer',
        entityId: routerId,
        metadata: { kind: 'wg-admin-revoke' },
        actor: { tenantId: actor.tenantId, userId: actor.userId },
      },
      () => this.revokeInner(routerId, dto, actor),
    );
  }

  private async revokeInner(
    routerId: string,
    dto: RevokeWgPeerDto,
    actor: Actor,
  ): Promise<{ revoked: true; wgRemoved: boolean }> {
    const peer = await this.findPeer(routerId);

    const expected = (peer.router.alias || peer.router.identity).trim().toLowerCase();
    if (dto.confirmName.trim().toLowerCase() !== expected) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.WG_CONFIRM_MISMATCH,
        'Le nom saisi ne correspond pas au routeur : révocation annulée.',
      );
    }
    if (peer.status === RemotePeerStatus.REVOKED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.REMOTE_ACCESS_DISABLED,
        'Cet accès est déjà révoqué.',
      );
    }

    let wgRemovalError: string | null = null;
    try {
      await this.wg.removePeer(peer.wgPublicKey);
      await this.wg.removeDnat(peer.wgIp, peer.allocatedPort, {
        webfigPort: peer.webfigPort,
        sshPort: peer.sshPort,
        winboxPort: peer.winboxPort,
      });
    } catch (err) {
      // Comme la révocation propriétaire : la base reste la source de vérité, le
      // reconciler élaguera le peer résiduel au prochain cycle.
      this.logger.warn(`WG peer removal failed (revoking in DB anyway): ${err instanceof Error ? err.message : err}`);
      wgRemovalError = describeFailure(err).error;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.remotePeer.update({
        where: { id: peer.id },
        data: { status: RemotePeerStatus.REVOKED, revokedAt: new Date() },
      });
      await tx.router.update({ where: { id: routerId }, data: { mode: ManagementMode.LOCAL } });
    });

    const metadata: Prisma.InputJsonObject = {
      kind: 'wg-admin-revoke',
      targetTenantId: peer.tenantId,
      reason: dto.reason,
      ...(wgRemovalError ? { errorCode: ErrorCode.WG_PEER_REMOVAL_FAILED, error: wgRemovalError } : {}),
    };
    const ctx = { tenantId: actor.tenantId, userId: actor.userId };
    if (wgRemovalError) {
      await this.eventLog.warning(AuditAction.REVOKE, 'RemotePeer', routerId, metadata, ctx);
    } else {
      await this.eventLog.success(AuditAction.REVOKE, 'RemotePeer', routerId, metadata, ctx);
    }
    return { revoked: true, wgRemoved: wgRemovalError === null };
  }

  /** `null` = lecture live indisponible (WG désactivé ou `wg` en échec) : jamais assimilée à « aucun peer ». */
  private async readLive(): Promise<Record<string, LivePeer> | null> {
    if (!this.wg.enabled) return null;
    try {
      return await this.wg.livePeers();
    } catch (err) {
      this.logger.warn(`wg dump failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private summarize(
    rows: WgPeerRow[],
    peers: { wgPublicKey: string; status: RemotePeerStatus }[],
    live: Record<string, LivePeer> | null,
  ): WgPeersResponse['summary'] {
    const counts = Object.fromEntries(
      WG_PEER_STATES.map((s) => [s.toLowerCase(), 0]),
    ) as Record<Lowercase<WgPeerState>, number>;
    for (const r of rows) counts[r.state.toLowerCase() as Lowercase<WgPeerState>] += 1;

    const activeKeys = new Set(
      peers.filter((p) => p.status === RemotePeerStatus.ACTIVE).map((p) => p.wgPublicKey),
    );
    const liveKeys = live ? Object.keys(live) : [];
    return {
      ...counts,
      total: rows.length,
      wgEnabled: this.wg.enabled,
      liveAvailable: live !== null,
      drift: {
        liveNotInDb: live ? liveKeys.filter((k) => !activeKeys.has(k)).length : 0,
        dbActiveNotLive: live ? [...activeKeys].filter((k) => !(k in live)).length : 0,
      },
    };
  }

  private assertWgEnabled(): void {
    if (!this.wg.enabled) {
      throw new BusinessException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.REMOTE_ACCESS_DISABLED,
        'WireGuard est désactivé sur ce serveur.',
      );
    }
  }

  private async findPeer(routerId: string) {
    const peer = await this.prisma.remotePeer.findFirst({
      where: { routerId, router: { deletedAt: null } },
      include: { router: { select: { alias: true, identity: true } } },
    });
    if (!peer) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        ErrorCode.REMOTE_ACCESS_NOT_FOUND,
        'Aucun peer WireGuard pour ce routeur.',
      );
    }
    return peer;
  }
}
