import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  NotificationType,
  RemotePeerStatus,
  RouterHealth,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';

const RECONCILE_INTERVAL_MS = 20_000;
// A router is ONLINE when its tunnel handshaked within this window.
const HANDSHAKE_FRESH_S = 75;

/**
 * Keeps the wg-mgmt interface in sync with the DB (source of truth). Runtime
 * `wg set` peers do not survive a wg/VPS restart, which silently makes every
 * PRO router unreachable over the tunnel. Reconciling on boot and periodically
 * self-heals that: after any restart, ACTIVE peers are re-applied and revoked
 * ones pruned — no manual `wg set` ever needed. Runs without tenant context,
 * so the isolation middleware leaves the query unscoped (all tenants).
 */
@Injectable()
export class WireGuardReconciler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WireGuardReconciler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly wg: WireGuardService,
  ) {}

  onModuleInit(): void {
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcile(): Promise<void> {
    try {
      const peers = await this.prisma.remotePeer.findMany({
        where: { status: RemotePeerStatus.ACTIVE },
        select: { wgPublicKey: true, wgIp: true, routerId: true },
      });
      await this.wg.syncPeers(peers);
      await this.updateHealth(peers);
    } catch (e) {
      this.logger.error(
        `WireGuard reconcile failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * Heartbeat: a REMOTE router is ONLINE iff its WireGuard peer handshaked
   * recently. Fixes the "hors ligne" badge on reachable routers (health stayed
   * UNKNOWN with no poller). LOCAL routers are untouched (no tunnel to observe).
   */
  private async updateHealth(
    peers: { wgPublicKey: string; routerId: string }[],
  ): Promise<void> {
    if (!peers.length) return;
    const handshakes = await this.wg.latestHandshakes();
    const now = Math.floor(Date.now() / 1000);
    for (const p of peers) {
      const last = handshakes[p.wgPublicKey] ?? 0;
      const online = last > 0 && now - last < HANDSHAKE_FRESH_S;
      const next = online ? RouterHealth.ONLINE : RouterHealth.OFFLINE;

      // On lit l'état précédent pour n'émettre que sur la transition : sans
      // ça un routeur éteint réémettrait une alerte toutes les minutes.
      const before = await this.prisma.router.findUnique({
        where: { id: p.routerId },
        select: { health: true, tenantId: true, identity: true, alias: true },
      });

      await this.prisma.router.update({
        where: { id: p.routerId },
        data: {
          health: next,
          ...(online ? { lastHeartbeat: new Date(last * 1000) } : {}),
        },
      });

      if (before && before.health === RouterHealth.ONLINE && !online) {
        this.events.publish(before.tenantId, {
          type: NotificationType.ROUTER_OFFLINE,
          title: 'Routeur injoignable',
          body: `${before.alias || before.identity} ne répond plus.`,
          data: { routerId: p.routerId },
        });
      } else if (before && before.health !== RouterHealth.ONLINE && online) {
        this.events.publish(before.tenantId, {
          type: NotificationType.ROUTER_ONLINE,
          title: 'Routeur de nouveau joignable',
          body: `${before.alias || before.identity} est de retour en ligne.`,
          data: { routerId: p.routerId },
        });
      }
    }
  }
}
