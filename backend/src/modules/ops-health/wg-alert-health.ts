import { Injectable } from '@nestjs/common';
import { RemotePeerStatus, WgAlertAttemptStatus, WgAlertChannel, WgAlertEpisodeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { HealthLevel } from './ops-health.service';

const WINDOW_MS = 24 * 3_600_000;
const RED_AFTER_MS = 3_600_000;

/**
 * « Provider accepted » = SMTP ou Expo a accepté le message. Ni remise, ni affichage, ni lecture.
 * Tout est lu en base : un redémarrage ne perd rien et ne repasse jamais GREEN s'il reste un épisode non accepté.
 */
export interface WgAlertHealth {
  level: HealthLevel;
  persistence: 'DATABASE';
  resetOnRestart: false;
  deliveryProofDurable: true;
  windowHours: 24;
  message: string | null;
  wgAlertEpisodesOpen: number;
  wgAlertEpisodesProviderAccepted: number;
  wgAlertEpisodesExhausted: number;
  wgAlertEpisodesResolved24h: number;
  wgEmailProviderAccepted: number;
  wgPushProviderAccepted: number;
  /** Épisodes actifs (OPEN ou EXHAUSTED) pour lesquels aucun fournisseur n'a accepté. */
  wgNoProviderAccepted: number;
  wgNoRecipient: number;
  wgNoPushToken: number;
  wgInvalidPushToken: number;
  wgProviderFailures: number;
  wgRetryScheduled: number;
  wgRetryDue: number;
  wgOldestOpenAgeMs: number | null;
  /** Tentatives dont le claim a expiré sans résultat (processus mort ou bloqué). */
  wgStuckClaims: number;
  /** Anciens `staleAlertedAt` sans épisode durable : acceptation inconnue (jamais présumée). */
  wgAcceptanceUnknownLegacy: number;
}

@Injectable()
export class WgAlertHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(nowMs: number = Date.now()): Promise<WgAlertHealth> {
    const now = new Date(nowMs);
    const since = new Date(nowMs - WINDOW_MS);
    const E = this.prisma.wgAlertEpisode;
    const A = this.prisma.wgAlertDeliveryAttempt;
    const attempts = (channel: WgAlertChannel, status: WgAlertAttemptStatus | WgAlertAttemptStatus[]) =>
      A.count({
        where: {
          attemptedAt: { gte: since },
          channel,
          status: Array.isArray(status) ? { in: status } : status,
        },
      });

    const [
      open,
      accepted,
      exhausted,
      resolved24h,
      emailAccepted,
      pushAccepted,
      noRecipient,
      noToken,
      invalidToken,
      failuresEmail,
      failuresPush,
      scheduled,
      due,
      oldest,
      stuck,
      legacy,
    ] = await Promise.all([
      E.count({ where: { status: WgAlertEpisodeStatus.OPEN } }),
      E.count({ where: { status: WgAlertEpisodeStatus.PROVIDER_ACCEPTED } }),
      E.count({ where: { status: WgAlertEpisodeStatus.EXHAUSTED } }),
      E.count({ where: { status: WgAlertEpisodeStatus.RESOLVED, resolvedAt: { gte: since } } }),
      attempts(WgAlertChannel.EMAIL, WgAlertAttemptStatus.PROVIDER_ACCEPTED),
      attempts(WgAlertChannel.PUSH, WgAlertAttemptStatus.PROVIDER_ACCEPTED),
      attempts(WgAlertChannel.EMAIL, WgAlertAttemptStatus.NO_RECIPIENT),
      attempts(WgAlertChannel.PUSH, WgAlertAttemptStatus.NO_TOKEN),
      attempts(WgAlertChannel.PUSH, WgAlertAttemptStatus.INVALID_TOKEN),
      attempts(WgAlertChannel.EMAIL, [WgAlertAttemptStatus.PROVIDER_FAILED, WgAlertAttemptStatus.TIMEOUT]),
      attempts(WgAlertChannel.PUSH, [WgAlertAttemptStatus.PROVIDER_FAILED, WgAlertAttemptStatus.TIMEOUT]),
      E.count({ where: { status: WgAlertEpisodeStatus.OPEN, nextAttemptAt: { gt: now } } }),
      E.count({ where: { status: WgAlertEpisodeStatus.OPEN, nextAttemptAt: { lte: now } } }),
      E.findFirst({ where: { status: WgAlertEpisodeStatus.OPEN }, orderBy: { detectedAt: 'asc' }, select: { detectedAt: true } }),
      E.count({ where: { status: WgAlertEpisodeStatus.OPEN, claimExpiresAt: { lte: now } } }),
      this.prisma.remotePeer.count({
        where: {
          status: RemotePeerStatus.ACTIVE,
          staleAlertedAt: { not: null },
          alertEpisodes: { none: { status: { in: [WgAlertEpisodeStatus.OPEN, WgAlertEpisodeStatus.PROVIDER_ACCEPTED, WgAlertEpisodeStatus.EXHAUSTED] } } },
        },
      }),
    ]);

    const oldestAgeMs = oldest ? Math.max(0, nowMs - oldest.detectedAt.getTime()) : null;

    let level: HealthLevel = 'GREEN';
    let message: string | null = null;
    if (open > 0 || legacy > 0) {
      level = 'ORANGE';
      message = open > 0 ? 'alerte sans fournisseur accepté, nouvelle tentative programmée' : 'ancien incident sans preuve durable : acceptation inconnue';
    }
    if (exhausted > 0 || stuck > 0 || (oldestAgeMs !== null && oldestAgeMs >= RED_AFTER_MS)) {
      level = 'RED';
      message = exhausted > 0 ? 'tentatives épuisées sans fournisseur accepté' : stuck > 0 ? 'tentative bloquée (claim expiré)' : 'alerte sans fournisseur accepté depuis plus d’une heure';
    }

    return {
      level,
      persistence: 'DATABASE',
      resetOnRestart: false,
      deliveryProofDurable: true,
      windowHours: 24,
      message,
      wgAlertEpisodesOpen: open,
      wgAlertEpisodesProviderAccepted: accepted,
      wgAlertEpisodesExhausted: exhausted,
      wgAlertEpisodesResolved24h: resolved24h,
      wgEmailProviderAccepted: emailAccepted,
      wgPushProviderAccepted: pushAccepted,
      wgNoProviderAccepted: open + exhausted,
      wgNoRecipient: noRecipient,
      wgNoPushToken: noToken,
      wgInvalidPushToken: invalidToken,
      wgProviderFailures: failuresEmail + failuresPush,
      wgRetryScheduled: scheduled,
      wgRetryDue: due,
      wgOldestOpenAgeMs: oldestAgeMs,
      wgStuckClaims: stuck,
      wgAcceptanceUnknownLegacy: legacy,
    };
  }
}
