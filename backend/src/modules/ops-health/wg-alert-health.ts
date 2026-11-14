import { Injectable } from '@nestjs/common';
import { RemotePeerStatus, WgAlertAttemptKind, WgAlertAttemptStatus, WgAlertChannel, WgAlertEpisodeStatus } from '@prisma/client';
import { WG_ALERT_MAX_REMINDERS } from './wg-alert-episode.service';
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
  /** Rappels quotidiens échus et pas encore exécutés (premier rappel dû non exécuté = ORANGE, bloqué plus d'une heure = RED). */
  wgReminderDue: number;
  /** Lignes de tentative de rappel sur 24 h (une par canal). */
  wgRemindersAttempted24h: number;
  wgRemindersProviderAccepted24h: number;
  wgReminderFailures24h: number;
  /** Épisodes acceptés dont les 7 rappels sont épuisés alors que l'incident reste actif (RED). */
  wgEpisodesReminderLimitReached: number;
  /** Âge du plus ancien épisode non résolu (OPEN, PROVIDER_ACCEPTED ou EXHAUSTED) : « accepté » ne veut pas dire « réglé ». */
  wgOldestUnresolvedAgeMs: number | null;
  /** Anciens `staleAlertedAt` sans épisode durable : acceptation inconnue (jamais présumée). */
  wgAcceptanceUnknownLegacy: number;
}

@Injectable()
export class WgAlertHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(nowMs: number = Date.now()): Promise<WgAlertHealth> {
    const now = new Date(nowMs);
    const since = new Date(nowMs - WINDOW_MS);
    const ACTIVE = [WgAlertEpisodeStatus.OPEN, WgAlertEpisodeStatus.PROVIDER_ACCEPTED, WgAlertEpisodeStatus.EXHAUSTED];

