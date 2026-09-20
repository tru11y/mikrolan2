import { Injectable, Logger } from '@nestjs/common';
import { RouterHealth } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  withRouterOsApi,
  type ApiRow,
} from '../../common/routeros/routeros-api.client';

const ROUTEROS_API_PORT = 8728;
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 5;
const RETENTION_DAYS = 30;

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
  ) {}

  async collectAll(): Promise<void> {
    const peers = await this.prisma.remotePeer.findMany({
      where: { status: 'ACTIVE' },
      select: {
        routerId: true,
        wgIp: true,
        router: {
          select: { id: true, credEncrypted: true, deletedAt: true },
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
          this.collectOne(peer.routerId, peer.wgIp, peer.router.credEncrypted!, now),
        ),
      );
    }

    this.logger.log(`Telemetry collected for ${active.length} routers`);
  }

  private async collectOne(
    routerId: string,
    wgIp: string,
    credEncrypted: string,
    collectedAt: Date,
  ): Promise<void> {
    try {
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
          const [resources, hotspot, logs] = await Promise.all([
            client.command(['/system/resource/print']),
            client.command(['/ip/hotspot/active/print']).catch(() => [] as ApiRow[]),
            client
              .command(['/log/print', '?topics~error', '=.proplist=time,message'])
              .catch(() => [] as ApiRow[]),
          ]);

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

  private parseSnapshot(
    routerId: string,
    res: ApiRow,
    hotspot: ApiRow[],
    logs: ApiRow[],
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
      hotspotActive: hotspot.length,
      lastErrors: logs.slice(-20).map((l) => ({
        time: l['time'] ?? '',
        message: l['message'] ?? '',
      })),
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
