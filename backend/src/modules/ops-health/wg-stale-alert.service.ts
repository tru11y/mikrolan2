import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { RemotePeerStatus, UserRole, UserStatus, WgAlertAttemptStatus, WgAlertChannel, type WgAlertType } from '@prisma/client';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { WireGuardService } from '../../common/wireguard/wireguard.service';
import { MailService, type MailSendResult } from '../mail/mail.service';
import { NotificationsService, type PushSendSummary } from '../notifications/notifications.service';
import { combineEmailResults, deliveryEntityRef } from './wg-alert-delivery';
import { WG_ALERT_MAX_ATTEMPTS, WgAlertEpisodeService, type AttemptRecord, type CompletedAttempt } from './wg-alert-episode.service';
import { WG_HANDSHAKE_WRITE_MIN_MS, classifyWgStale, formatAge } from './wg-stale.logic';

type DueEpisode = Awaited<ReturnType<WgAlertEpisodeService['findDue']>>[number];

interface EmailOutcome {
  status: ReturnType<typeof combineEmailResults>['status'];
  failureCodes: string[];
  recipientCount: number;
}

/**
 * Alerte « tunnel injoignable depuis 24 h », avec preuve durable d'acceptation par un fournisseur.
 *
 * Un épisode (WgAlertEpisode) naît à la détection et vit jusqu'au retour d'un handshake sain. Tentatives :
 * T0 (immédiate), T0 + 1 h, puis + 6 h après la deuxième (≈ T0 + 7 h), jamais plus. Un épisode accepté, épuisé ou
 * résolu n'est jamais relancé. « Accepté » = SMTP ou Expo a accepté le message : ni remise, ni affichage, ni lecture.
 * Pas de rappel à 24 h tant qu'un épisode non résolu existe (EXHAUSTED reste visible en RED jusqu'à résolution).
 *
 * Le handshake n'existe qu'en live (`wg`) : le cron le persiste pour mesurer la durée d'inactivité.
 * Si `wg` est illisible, on n'alerte pas (état inconnu ≠ tunnel mort).
 * `RemotePeer.staleAlertedAt` est conservé pour compatibilité : posé à l'ouverture, remis à NULL à la résolution.
 *
 * DÉCISION (11/11/2026) : pas de file BullMQ ni de réparation automatique ; le Resync admin ne peut rien contre
 * un tunnel mort (cause côté routeur). La réponse utile est l'alerte, puis l'intervention humaine.
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
    private readonly episodes: WgAlertEpisodeService,
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
      },
    });

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
        // Résolution : épisodes clos (plus aucun retry), compatibilité staleAlertedAt remise à NULL.
        const hadAlert = p.staleAlertedAt !== null;
        const closed = await this.episodes.resolvePeer(p.id, nowMs);
        if (hadAlert) await this.prisma.remotePeer.update({ where: { id: p.id }, data: { staleAlertedAt: null } });
        if (closed > 0 || hadAlert) {
          this.logger.log({ event: 'WG_STALE_RESOLVED', peerRef: deliveryEntityRef(p.id), episodesClosed: closed });
          resolved++;
        }
        continue;
      }

      if (await this.episodes.hasActive(p.id)) continue;
      // Ancien `staleAlertedAt` sans épisode : on reconstitue un épisode dont l'acceptation passée est INCONNUE.
      const legacy = p.staleAlertedAt !== null;
      const opened = await this.episodes.open({ id: p.id, tenantId: p.tenantId }, verdict.state, legacy ? p.staleAlertedAt! : new Date(nowMs), nowMs, legacy);
      if (opened && !legacy) await this.prisma.remotePeer.update({ where: { id: p.id }, data: { staleAlertedAt: new Date(nowMs) } });
    }

    const alerted = await this.processDue(nowMs);
    return { alerted, resolved };
  }

  /** Exécute les tentatives dues. Retourne le nombre de premières tentatives exécutées. */
  private async processDue(nowMs: number): Promise<number> {
    let firstAttempts = 0;
    for (const ep of await this.episodes.findDue(nowMs)) {
      try {
        if (await this.runEpisode(ep, nowMs)) firstAttempts++;
      } catch (err) {
        // Le claim expirera : la tentative sera reprise (aucun résultat n'a été écrit).
        this.logger.error({ errorCode: 'WG_ALERT_ATTEMPT_ERROR', episodeRef: deliveryEntityRef(ep.id), error: err instanceof Error ? err.constructor.name : 'error' });
      }
    }
    return firstAttempts;
  }

  private async runEpisode(ep: DueEpisode, nowMs: number): Promise<boolean> {
    const peer = ep.remotePeer;
    if (peer.status !== RemotePeerStatus.ACTIVE || peer.router.deletedAt) {
      await this.episodes.resolvePeer(ep.remotePeerId, nowMs);
      return false;
    }
    const verdict = classifyWgStale({ lastHandshakeAt: peer.lastHandshakeAt, provisionedAt: peer.provisionedAt, createdAt: peer.createdAt }, nowMs);
    if (verdict.state === 'OK') {
      await this.episodes.resolvePeer(ep.remotePeerId, nowMs);
      return false;
    }
    if (!(await this.episodes.claim(ep.id, ep.attemptCount, nowMs))) return false;

    const name = peer.router.alias ?? peer.router.identity;
    const age = formatAge(verdict.ageMs);
    const detail =
      ep.alertType === 'NEVER_CONNECTED'
        ? `Le routeur ${name} ne s'est jamais connecté au tunnel depuis sa mise en service (${age}). Configuration WireGuard non poussée ou clés divergentes ?`
        : `Le routeur ${name} n'a pas de handshake WireGuard depuis ${age} (éteint, WAN coupé ou UDP bloqué ?).`;

    // Appels fournisseurs HORS transaction et hors verrou SQL.
    const email = await this.deliverEmail(detail);
    const push = await this.deliverPush(ep.tenantId, peer.routerId, name, age);
    const record = this.toRecord(email, push);
    const done = await this.episodes.complete(ep.id, ep.attemptCount, record, nowMs);
    if (!done.saved) return false;

    this.report(ep, record, email, push, done);
    return done.attemptNumber === 1;
  }

  private toRecord(email: EmailOutcome, push: PushSendSummary): AttemptRecord {
    const emailStatus: WgAlertAttemptStatus =
      email.status === 'SENT'
        ? WgAlertAttemptStatus.PROVIDER_ACCEPTED
        : email.status === 'NO_RECIPIENT'
          ? WgAlertAttemptStatus.NO_RECIPIENT
          : email.status === 'NOT_CONFIGURED'
            ? WgAlertAttemptStatus.NOT_CONFIGURED
            : email.failureCodes.includes('TIMEOUT')
              ? WgAlertAttemptStatus.TIMEOUT
              : WgAlertAttemptStatus.PROVIDER_FAILED;
    const pushStatus: WgAlertAttemptStatus =
      push.status === 'SENT'
        ? WgAlertAttemptStatus.PROVIDER_ACCEPTED
        : push.status === 'NO_TOKEN'
          ? WgAlertAttemptStatus.NO_TOKEN
          : push.status === 'DISABLED'
            ? WgAlertAttemptStatus.DISABLED
            : push.status === 'INVALID_TOKEN'
              ? WgAlertAttemptStatus.INVALID_TOKEN
              : push.failureCode === 'TIMEOUT'
                ? WgAlertAttemptStatus.TIMEOUT
                : WgAlertAttemptStatus.PROVIDER_FAILED;
    const failed = (s: WgAlertAttemptStatus) => s === WgAlertAttemptStatus.PROVIDER_FAILED || s === WgAlertAttemptStatus.TIMEOUT || s === WgAlertAttemptStatus.INVALID_TOKEN;
    return {
      emailStatus: email.status,
      pushStatus: push.status,
      channels: [
        { channel: WgAlertChannel.EMAIL, status: emailStatus, failureCode: failed(emailStatus) ? (email.failureCodes[0] ?? null) : null, recipientCount: email.recipientCount },
        { channel: WgAlertChannel.PUSH, status: pushStatus, failureCode: failed(pushStatus) ? (push.failureCode ?? null) : null, recipientCount: push.tokensFound },
      ],
    };
  }

  /** ALERT_EMAIL si configuré, sinon SUPER_ADMIN actifs (adresses dédupliquées), sinon NO_RECIPIENT. */
  private async deliverEmail(detail: string): Promise<EmailOutcome> {
    try {
      const recipients = await this.resolveEmailRecipients();
      const results: MailSendResult[] = [];
      for (const to of recipients) results.push(await this.mail.sendAlert(to, 'Tunnel WireGuard injoignable', detail));
      return { ...combineEmailResults(results), recipientCount: recipients.length };
    } catch (e) {
      this.logger.warn(`Mail alert failed: ${e instanceof Error ? e.constructor.name : 'error'}`);
      return { status: 'FAILED', failureCodes: ['EMAIL_EXCEPTION'], recipientCount: 0 };
    }
  }

  private async resolveEmailRecipients(): Promise<string[]> {
    const explicit = this.config.get('ALERT_EMAIL', { infer: true })?.trim();
    if (explicit) return [explicit];
    const admins = await this.prisma.user.findMany({
      where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE, deletedAt: null, anonymizedAt: null, email: { not: '' } },
      select: { email: true },
    });
    const byLower = new Map<string, string>();
    for (const a of admins) {
      const e = a.email?.trim();
      if (e && !byLower.has(e.toLowerCase())) byLower.set(e.toLowerCase(), e);
    }
    return [...byLower.values()];
  }

  /** Push OWNER/ADMIN actifs du tenant, un seul appel (tokens dédupliqués et invalidation limitée au tenant côté NotificationsService). */
  private async deliverPush(tenantId: string, routerId: string, name: string, age: string): Promise<PushSendSummary> {
    try {
      return await this.notifications.sendPushToTenant(
        tenantId,
        'Routeur injoignable',
        `Le routeur ${name} est injoignable depuis ${age}.`,
        routerId,
        undefined,
        [UserRole.OWNER, UserRole.ADMIN],
      );
    } catch (e) {
      this.logger.warn(`Push alert failed: ${e instanceof Error ? e.constructor.name : 'error'}`);
      return { status: 'FAILED', tokensFound: 0, accepted: 0, invalid: 0, failureCode: 'PUSH_EXCEPTION' };
    }
  }

  /**
   * Un seul point de décision, APRÈS les canaux et l'écriture du résultat. Références pseudonymisées, statuts et
   * codes uniquement : ni adresse, ni token, ni identifiant brut, ni nom de routeur.
   */
  private report(ep: DueEpisode, record: AttemptRecord, email: EmailOutcome, push: PushSendSummary, done: CompletedAttempt): void {
    const failureCodes = [...new Set([...email.failureCodes, ...(push.failureCode ? [push.failureCode] : [])])];
    const fields = {
      episodeRef: deliveryEntityRef(ep.id),
      tenantRef: deliveryEntityRef(ep.tenantId),
      peerRef: deliveryEntityRef(ep.remotePeerId),
      alertType: ep.alertType as WgAlertType,
      attemptNumber: done.attemptNumber,
      emailStatus: record.emailStatus,
      pushStatus: record.pushStatus,
      failureCodes,
    };
    if (done.providerAccepted) {
      this.logger.log({ event: 'WG_ALERT_PROVIDER_ACCEPTED', ...fields });
      const failedStatuses: WgAlertAttemptStatus[] = [WgAlertAttemptStatus.PROVIDER_FAILED, WgAlertAttemptStatus.TIMEOUT, WgAlertAttemptStatus.INVALID_TOKEN];
      if (record.channels.some((c) => failedStatuses.includes(c.status))) {
        this.logger.warn({ event: 'WG_ALERT_PROVIDER_DEGRADED', ...fields });
        this.breadcrumb('WG_ALERT_PROVIDER_DEGRADED', fields);
      }
      return;
    }

    if (done.exhausted) {
      this.logger.error({ errorCode: 'WG_ALERT_DELIVERY_EXHAUSTED', ...fields, maxAttempts: WG_ALERT_MAX_ATTEMPTS });
      this.capture('WG_ALERT_DELIVERY_EXHAUSTED', fields);
      return;
    }
    if (done.attemptNumber === 1) {
      this.logger.error({ errorCode: 'WG_ALERT_UNDELIVERED', ...fields, nextAttemptAt: done.nextAttemptAt?.toISOString() });
      this.capture('WG_ALERT_UNDELIVERED', fields);
      return;
    }
    this.logger.warn({ event: 'WG_ALERT_RETRY_SCHEDULED', ...fields, nextAttemptAt: done.nextAttemptAt?.toISOString() });
  }

  private capture(code: string, f: Record<string, unknown>): void {
    try {
      Sentry.captureMessage(code, {
        level: 'error',
        tags: { errorCode: code, domain: 'wireguard', alertType: String(f.alertType), emailStatus: String(f.emailStatus), pushStatus: String(f.pushStatus) },
        extra: { episodeRef: f.episodeRef, tenantRef: f.tenantRef, peerRef: f.peerRef, attemptNumber: f.attemptNumber, failureCodes: f.failureCodes },
      });
    } catch (e) {
      this.logger.warn(`Sentry report failed: ${e instanceof Error ? e.constructor.name : 'error'}`);
    }
  }

  private breadcrumb(message: string, data: Record<string, unknown>): void {
    try {
      Sentry.addBreadcrumb({ category: 'wireguard', level: 'warning', message, data });
    } catch (e) {
      this.logger.warn(`Sentry breadcrumb failed: ${e instanceof Error ? e.constructor.name : 'error'}`);
    }
  }
}
