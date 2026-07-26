import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ManagementMode,
  NotificationType,
  UserRole,
  VoucherStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { listActive, removeActive } from '../../common/routeros/hotspot.ops';
import type { ApiRow } from '../../common/routeros/routeros-api.client';
import { tenantStore, setTenantContext } from '../../common/context/tenant-context';

export interface LiveSession {
  id: string; // RouterOS .id
  user: string;
  ipAddress: string | null;
  macAddress: string | null;
  bytesIn: string;
  bytesOut: string;
  uptime: string | null;
}

function mapActive(row: ApiRow): LiveSession {
  return {
    id: row['.id'] ?? '',
    user: row.user ?? '',
    ipAddress: row.address ?? null,
    macAddress: row['mac-address'] ?? null,
    bytesIn: row['bytes-in'] ?? '0',
    bytesOut: row['bytes-out'] ?? '0',
    uptime: row.uptime ?? null,
  };
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
  ) {}

  /**
   * Background poller: every REMOTE router's `/ip/hotspot/active` is checked
   * for a username matching a GENERATED voucher's code. First sight of a match
   * promotes the voucher to ACTIVE, opens its Session row, and raises a
   * VOUCHER_ACTIVATED notification — this is the only place in the codebase
   * that ever marks a voucher ACTIVE (nothing else did before this existed,
   * which is why revenue and "ticket activé" notifications never worked).
   * Runs outside any HTTP request, so it manually opens a tenant context per
   * router (remote.run()/the Prisma tenant middleware both require one).
   */
  @Interval(25_000)
  async syncActivations(): Promise<void> {
    const routers = await this.prisma.router.findMany({
      where: { mode: ManagementMode.REMOTE, deletedAt: null },
      select: { id: true, tenantId: true },
    });

    for (const router of routers) {
      try {
        await tenantStore.run({}, async () => {
          setTenantContext({
            tenantId: router.tenantId,
            userId: 'system-activity-sync',
            role: UserRole.OWNER,
          });

          const active = await this.remote.run(router.id, (c) => listActive(c));
          if (!active.length) return;

          const codes = active.map((r) => r.user).filter(Boolean);
          if (!codes.length) return;

          const pending = await this.prisma.voucher.findMany({
            where: {
              routerId: router.id,
              status: VoucherStatus.GENERATED,
              code: { in: codes },
            },
          });

          for (const voucher of pending) {
            const row = active.find((r) => r.user === voucher.code);
            if (!row) continue;

            const promoted = await this.prisma.voucher.updateMany({
              where: { id: voucher.id, status: VoucherStatus.GENERATED },
              data: { status: VoucherStatus.ACTIVE, usedAt: new Date() },
            });
            if (promoted.count === 0) continue; // already processed this tick

            await this.prisma.session.create({
              data: {
                tenantId: router.tenantId,
                voucherId: voucher.id,
                routerId: router.id,
                mikrotikId: row.id || null,
                macAddress: row.macAddress,
                ipAddress: row.ipAddress,
                bytesIn: BigInt(row.bytesIn || '0'),
                bytesOut: BigInt(row.bytesOut || '0'),
              },
            });

            await this.prisma.notification.create({
              data: {
                tenantId: router.tenantId,
                type: NotificationType.VOUCHER_ACTIVATED,
                title: 'Ticket activé',
                body: `Le ticket ${voucher.code} vient de se connecter au hotspot.`,
                voucherId: voucher.id,
                routerId: router.id,
              },
            });
          }
        });
      } catch (e) {
        this.logger.warn(
          `Activation sync failed for router ${router.id}: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Live list of everyone connected to the hotspot (not just mikrolan codes).
   * REMOTE routers are read over the tunnel; LOCAL (free) routers are read by
   * the mobile app directly over the LAN.
   */
  async live(routerId: string): Promise<LiveSession[]> {
    const router = await this.getRouter(routerId);
    if (router.mode !== ManagementMode.REMOTE) {
      throw new BadRequestException(
        'Routeur local : les sessions se lisent via le LAN',
      );
    }
    const active = await this.remote.run(routerId, (c) => listActive(c));
    return active.map(mapActive);
  }

  async terminate(routerId: string, mikrotikId: string) {
    const router = await this.getRouter(routerId);
    if (router.mode !== ManagementMode.REMOTE) {
      throw new BadRequestException(
        'Routeur local : déconnexion via le LAN',
      );
    }
    await this.remote.run(routerId, (c) => removeActive(c, mikrotikId));
    return { terminated: true };
  }

  private async getRouter(routerId: string) {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true, mode: true },
    });
    if (!router) throw new NotFoundException('Router not found');
    return router;
  }
}
