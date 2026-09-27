import { logAndContinue } from '../../common/utils/log-and-continue';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { RouterHealth } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RouterGatewayService } from '../router-gateway/router-gateway.service';
import { tenantStore, setTenantContext } from '../../common/context/tenant-context';
import { UserRole } from '@prisma/client';
import {
  RouterOsApiError,
  withRouterOsApi,
  type ApiRow,
  type RouterOsApiClient,
} from '../../common/routeros/routeros-api.client';

const ROUTEROS_API_PORT = 8728;
// Par commande. Mesuré sur un RB951 chargé : 0,5-35 s par commande ; 10 s faisait
// échouer la collecte de ce type de routeur.
const TIMEOUT_MS = 30_000;
const CONCURRENCY = 5;
const RETENTION_DAYS = 30;

// Lectures minimales : uniquement les champs stockés dans RouterTelemetry.
const RESOURCE_CMD = [
  '/system/resource/print',
  '=.proplist=cpu-load,total-memory,free-memory,uptime,version,board-name',
];
// Réponse d'une ligne `ret=<n>` au lieu d'une ligne par client connecté.
const HOTSPOT_COUNT_CMD = ['/ip/hotspot/active/print', '=count-only='];
// Le journal d'erreurs n'est affiché nulle part dans Fleet (le mobile ne lit que
// cpu/uptime) et son parcours est la lecture la plus coûteuse : désactivé par défaut.
const COLLECT_ERROR_LOG = process.env['TELEMETRY_COLLECT_ERRORS'] === '1';
const ERROR_LOG_CMD = ['/log/print', '?topics~error', '=.proplist=time,message'];
// P0 Realtime Router — Phase 1. OFF par défaut : comportement actuel inchangé.
const GATEWAY_ENABLED = () => process.env['ROUTER_GATEWAY_ENABLED'] === 'true';
// Une collecte toutes les 15 min tolère une donnée bien plus âgée que le seuil
// « frais » de l'UI (8-10 s) : accepter le cache évite de forcer un refresh
// RouterOS à chaque tick alors qu'un écran vient peut-être d'en obtenir un.
const TELEMETRY_ACCEPT_AGE_MS = 5 * 60_000;

/** Nombre de clients : `ret` d'un count-only, sinon nombre de lignes reçues. */
function countFrom(rows: ApiRow[] | null): number | null {
  if (!rows) return null;
  const ret = rows[0]?.['ret'];
  if (ret !== undefined) {
    const n = parseInt(ret, 10);
    return Number.isNaN(n) ? null : n;
  }
  return rows.length;
}

