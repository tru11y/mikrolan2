import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { Interval } from '@nestjs/schedule';
import {
  ManagementMode,
  NotificationType,
  RemotePeerStatus,
  RouterHealth,
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
import { withDeadline } from '../../common/utils/with-deadline';
import { RouterGatewayService } from '../router-gateway/router-gateway.service';
import { RouterSyncScheduler, type SchedulerRouter } from './router-sync-scheduler';
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

// Pire cas légitime d'une lecture : 2 essais × (connexion + login + commande,
// 12 s chacun) + 2 s d'attente. Au-delà le travail est considéré bloqué.
const SYNC_ROUTER_DEADLINE_MS = 90_000;
// Handshake WireGuard considéré périmé (aligné sur le seuil de 150 s du réconciliateur).
const TUNNEL_STALE_MS = 150_000;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private syncTickStartedAt: number | null = null;
  private readonly syncRoutersInFlight = new Set<string>();
  private readonly scheduler = new RouterSyncScheduler({
    now: () => Date.now(),
    listRouters: () => this.listSchedulableRouters(),
    run: (router) => this.syncRouter(router),
    log: (line) => this.logger.log(line),
    warn: (line) => this.logger.warn(line),
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly gateway?: RouterGatewayService,
  ) {}

  /** P0 Realtime Router — Phase 1. OFF par défaut : comportement actuel inchangé. */
  private gatewayEnabled(): boolean {
    return process.env['ROUTER_GATEWAY_ENABLED'] === 'true';
  }

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
        plan: { select: { priceXof: true } },
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
        // Revenue snapshot, figé une seule fois ici — jamais recalculé si le
        // forfait change de prix ensuite (audit/51, audit/52). Le prix vient
        // uniquement de Plan.priceXof lu côté serveur, jamais du client.
        const price = voucher.plan.priceXof;
        const priceValid = Number.isInteger(price) && price > 0;
        if (!priceValid) {
          this.logger.warn(
            'Activation avec prix de forfait non exploitable — snapshot non écrit (priceSnapshotSource=UNKNOWN).',
          );
        }
        const promoted = await this.prisma.voucher.updateMany({
          where: { id: voucher.id, status: VoucherStatus.GENERATED },
          data: {
            status: VoucherStatus.ACTIVE,
            usedAt: now,
            priceXofAtActivation: priceValid ? price : null,
            priceSnapshotSource: priceValid ? 'EXACT' : 'UNKNOWN',
          },
        });
        if (promoted.count === 0) continue; // another tick got there first
      }

      await this.prisma.session.create({
        data: { tenantId, voucherId: voucher.id, routerId, ...seen },
      });

      if (firstSight) {
        const title = 'Ticket activé';
        const body = `Le ticket ${voucher.code} vient de se connecter au hotspot.`;
        const notification = await this.prisma.notification.create({
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
          data: { notificationId: notification.id, voucherId: voucher.id, routerId, code: voucher.code },
        });
        this.notifications.sendPushToTenant(tenantId, title, body, routerId, {
          notificationId: notification.id,
          type: NotificationType.VOUCHER_ACTIVATED,
        });
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
    // SYNC_SCHEDULER=legacy : comportement historique (un tick séquentiel sur
    // toute la flotte). Par défaut, l'ordonnanceur par routeur ci-dessous.
    if (!this.legacySync()) return;
    // `@Interval` ne tient pas compte de la durée du tick précédent : sur un
    // routeur lent un tick dépasse 25 s et le suivant démarrerait par-dessus,
    // multipliant les sessions API simultanées sur un petit MikroTik.
    if (this.syncTickStartedAt !== null) {
      this.logger.warn(
        `sync tick SKIPPED_ALREADY_RUNNING runningForMs=${Date.now() - this.syncTickStartedAt}`,
      );
      return;
    }
    const tickStart = Date.now();
    this.syncTickStartedAt = tickStart;
    try {
      const routers = await this.prisma.router.findMany({
        where: { mode: ManagementMode.REMOTE, deletedAt: null },
        select: { id: true, tenantId: true },
      });
      this.logger.log(`sync tick START routers=${routers.length}`);

      const tally = { ok: 0, failed: 0, skipped: 0 };
      for (const router of routers) {
        tally[await this.syncRouter(router)] += 1;
      }
      this.logger.log(
        `sync tick END routers=${routers.length} ok=${tally.ok} failed=${tally.failed} skipped=${tally.skipped} durationMs=${Date.now() - tickStart}`,
      );
    } finally {
      this.syncTickStartedAt = null;
    }
  }

  /**
   * Ordonnanceur par routeur : le dispatcheur (5 s) lance les routeurs dus dans un
   * pool borné. Chaque lecture est exactement `syncRouter` : seule la cadence et
   * la concurrence changent.
   */
  @Interval(5_000)
  async dispatchSync(): Promise<void> {
    if (this.legacySync()) return;
    await this.scheduler.dispatch();
  }

  private legacySync(): boolean {
    return process.env['SYNC_SCHEDULER'] === 'legacy';
  }

  private async listSchedulableRouters(): Promise<SchedulerRouter[]> {
    const rows = await this.prisma.router.findMany({
      where: { mode: ManagementMode.REMOTE, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        health: true,
        lastHeartbeat: true,
        credEncrypted: true,
        remotePeer: { select: { status: true } },
      },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      hasCredentials: Boolean(r.credEncrypted),
      hasActivePeer: r.remotePeer?.status === RemotePeerStatus.ACTIVE,
      // Le réconciliateur WireGuard passe le routeur OFFLINE quand le handshake
      // dépasse 150 s ; on ne fait que lire cet état.
      tunnelDown:
        r.health === RouterHealth.OFFLINE &&
        (r.lastHeartbeat === null || now - r.lastHeartbeat.getTime() > TUNNEL_STALE_MS),
    }));
  }

  /**
   * Réutilise la liste déjà lue pour le CA (aucune lecture en plus). Best effort : une erreur
   * ici ne doit JAMAIS faire échouer syncActivations ni entrer dans le résultat CA.
   */
  private publishLive(routerId: string, active: ApiRow[]): void {
    try {
      this.gateway?.publishSessions(routerId, active);
    } catch (e) {
      this.logger.warn(`live publish failed routerId=${routerId}: ${(e as Error).message}`);
    }
  }

  private noteLiveReadFailure(routerId: string, err: unknown): void {
    try {
      this.gateway?.noteSyncReadFailure(routerId, err);
    } catch (e) {
      this.logger.warn(`live failure note failed routerId=${routerId}: ${(e as Error).message}`);
    }
  }

  /** Une seule lecture RouterOS en cours par routeur ; le verrou est toujours libéré. */
  private async syncRouter(router: {
    id: string;
    tenantId: string;
  }): Promise<'ok' | 'failed' | 'skipped'> {
    if (this.syncRoutersInFlight.has(router.id)) {
      this.logger.warn(`sync router SKIPPED_ALREADY_RUNNING routerId=${router.id}`);
      return 'skipped';
    }
    this.syncRoutersInFlight.add(router.id);
    const start = Date.now();
    this.logger.log(`sync router START routerId=${router.id}`);
    let status: 'ok' | 'failed' = 'ok';
    let routerRead = false;
    try {
      await withDeadline(
        tenantStore.run({}, async () => {
          setTenantContext({
            tenantId: router.tenantId,
            userId: 'system-activity-sync',
            role: UserRole.OWNER,
          });

          const active = await this.remote.run(
            router.id,
            (c) => listActive(c),
            { retries: 1 },
          );
          routerRead = true;
          await this.reconcileActive(
            router.id,
            router.tenantId,
            active.map(mapActive),
          );
          this.publishLive(router.id, active);
        }),
        SYNC_ROUTER_DEADLINE_MS,
        `Activation sync ${router.id}`,
      );
    } catch (e) {
      status = 'failed';
      this.logger.warn(
        `Activation sync failed for router ${router.id}: ${(e as Error).message}`,
      );
      if (!routerRead) this.noteLiveReadFailure(router.id, e);
    } finally {
      this.syncRoutersInFlight.delete(router.id);
      this.logger.log(
        `sync router END routerId=${router.id} status=${status} durationMs=${Date.now() - start}`,
      );
    }
    return status;
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
      throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.SESSION_DISCONNECT_FAILED, 'Routeur distant : les sessions sont synchronisées par le serveur');
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
      // P0 Realtime Router — Phase 1 (UI uniquement) : sous flag, mutualisée via
      // RouterGateway au lieu d'un `remote.run` indépendant par écran ouvert.
      // `syncActivations`/`syncRouter` ne passent JAMAIS par ici, quel que soit le flag.
      if (this.gatewayEnabled() && this.gateway) {
        const snapshot = await this.gateway.getLiveSnapshot(routerId, 'sessions');
        return snapshot.sessions ?? [];
      }
      const active = await this.remote.run(
        routerId,
        (c) => listActive(c),
        { retries: 1 },
      );
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
      throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.SESSION_DISCONNECT_FAILED, 'Routeur local : déconnexion via le LAN');
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
    if (!router) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.ROUTER_NOT_FOUND, 'Routeur introuvable — il a peut-être été supprimé.');
    return router;
  }
}
