import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RemotePeerStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';

const RECONCILE_INTERVAL_MS = 120_000;

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
        select: { wgPublicKey: true, wgIp: true },
      });
      await this.wg.syncPeers(peers);
    } catch (e) {
      this.logger.error(
        `WireGuard reconcile failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
