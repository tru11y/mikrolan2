import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ManagementMode,
  NotificationType,
  SessionStatus,
  UserRole,
  VoucherStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Brings the DB in line with what the router reports as connected. First
   * sight of a code promotes its voucher to ACTIVE, opens the Session row and
   * raises a VOUCHER_ACTIVATED notification — this is the only place in the
   * codebase that ever marks a voucher ACTIVE, which is what makes revenue
   * non-zero. Codes that have disappeared close their session, so
   * `activeSessions` can go back down.
   *
   * Both modes funnel through here: REMOTE reads the router over the tunnel
   * (syncActivations), LOCAL has the mobile app post what it read over the LAN
   * (syncFromLan). Requires an open tenant context.
   */
  private async reconcileActive(
    routerId: string,
    tenantId: string,
    active: LiveSession[],
  ): Promise<void> {
    const now = new Date();
    const codes = [...new Set(active.map((r) => r.user).filter(Boolean))];

    const open = await this.prisma.session.findMany({
      where: { routerId, status: SessionStatus.ACTIVE },
      select: { id: true, voucher: { select: { code: true } } },
    });
    const ended = open.filter((s) => !codes.includes(s.voucher.code));
    if (ended.length) {
      await this.prisma.session.updateMany({
        where: { id: { in: ended.map((s) => s.id) } },
        data: { status: SessionStatus.TERMINATED, terminatedAt: now },
      });
      // Poussé sur le flux mais pas persisté en notification : une fin de
      // session est un fait de tableau de bord, pas une alerte à relire.
      for (const session of ended) {
        this.events.publish(tenantId, {
          type: NotificationType.SESSION_ENDED,
          title: 'Session terminée',
          body: `Le ticket ${session.voucher.code} s'est déconnecté.`,
          data: { routerId, sessionId: session.id, code: session.voucher.code },
        });
      }
    }

    if (!codes.length) return;

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        routerId,
        code: { in: codes },
        status: { in: [VoucherStatus.GENERATED, VoucherStatus.ACTIVE] },
      },
      select: {
        id: true,
        code: true,
        status: true,
        session: { select: { id: true } },
      },
    });

    for (const voucher of vouchers) {
      const row = active.find((r) => r.user === voucher.code);
      if (!row) continue;

      const seen = {
        mikrotikId: row.id || null,
        macAddress: row.macAddress,
        ipAddress: row.ipAddress,
        bytesIn: BigInt(row.bytesIn || '0'),
        bytesOut: BigInt(row.bytesOut || '0'),
        lastSeenAt: now,
      };

      // Session already opened: refresh its counters, and reopen it if the
      // same code came back after having been closed.
      if (voucher.session) {
        await this.prisma.session.update({
          where: { id: voucher.session.id },
          data: { ...seen, status: SessionStatus.ACTIVE, terminatedAt: null },
        });
        continue;
      }

      const firstSight = voucher.status === VoucherStatus.GENERATED;
      if (firstSight) {
        const promoted = await this.prisma.voucher.updateMany({
          where: { id: voucher.id, status: VoucherStatus.GENERATED },
          data: { status: VoucherStatus.ACTIVE, usedAt: now },
        });
        if (promoted.count === 0) continue; // another tick got there first
      }

      await this.prisma.session.create({
        data: { tenantId, voucherId: voucher.id, routerId, ...seen },
      });

      if (firstSight) {
        const title = 'Ticket activé';
        const body = `Le ticket ${voucher.code} vient de se connecter au hotspot.`;
        await this.prisma.notification.create({
          data: {
            tenantId,
            type: NotificationType.VOUCHER_ACTIVATED,
            title,
            body,
            voucherId: voucher.id,
            routerId,
          },
        });
        // La notification est l'historique ; l'évènement est l'immédiat. Les
        // deux, parce que l'opérateur peut être hors ligne au moment précis
        // où le client se connecte.
        this.events.publish(tenantId, {
          type: NotificationType.VOUCHER_ACTIVATED,
          title,
          body,
          data: { voucherId: voucher.id, routerId, code: voucher.code },
        });
        this.notifications.sendPushToTenant(tenantId, title, body, routerId);
      }
    }
  }

  /**
   * Background poller for REMOTE routers. Runs outside any HTTP request, so it
   * manually opens a tenant context per router (remote.run()/the Prisma tenant
   * middleware both require one).
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
          await this.reconcileActive(
            router.id,
            router.tenantId,
            active.map(mapActive),
          );
        });
      } catch (e) {
        this.logger.warn(
          `Activation sync failed for router ${router.id}: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * LOCAL counterpart of syncActivations: the VPS cannot reach a router on a
   * private LAN, so the mobile app reads `/ip/hotspot/active` itself and posts
   * it here. Without this, a free (LOCAL) operator's revenue, clients and
   * per-plan breakdown stay at zero forever.
   */
  async syncFromLan(routerId: string, active: LiveSession[]) {
    const router = await this.getRouter(routerId);
    if (router.mode === ManagementMode.REMOTE) {
      throw new BadRequestException(
        'Routeur distant : les sessions sont synchronisées par le serveur',
      );
    }
    await this.reconcileActive(routerId, router.tenantId, active);
    return { synced: active.length };
  }

  /**
   * Live list of everyone connected to the hotspot (not just mikrolan codes).
   * REMOTE routers are read over the tunnel; LOCAL (free) routers are read by
   * the mobile app directly over the LAN.
   */
  async live(routerId: string): Promise<LiveSession[]> {
    const router = await this.getRouter(routerId);
    if (router.mode === ManagementMode.REMOTE) {
      const active = await this.remote.run(routerId, (c) => listActive(c));
      return active.map(mapActive);
    }
    // LOCAL : le serveur ne peut pas interroger le routeur directement.
    // On renvoie les sessions ACTIVE synchronisées par le mobile via /sync.
    const rows = await this.prisma.session.findMany({
      where: { routerId, status: SessionStatus.ACTIVE },
      select: {
        mikrotikId: true,
        ipAddress: true,
        macAddress: true,
        bytesIn: true,
        bytesOut: true,
        startedAt: true,
        voucher: { select: { code: true } },
      },
    });
    return rows.map((r) => ({
      id: r.mikrotikId ?? '',
      user: r.voucher.code,
      ipAddress: r.ipAddress,
      macAddress: r.macAddress,
      bytesIn: String(r.bytesIn ?? 0),
      bytesOut: String(r.bytesOut ?? 0),
      uptime: r.startedAt
        ? `${Math.round((Date.now() - r.startedAt.getTime()) / 1000)}s`
        : null,
    }));
  }

  async terminate(routerId: string, mikrotikId: string) {
    const router = await this.getRouter(routerId);
    if (router.mode !== ManagementMode.REMOTE) {
      throw new BadRequestException(
        'Routeur local : déconnexion via le LAN',
      );
    }
    await this.remote.run(routerId, (c) => removeActive(c, mikrotikId));

    // Close the DB row too, otherwise the session stays ACTIVE forever and the
    // "sessions actives" counter never comes back down.
    await this.prisma.session.updateMany({
      where: { routerId, mikrotikId, status: SessionStatus.ACTIVE },
      data: { status: SessionStatus.TERMINATED, terminatedAt: new Date() },
    });
    return { terminated: true };
  }

  private async getRouter(routerId: string) {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true, mode: true, tenantId: true },
    });
    if (!router) throw new NotFoundException('Routeur introuvable — il a peut-être été supprimé.');
    return router;
  }
}