interface TelemetrySnapshot {
  routerId: string;
  cpuPercent: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  uptime: string | null;
  rosVersion: string | null;
  boardName: string | null;
  hotspotActive: number | null;
  lastErrors: Array<{ time: string; message: string }> | null;
  health: RouterHealth;
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Optional() private readonly gateway?: RouterGatewayService,
  ) {}

  async collectAll(): Promise<void> {
    const peers = await this.prisma.remotePeer.findMany({
      where: { status: 'ACTIVE' },
      select: {
        routerId: true,
        wgIp: true,
        router: {
          select: { id: true, tenantId: true, credEncrypted: true, deletedAt: true },
        },
      },
    });

    const active = peers.filter(
      (p) => p.router.credEncrypted && !p.router.deletedAt,
    );

    const chunks: typeof active[] = [];
    for (let i = 0; i < active.length; i += CONCURRENCY) {
      chunks.push(active.slice(i, i + CONCURRENCY));
    }

    const now = new Date();
    for (const chunk of chunks) {
      await Promise.allSettled(
        chunk.map((peer) =>
          this.collectOne(peer.routerId, peer.router.tenantId, peer.wgIp, peer.router.credEncrypted!, now),
        ),
      );
    }

    this.logger.log(`Telemetry collected for ${active.length} routers`);
  }

  private async collectOne(
    routerId: string,
    tenantId: string,
    wgIp: string,
    credEncrypted: string,
    collectedAt: Date,
  ): Promise<void> {
    try {
      // P0 Realtime Router — Phase 1 : sous flag, réutilise le snapshot mutualisé
      // du Gateway au lieu d'ouvrir sa propre connexion RouterOS. Le journal
      // d'erreurs (`lastErrors`) reste hors périmètre Phase 1 (le Gateway ne le
      // lit pas) : `null` dans ce chemin, comme lorsque `TELEMETRY_COLLECT_ERRORS`
      // est désactivé — sans effet observable puisqu'il l'est par défaut.
      //
      // Le cron ne pose aucun contexte tenant global : `RemoteRouterService.run()`
      // (utilisé par le Gateway) exige `getTenantContext()` pour vérifier
      // l'abonnement, sans quoi il rejette (`SUBSCRIPTION_INACTIVE`) — c'est
      // exactement le blocage constaté en production sous Gateway ON. Le contexte
      // est donc ouvert ICI, un scope isolé PAR ROUTEUR (jamais un scope partagé
      // pour tout le cron, qui ferait fuiter le tenant précédent vers le suivant
      // en cas d'exécution concurrente).
      if (GATEWAY_ENABLED() && this.gateway) {
        const gateway = this.gateway;
        const snap = await tenantStore.run({}, () => {
          setTenantContext({ tenantId, userId: 'system-telemetry', role: UserRole.OWNER });
          return gateway.getLiveSnapshot(routerId, 'stats', {
            priority: 'P3_TELEMETRY',
            minFreshnessMs: TELEMETRY_ACCEPT_AGE_MS,
          });
        });
        await this.prisma.routerTelemetry.create({
          data: {
            routerId,
            cpuPercent: snap.cpuPercent,
            ramUsedMb: snap.memoryUsedMb,
            ramTotalMb: snap.memoryTotalMb,
            uptime: snap.uptime,
            rosVersion: snap.rosVersion,
            boardName: snap.boardName,
            hotspotActive: snap.sessionCount,
            lastErrors: null as any,
            health: snap.health === 'OFFLINE' ? RouterHealth.OFFLINE : RouterHealth.ONLINE,
            collectedAt,
          },
        });
        return;
      }

      const creds = JSON.parse(this.crypto.decrypt(credEncrypted)) as {
        username: string;
        password: string;
      };

      const snapshot = await withRouterOsApi(
        {
          host: wgIp,
          port: ROUTEROS_API_PORT,
          username: creds.username,
          password: creds.password,
          timeoutMs: TIMEOUT_MS,
        },
        async (client) => {
          // 1 routeur = 1 connexion = 1 commande à la fois : le client API n'a
          // qu'une réponse « pending », lancer les lectures en parallèle sur la
          // même connexion les mélange (et bloquait la collecte pour toujours).
          const resources = await client.command(RESOURCE_CMD);
          const optional = this.optionalReader(client, routerId);
          const hotspot = await optional(HOTSPOT_COUNT_CMD, 'Hotspot active count');
          const logs = COLLECT_ERROR_LOG
            ? await optional(ERROR_LOG_CMD, 'Router log read')
            : null;

          const res = resources[0] ?? {};
          return this.parseSnapshot(routerId, res, hotspot, logs);
        },
      );

      await this.prisma.routerTelemetry.create({
        data: {
          routerId: snapshot.routerId,
          cpuPercent: snapshot.cpuPercent,
          ramUsedMb: snapshot.ramUsedMb,
          ramTotalMb: snapshot.ramTotalMb,
          uptime: snapshot.uptime,
          rosVersion: snapshot.rosVersion,
          boardName: snapshot.boardName,
          hotspotActive: snapshot.hotspotActive,
          lastErrors: snapshot.lastErrors as any,
          health: snapshot.health,
          collectedAt,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Telemetry failed for router ${routerId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Lecture facultative : un refus RouterOS (trap) est journalisé et la collecte
   * continue. Toute autre erreur (timeout, socket fermée) laisse la connexion dans
   * un état inconnu — une réponse tardive serait attribuée à la commande suivante —
   * donc les lectures restantes sont abandonnées.
   */
  private optionalReader(client: RouterOsApiClient, routerId: string) {
    let broken = false;
    return async (words: string[], what: string): Promise<ApiRow[] | null> => {
      if (broken) return null;
      try {
        return await client.command(words);
      } catch (err) {
        if (!(err instanceof RouterOsApiError)) broken = true;
        return logAndContinue<ApiRow[] | null>(
          this.logger,
          `${what} (router ${routerId})`,
          null,
        )(err);
      }
    };
  }

  private parseSnapshot(
    routerId: string,
    res: ApiRow,
    hotspot: ApiRow[] | null,
    logs: ApiRow[] | null,
  ): TelemetrySnapshot {
    const totalMem = res['total-memory']
      ? Math.round(parseInt(res['total-memory'], 10) / 1048576)
      : null;
    const freeMem = res['free-memory']
      ? Math.round(parseInt(res['free-memory'], 10) / 1048576)
      : null;

    return {
      routerId,
      cpuPercent: res['cpu-load'] ? parseInt(res['cpu-load'], 10) : null,
      ramUsedMb: totalMem !== null && freeMem !== null ? totalMem - freeMem : null,
      ramTotalMb: totalMem,
      uptime: res['uptime'] ?? null,
      rosVersion: res['version'] ?? null,
      boardName: res['board-name'] ?? null,
      hotspotActive: countFrom(hotspot),
      lastErrors: logs
        ? logs.slice(-20).map((l) => ({
            time: l['time'] ?? '',
            message: l['message'] ?? '',
          }))
        : null,
      health: RouterHealth.ONLINE,
    };
  }

  async cleanup(): Promise<number> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    const { count } = await this.prisma.routerTelemetry.deleteMany({
      where: { collectedAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} telemetry rows older than ${RETENTION_DAYS}d`);
    }
    return count;
  }

  async getLatestByRouter(routerId: string) {
    return this.prisma.routerTelemetry.findFirst({
      where: { routerId },
      orderBy: { collectedAt: 'desc' },
    });
  }

  async getHistory(routerId: string, hours = 24) {
    const since = new Date(Date.now() - hours * 3_600_000);
    return this.prisma.routerTelemetry.findMany({
      where: { routerId, collectedAt: { gte: since } },
      orderBy: { collectedAt: 'asc' },
    });
  }
}
