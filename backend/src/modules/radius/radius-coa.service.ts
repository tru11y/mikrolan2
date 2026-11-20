import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { SessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config/configuration';

/** Port standard CoA / Disconnect-Messages (RFC 5176). */
const COA_PORT = 3799;
/** Budget d'un `radclient` par NAS : au-delà le NAS est considéré injoignable. */
const RADCLIENT_TIMEOUT_MS = 5_000;

/**
 * Change-of-Authorization : déconnexion active d'un voucher sur TOUS les NAS où
 * il a une session ouverte (quota partagé épuisé). Best-effort par NAS — un NAS
 * injoignable n'empêche pas les autres (log-and-continue). Désactivé par défaut
 * (`RADIUS_COA_ENABLED=false`) : no-op loggé tant que l'infra radclient n'est pas
 * déployée.
 */
@Injectable()
export class RadiusCoaService {
  private readonly logger = new Logger(RadiusCoaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get enabled(): boolean {
    return this.config.get('RADIUS_COA_ENABLED', { infer: true });
  }

  async disconnectVoucherEverywhere(voucherId: string): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: { voucherId, status: SessionStatus.ACTIVE },
      select: {
        acctSessionId: true,
        nasIdentifier: true,
        voucher: { select: { code: true } },
        router: {
          select: {
            localAddress: true,
            remotePeer: { select: { wgIp: true } },
          },
        },
      },
    });
    if (sessions.length === 0) return;

    if (!this.enabled) {
      this.logger.log(
        `CoA disabled (RADIUS_COA_ENABLED=false) — skip disconnect voucherId=${voucherId} nasCount=${sessions.length}`,
      );
      return;
    }
    const secret = this.config.get('RADIUS_COA_SECRET', { infer: true });
    if (!secret) {
      this.logger.warn(`CoA enabled but RADIUS_COA_SECRET empty — skip voucherId=${voucherId}`);
      return;
    }

    for (const session of sessions) {
      const nasIp = session.router.remotePeer?.wgIp ?? hostOf(session.router.localAddress);
      if (!nasIp) {
        this.logger.warn(`CoA no NAS address for voucherId=${voucherId} — skip one session`);
        continue;
      }
      const attrs = [
        `User-Name="${session.voucher.code}"`,
        ...(session.acctSessionId ? [`Acct-Session-Id="${session.acctSessionId}"`] : []),
      ].join(',');
      try {
        await this.radclient(nasIp, secret, attrs);
        this.logger.log(`CoA disconnect sent voucherId=${voucherId} nas=${nasIp}`);
      } catch (err) {
        // Best-effort : on continue sur les autres NAS.
        this.logger.warn(
          `CoA disconnect failed voucherId=${voucherId} nas=${nasIp}: ${(err as Error).message}`,
        );
      }
    }
  }

  private radclient(nasIp: string, secret: string, attrs: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = execFile(
        'radclient',
        ['-x', '-t', '2', '-r', '1', `${nasIp}:${COA_PORT}`, 'disconnect', secret],
        { timeout: RADCLIENT_TIMEOUT_MS },
        (err) => (err ? reject(err) : resolve()),
      );
      child.stdin?.end(`${attrs}\n`);
    });
  }
}

/** "IP:port" (localAddress LAN) → "IP". */
function hostOf(localAddress: string | null): string | null {
  if (!localAddress) return null;
  const host = localAddress.split(':')[0];
  return host.length > 0 ? host : null;
}
