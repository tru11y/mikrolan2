import { Injectable } from '@nestjs/common';
import {
  Prisma,
  WgAlertAttemptKind,
  WgAlertAttemptStatus,
  WgAlertChannel,
  WgAlertEpisodeStatus,
  type WgAlertEmailStatus,
  type WgAlertPushStatus,
  type WgAlertType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Alerte initiale : T0 (immédiate), T0 + 1 h, puis + 6 h après la deuxième (≈ T0 + 7 h). Jamais de quatrième. */
export const WG_ALERT_MAX_ATTEMPTS = 3;
/** Délai appliqué après la tentative N (index N-1). */
export const WG_ALERT_RETRY_DELAYS_MS: readonly number[] = [3_600_000, 6 * 3_600_000];
/** Rappels d'un incident toujours non résolu après acceptation : 24 h après la détection, puis toutes les 24 h. */
export const WG_ALERT_REMINDER_INTERVAL_MS = 24 * 3_600_000;
/** Limite métier documentée : au plus 7 rappels, puis l'épisode reste visible (RED) jusqu'au handshake sain. */
export const WG_ALERT_MAX_REMINDERS = 7;
/** Durée de validité d'un claim : au-delà, un autre passage peut reprendre la tentative (crash du processus). */
export const WG_ALERT_CLAIM_TTL_MS = 5 * 60_000;

/** Statuts d'un épisode non résolu (couverts par l'index unique partiel de la migration). */
export const WG_ACTIVE_EPISODE_STATUSES: WgAlertEpisodeStatus[] = [
  WgAlertEpisodeStatus.OPEN,
  WgAlertEpisodeStatus.PROVIDER_ACCEPTED,
  WgAlertEpisodeStatus.EXHAUSTED,
];

const VALID_EMAIL_STATUS: ReadonlySet<string> = new Set<WgAlertEmailStatus>(['SENT', 'NO_RECIPIENT', 'NOT_CONFIGURED', 'FAILED']);
const VALID_PUSH_STATUS: ReadonlySet<string> = new Set<WgAlertPushStatus>(['SENT', 'NO_TOKEN', 'DISABLED', 'FAILED', 'INVALID_TOKEN']);
const FAILURE_CODE_RE = /^[A-Z0-9_]{1,40}$/;

export interface ChannelAttempt {
  channel: WgAlertChannel;
  status: WgAlertAttemptStatus;
  failureCode: string | null;
  recipientCount: number;
}

export interface AttemptRecord {
  emailStatus: WgAlertEmailStatus;
  pushStatus: WgAlertPushStatus;
  channels: ChannelAttempt[];
}

export interface CompletedAttempt {
  saved: boolean;
  attemptNumber: number;
  providerAccepted: boolean;
  exhausted: boolean;
  nextAttemptAt: Date | null;
}

export interface CompletedReminder {
  saved: boolean;
  reminderNumber: number;
  providerAccepted: boolean;
  limitReached: boolean;
  nextReminderAt: Date | null;
}

/** Valeurs fermées à l'écriture : une valeur inconnue est rejetée avant toute écriture. */
export function assertValidRecord(record: AttemptRecord): AttemptRecord {
  if (!VALID_EMAIL_STATUS.has(record.emailStatus) || !VALID_PUSH_STATUS.has(record.pushStatus)) {
    throw new Error('INVALID_ALERT_STATUS');
  }
  const known = new Set<string>(Object.values(WgAlertAttemptStatus));
  for (const c of record.channels) {
    if (!known.has(c.status)) throw new Error('INVALID_ALERT_STATUS');
  }
  return {
    ...record,
    channels: record.channels.map((c) => ({ ...c, failureCode: c.failureCode && FAILURE_CODE_RE.test(c.failureCode) ? c.failureCode : c.failureCode ? 'UNKNOWN_FAILURE' : null })),
  };
}

/**
 * Persistance des épisodes d'alerte. Séquence d'une tentative : claim atomique court → appel fournisseur
 * (hors transaction, hors verrou SQL) → écriture du résultat conditionnée à l'état attendu.
 * Alerte initiale et retries : épisode OPEN. Rappels quotidiens : épisode PROVIDER_ACCEPTED, un seul passage
 * logique par période de 24 h (une tentative EMAIL, une PUSH, jamais de retry du rappel).
 */
@Injectable()
export class WgAlertEpisodeService {
  constructor(private readonly prisma: PrismaService) {}

  async hasActive(remotePeerId: string): Promise<boolean> {
    const found = await this.prisma.wgAlertEpisode.findFirst({
      where: { remotePeerId, status: { in: WG_ACTIVE_EPISODE_STATUSES } },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * Crée l'épisode OPEN, première tentative due immédiatement. Faux si un épisode non résolu existe déjà :
   * c'est l'index unique partiel de PostgreSQL qui tranche les courses, pas ce code.
   */
  async open(
    peer: { id: string; tenantId: string },
    alertType: WgAlertType,
    detectedAt: Date,
    nowMs: number,
    legacy: boolean,
  ): Promise<boolean> {
    try {
      await this.prisma.wgAlertEpisode.create({
        data: {
          remotePeerId: peer.id,
          tenantId: peer.tenantId,
          alertType,
          detectedAt,
          status: WgAlertEpisodeStatus.OPEN,
          nextAttemptAt: new Date(nowMs),
          legacy,
          failureCode: legacy ? 'LEGACY_ACCEPTANCE_UNKNOWN' : null,
        },
      });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
  }

  /** Handshake sain : tout épisode non résolu du peer est clos, plus aucun retry ni rappel. */
  async resolvePeer(remotePeerId: string, nowMs: number): Promise<number> {
    const res = await this.prisma.wgAlertEpisode.updateMany({
      where: { remotePeerId, status: { in: WG_ACTIVE_EPISODE_STATUSES } },
      data: { status: WgAlertEpisodeStatus.RESOLVED, resolvedAt: new Date(nowMs), nextAttemptAt: null, nextReminderAt: null, claimExpiresAt: null },
    });
    return res.count;
  }

  private static readonly DUE_SELECT = {
    id: true,
    remotePeerId: true,
    tenantId: true,
    alertType: true,
    attemptCount: true,
    reminderCount: true,
    detectedAt: true,
    legacy: true,
    remotePeer: {
      select: {
        status: true,
        routerId: true,
        lastHandshakeAt: true,
        provisionedAt: true,
        createdAt: true,
        router: { select: { alias: true, identity: true, deletedAt: true } },
      },
    },
  } as const;

  findDue(nowMs: number, limit = 50) {
    const now = new Date(nowMs);
    return this.prisma.wgAlertEpisode.findMany({
      where: {
        status: WgAlertEpisodeStatus.OPEN,
        nextAttemptAt: { lte: now },
        OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }],
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: WgAlertEpisodeService.DUE_SELECT,
    });
  }

  /** Rappels quotidiens dus : épisode accepté, toujours non résolu, `nextReminderAt` échu, sans claim valide. */
  findRemindersDue(nowMs: number, limit = 50) {
    const now = new Date(nowMs);
    return this.prisma.wgAlertEpisode.findMany({
      where: {
        status: WgAlertEpisodeStatus.PROVIDER_ACCEPTED,
        nextReminderAt: { lte: now },
        OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }],
      },
      orderBy: { nextReminderAt: 'asc' },
      take: limit,
      select: WgAlertEpisodeService.DUE_SELECT,
    });
  }

  /** Claim atomique : vrai pour un seul appelant, même avec deux crons ou deux processus. */
  async claim(id: string, expectedAttemptCount: number, nowMs: number): Promise<boolean> {
    const now = new Date(nowMs);
    const res = await this.prisma.wgAlertEpisode.updateMany({
      where: {
        id,
        status: WgAlertEpisodeStatus.OPEN,
        attemptCount: expectedAttemptCount,
        nextAttemptAt: { lte: now },
        OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }],
      },
      data: { claimExpiresAt: new Date(nowMs + WG_ALERT_CLAIM_TTL_MS) },
    });
    return res.count === 1;
  }

  /** Claim atomique du rappel numéro `reminderCount + 1` : un seul appelant, jamais deux rappels pour le même numéro. */
  async claimReminder(id: string, expectedReminderCount: number, nowMs: number): Promise<boolean> {
    const now = new Date(nowMs);
    const res = await this.prisma.wgAlertEpisode.updateMany({
      where: {
        id,
        status: WgAlertEpisodeStatus.PROVIDER_ACCEPTED,
        reminderCount: expectedReminderCount,
        nextReminderAt: { lte: now },
        OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: now } }],
      },
      data: { claimExpiresAt: new Date(nowMs + WG_ALERT_CLAIM_TTL_MS) },
    });
    return res.count === 1;
  }

  /**
   * Écrit le résultat d'une tentative initiale ou d'un retry, une seule fois : la mise à jour est conditionnée à
   * `attemptCount` attendu, donc un second écrivain (claim expiré) est ignoré. Transaction courte : aucun appel externe.
   * Acceptation : premier rappel programmé à détection + 24 h (legacy : acceptation + 24 h, pour ne pas renvoyer aussitôt).
   */
  async complete(
    id: string,
    previousAttemptCount: number,
    rawRecord: AttemptRecord,
    nowMs: number,
    ctx: { detectedAt: Date; legacy: boolean },
  ): Promise<CompletedAttempt> {
    const record = assertValidRecord(rawRecord);
    const attemptNumber = previousAttemptCount + 1;
    const attemptedAt = new Date(nowMs);
    const providerAccepted = record.channels.some((c) => c.status === WgAlertAttemptStatus.PROVIDER_ACCEPTED);
    const exhausted = !providerAccepted && attemptNumber >= WG_ALERT_MAX_ATTEMPTS;
    const delay = WG_ALERT_RETRY_DELAYS_MS[attemptNumber - 1];
    const nextAttemptAt = providerAccepted || exhausted || delay === undefined ? null : new Date(nowMs + delay);
    const nextReminderAt = providerAccepted
      ? new Date(Math.max(ctx.detectedAt.getTime() + WG_ALERT_REMINDER_INTERVAL_MS, ctx.legacy ? nowMs + WG_ALERT_REMINDER_INTERVAL_MS : 0))
      : null;
    const status = providerAccepted
      ? WgAlertEpisodeStatus.PROVIDER_ACCEPTED
      : exhausted
        ? WgAlertEpisodeStatus.EXHAUSTED
        : WgAlertEpisodeStatus.OPEN;

    const saved = await this.prisma.$transaction(async (tx) => {
      const res = await tx.wgAlertEpisode.updateMany({
        where: { id, status: WgAlertEpisodeStatus.OPEN, attemptCount: previousAttemptCount },
        data: {
          status,
          attemptCount: attemptNumber,
          lastAttemptAt: attemptedAt,
          nextAttemptAt,
          nextReminderAt,
          reminderCount: 0,
          claimExpiresAt: null,
          emailStatus: record.emailStatus,
          pushStatus: record.pushStatus,
          ...(providerAccepted ? { providerAcceptedAt: attemptedAt } : {}),
        },
      });
      if (res.count !== 1) return false;
      await tx.wgAlertDeliveryAttempt.createMany({
        data: record.channels.map((c) => ({
          episodeId: id,
          channel: c.channel,
          attemptNumber,
          kind: attemptNumber === 1 ? WgAlertAttemptKind.INITIAL : WgAlertAttemptKind.RETRY,
          status: c.status,
          attemptedAt,
          providerAcceptedAt: c.status === WgAlertAttemptStatus.PROVIDER_ACCEPTED ? attemptedAt : null,
          failureCode: c.failureCode,
          recipientCount: c.recipientCount,
        })),
      });
      return true;
    });
    return { saved, attemptNumber, providerAccepted, exhausted, nextAttemptAt };
  }

  /**
   * Écrit un rappel logique, une seule fois : conditionné à `reminderCount` attendu, et l'unicité
   * (épisode, canal, reminderNumber) de PostgreSQL interdit un doublon même si le claim expire pendant l'envoi.
   * Un rappel n'est jamais réessayé : réussi ou non, le prochain est dans 24 h (max 7).
   */
  async completeReminder(id: string, previousReminderCount: number, rawRecord: AttemptRecord, nowMs: number): Promise<CompletedReminder> {
    const record = assertValidRecord(rawRecord);
    const reminderNumber = previousReminderCount + 1;
    const attemptedAt = new Date(nowMs);
    const providerAccepted = record.channels.some((c) => c.status === WgAlertAttemptStatus.PROVIDER_ACCEPTED);
    const limitReached = reminderNumber >= WG_ALERT_MAX_REMINDERS;
    const nextReminderAt = limitReached ? null : new Date(nowMs + WG_ALERT_REMINDER_INTERVAL_MS);

    const saved = await this.prisma.$transaction(async (tx) => {
      const res = await tx.wgAlertEpisode.updateMany({
        where: { id, status: WgAlertEpisodeStatus.PROVIDER_ACCEPTED, reminderCount: previousReminderCount },
        data: { reminderCount: reminderNumber, lastReminderAt: attemptedAt, nextReminderAt, claimExpiresAt: null },
      });
      if (res.count !== 1) return false;
      await tx.wgAlertDeliveryAttempt.createMany({
        data: record.channels.map((c) => ({
          episodeId: id,
          channel: c.channel,
          attemptNumber: WG_ALERT_MAX_ATTEMPTS + reminderNumber,
          kind: WgAlertAttemptKind.REMINDER,
          reminderNumber,
          status: c.status,
          attemptedAt,
          providerAcceptedAt: c.status === WgAlertAttemptStatus.PROVIDER_ACCEPTED ? attemptedAt : null,
          failureCode: c.failureCode,
          recipientCount: c.recipientCount,
        })),
      });
      return true;
    });
    return { saved, reminderNumber, providerAccepted, limitReached, nextReminderAt };
  }
}