    // Trois requêtes seulement (pas une rafale de comptages parallèles) : les épisodes actifs sont peu nombreux.
    const [episodes, attemptGroups, legacy] = await Promise.all([
      this.prisma.wgAlertEpisode.findMany({
        where: { OR: [{ status: { in: ACTIVE } }, { status: WgAlertEpisodeStatus.RESOLVED, resolvedAt: { gte: since } }] },
        select: { status: true, detectedAt: true, nextAttemptAt: true, nextReminderAt: true, claimExpiresAt: true, reminderCount: true },
      }),
      this.prisma.wgAlertDeliveryAttempt.groupBy({
        by: ['channel', 'kind', 'status'],
        where: { attemptedAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.remotePeer.count({
        where: { status: RemotePeerStatus.ACTIVE, staleAlertedAt: { not: null }, alertEpisodes: { none: { status: { in: ACTIVE } } } },
      }),
    ]);

    const byStatus = (st: WgAlertEpisodeStatus) => episodes.filter((e) => e.status === st);
    const openRows = byStatus(WgAlertEpisodeStatus.OPEN);
    const acceptedRows = byStatus(WgAlertEpisodeStatus.PROVIDER_ACCEPTED);
    const open = openRows.length;
    const accepted = acceptedRows.length;
    const exhausted = byStatus(WgAlertEpisodeStatus.EXHAUSTED).length;
    const resolved24h = byStatus(WgAlertEpisodeStatus.RESOLVED).length;
    const nowT = now.getTime();
    const scheduled = openRows.filter((e) => e.nextAttemptAt !== null && e.nextAttemptAt.getTime() > nowT).length;
    const due = openRows.filter((e) => e.nextAttemptAt !== null && e.nextAttemptAt.getTime() <= nowT).length;
    const stuck = [...openRows, ...acceptedRows].filter((e) => e.claimExpiresAt !== null && e.claimExpiresAt.getTime() <= nowT).length;
    const reminderDue = acceptedRows.filter((e) => e.nextReminderAt !== null && e.nextReminderAt.getTime() <= nowT).length;
    const reminderDueOver1h = acceptedRows.filter((e) => e.nextReminderAt !== null && e.nextReminderAt.getTime() <= nowMs - RED_AFTER_MS).length;
    const limitReached = acceptedRows.filter((e) => e.reminderCount >= WG_ALERT_MAX_REMINDERS).length;
    const oldestOf = (rows: Array<{ detectedAt: Date }>) => (rows.length ? Math.min(...rows.map((r) => r.detectedAt.getTime())) : null);
    const oldestOpenAt = oldestOf(openRows);
    const oldestUnresolvedAt = oldestOf(episodes.filter((e) => e.status !== WgAlertEpisodeStatus.RESOLVED));

    const sum = (pred: (g: (typeof attemptGroups)[number]) => boolean) =>
      attemptGroups.filter(pred).reduce((n, g) => n + g._count._all, 0);
    const failed = (g: { status: WgAlertAttemptStatus }) => g.status === WgAlertAttemptStatus.PROVIDER_FAILED || g.status === WgAlertAttemptStatus.TIMEOUT;
    const emailAccepted = sum((g) => g.channel === WgAlertChannel.EMAIL && g.status === WgAlertAttemptStatus.PROVIDER_ACCEPTED);
    const pushAccepted = sum((g) => g.channel === WgAlertChannel.PUSH && g.status === WgAlertAttemptStatus.PROVIDER_ACCEPTED);
    const noRecipient = sum((g) => g.channel === WgAlertChannel.EMAIL && g.status === WgAlertAttemptStatus.NO_RECIPIENT);
    const noToken = sum((g) => g.channel === WgAlertChannel.PUSH && g.status === WgAlertAttemptStatus.NO_TOKEN);
    const invalidToken = sum((g) => g.channel === WgAlertChannel.PUSH && g.status === WgAlertAttemptStatus.INVALID_TOKEN);
    const failures = sum(failed);
    const remindersAttempted = sum((g) => g.kind === WgAlertAttemptKind.REMINDER);
    const remindersAccepted = sum((g) => g.kind === WgAlertAttemptKind.REMINDER && g.status === WgAlertAttemptStatus.PROVIDER_ACCEPTED);
    const remindersFailed = sum((g) => g.kind === WgAlertAttemptKind.REMINDER && failed(g));

    const oldestAgeMs = oldestOpenAt === null ? null : Math.max(0, nowMs - oldestOpenAt);
    const oldestUnresolvedAgeMs = oldestUnresolvedAt === null ? null : Math.max(0, nowMs - oldestUnresolvedAt);

    let level: HealthLevel = 'GREEN';
    let message: string | null = null;
    if (accepted > 0) message = 'incident toujours ouvert : alerte acceptée par un fournisseur, pas résolu';
    if (open > 0 || legacy > 0 || reminderDue > 0) {
      level = 'ORANGE';
      message = open > 0 ? 'alerte sans fournisseur accepté, nouvelle tentative programmée' : reminderDue > 0 ? 'rappel quotidien dû' : 'ancien incident sans preuve durable : acceptation inconnue';
    }
    if (exhausted > 0 || stuck > 0 || reminderDueOver1h > 0 || limitReached > 0 || (oldestAgeMs !== null && oldestAgeMs >= RED_AFTER_MS)) {
      level = 'RED';
      message =
        exhausted > 0
          ? 'tentatives épuisées sans fournisseur accepté'
          : stuck > 0
            ? 'tentative ou rappel bloqué (claim expiré)'
            : limitReached > 0
              ? 'limite de 7 rappels atteinte, incident toujours actif'
              : reminderDueOver1h > 0
                ? 'rappel quotidien bloqué depuis plus d’une heure'
                : 'alerte sans fournisseur accepté depuis plus d’une heure';
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
      wgProviderFailures: failures,
      wgRetryScheduled: scheduled,
      wgRetryDue: due,
      wgOldestOpenAgeMs: oldestAgeMs,
      wgStuckClaims: stuck,
      wgAcceptanceUnknownLegacy: legacy,
      wgReminderDue: reminderDue,
      wgRemindersAttempted24h: remindersAttempted,
      wgRemindersProviderAccepted24h: remindersAccepted,
      wgReminderFailures24h: remindersFailed,
      wgEpisodesReminderLimitReached: limitReached,
      wgOldestUnresolvedAgeMs: oldestUnresolvedAgeMs,
    };
  }
}
