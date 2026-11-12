import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { RemotePeerStatus } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  WG_HANDSHAKE_WRITE_MIN_MS,
  WG_STALE_AFTER_MS,
  classifyWgStale,
  formatAge,
  shouldAlert,
} from './wg-stale.logic';

/**
 * Alerte « tunnel injoignable depuis 24 h » : e-mail SUPER_ADMIN + Sentry + push au propriétaire du tenant.
 * Le handshake n'existe qu'en live (`wg`) : le cron le persiste pour mesurer la durée d'inactivité.
 * Si `wg` est illisible, on n'alerte pas (état inconnu ≠ tunnel mort).
 *
 * DÉCISION (11/11/2026, à ne pas rouvrir sans fait nouveau) : pas de file BullMQ « wg-repush » ni de
 * réparation automatique. Le Resync admin existant (`AdminWireGuardService.resync`) est déjà idempotent
 * (`wg set`, règles DNAT retirées avant ajout) et audité, mais il ne fait que ré-appliquer le peer côté
 * VPS : il ne peut rien contre un tunnel mort, dont la cause est du côté routeur (éteint, WAN coupé,
 * UDP bloqué, clés divergentes) et qu'on ne peut pas joindre sans tunnel. La clé privée WireGuard n'est
 * poussée que par l'app du propriétaire, sur le LAN. Une file de retries ne ferait que rejouer l'échec :
 * la réponse utile est l'alerte, puis l'intervention humaine (Resync manuel, Revoke, ou visite sur site).
 */
@Injectable()
export class WgStaleAlertService {
  private readonly logger = new Logger(WgStaleAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wg: WireGuardService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(): Promise<void> {
    try {
      await this.check(Date.now());
    } catch (err) {
      this.logger.error('WG stale check failed', err instanceof Error ? err.stack : String(err));
      Sentry.captureException(err);
    }
  }

  async check(nowMs: number): Promise<{ alerted: number; resolved: number }> {
    if (!this.wg.enabled) return { alerted: 0, resolved: 0 };
    let live: Awaited<ReturnType<WireGuardService['livePeers']>>;
    try {
      live = await this.wg.livePeers();
    } catch (err) {
      this.logger.warn(`wg dump failed, WG stale check skipped: ${err instanceof Error ? err.message : err}`);
      return { alerted: 0, resolved: 0 };
    }

    const peers = await this.prisma.remotePeer.findMany({
      where: { status: RemotePeerStatus.ACTIVE, router: { deletedAt: null } },
      select: {
        id: true,
        routerId: true,
        tenantId: true,
        wgPublicKey: true,
        lastHandshakeAt: true,
        provisionedAt: true,
        createdAt: true,
        staleAlertedAt: true,
        router: { select: { alias: true, identity: true } },
      },
    });

    let alerted = 0;
    let resolved = 0;
    for (const p of peers) {
      const hsS = live[p.wgPublicKey]?.latestHandshake ?? 0;
      const hs = hsS > 0 ? new Date(hsS * 1000) : null;
      let last = p.lastHandshakeAt;
      if (hs && (!last || hs.getTime() - last.getTime() >= WG_HANDSHAKE_WRITE_MIN_MS)) {
        last = hs;
        await this.prisma.remotePeer.update({ where: { id: p.id }, data: { lastHandshakeAt: hs } });
      }

      const verdict = classifyWgStale({ lastHandshakeAt: last, provisionedAt: p.provisionedAt, createdAt: p.createdAt }, nowMs);

      if (verdict.state === 'OK') {
        if (p.staleAlertedAt) {
          // Résolution automatique : le tunnel a repris, l'épisode est clos.
          await this.prisma.remotePeer.update({ where: { id: p.id }, data: { staleAlertedAt: null } });
          this.logger.log({ event: 'WG_STALE_RESOLVED', routerId: p.routerId });
          resolved++;
        }
        continue;
      }
      if (!shouldAlert(verdict.state, p.staleAlertedAt, nowMs)) continue;

      // Verrou atomique : si deux instances passent en même temps, une seule envoie.
      const threshold = new Date(nowMs - WG_STALE_AFTER_MS);
      const claim = await this.prisma.remotePeer.updateMany({
        where: { id: p.id, OR: [{ staleAlertedAt: null }, { staleAlertedAt: { lte: threshold } }] },
        data: { staleAlertedAt: new Date(nowMs) },
      });
      if (claim.count === 0) continue;

      await this.notify(p, verdict.state, verdict.ageMs);
      alerted++;
    }
    return { alerted, resolved };
  }

  private async notify(
    p: { routerId: string; tenantId: string; router: { alias: string | null; identity: string } },
    state: 'STALE_24H' | 'NEVER_CONNECTED',
    ageMs: number,
  ): Promise<void> {
    const name = p.router.alias ?? p.router.identity;
    const age = formatAge(ageMs);
    const detail =
      state === 'NEVER_CONNECTED'
        ? `Le routeur ${name} ne s'est jamais connecté au tunnel depuis sa mise en service (${age}). Configuration WireGuard non poussée ou clés divergentes ?`
        : `Le routeur ${name} n'a pas de handshake WireGuard depuis ${age} (éteint, WAN coupé ou UDP bloqué ?).`;
    this.logger.warn({ errorCode: 'WG_PEER_STALE', routerId: p.routerId, tenantId: p.tenantId, state, ageHours: Math.floor(ageMs / 3_600_000) });

    // Chaque canal est isolé : l'échec de l'un n'empêche pas les autres.
    try {
      Sentry.captureMessage(`WG_PEER_STALE: ${detail}`, {
        level: 'warning',
        tags: { errorCode: 'WG_PEER_STALE', domain: 'wireguard', state },
        extra: { routerId: p.routerId, tenantId: p.tenantId, ageMs },
      });
    } catch (e) {
      this.logger.warn(`Sentry alert failed: ${e instanceof Error ? e.message : e}`);
    }
    try {
      const to = this.config.get('ALERT_EMAIL', { infer: true });
      if (to) await this.mail.sendAlert(to, 'Tunnel WireGuard injoignable', detail);
    } catch (e) {
      this.logger.warn(`Mail alert failed: ${e instanceof Error ? e.message : e}`);
    }
    try {
      await this.notifications.sendPushToTenant(p.tenantId, 'Routeur injoignable', `Le routeur ${name} est injoignable depuis ${age}.`, p.routerId);
    } catch (e) {
      this.logger.warn(`Push alert failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
