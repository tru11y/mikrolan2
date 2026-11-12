import { Injectable } from '@nestjs/common';
import { Prisma, WgAlertAttemptStatus, WgAlertChannel, WgAlertEpisodeStatus, type WgAlertType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Tentatives automatiques : T0 (immédiate), T0 + 1 h, puis + 6 h après la deuxième (≈ T0 + 7 h). Jamais de quatrième. */
export const WG_ALERT_MAX_ATTEMPTS = 3;
/** Délai appliqué après la tentative N (index N-1). */
export const WG_ALERT_RETRY_DELAYS_MS: readonly number[] = [3_600_000, 6 * 3_600_000];
/** Durée de validité d'un claim : au-delà, un autre passage peut reprendre la tentative (crash du processus). */
export const WG_ALERT_CLAIM_TTL_MS = 5 * 60_000;

/** Statuts d'un épisode non résolu (couverts par l'index unique partiel de la migration). */
export const WG_ACTIVE_EPISODE_STATUSES: WgAlertEpisodeStatus[] = [
  WgAlertEpisodeStatus.OPEN,
  WgAlertEpisodeStatus.PROVIDER_ACCEPTED,
  WgAlertEpisodeStatus.EXHAUSTED,
];

export interface ChannelAttempt {
  channel: WgAlertChannel;
  status: WgAlertAttemptStatus;
  failureCode: string | null;
  recipientCount: number;
}

export interface AttemptRecord {
  emailStatus: string;
  pushStatus: string;
  channels: ChannelAttempt[];
}

export interface CompletedAttempt {
  saved: boolean;
  attemptNumber: number;
  providerAccepted: boolean;
  exhausted: boolean;
  nextAttemptAt: Date | null;
}

/**
 * Persistance des épisodes d'alerte. Séquence d'une tentative : claim atomique court → appel fournisseur
 * (hors transaction, hors verrou SQL) → écriture du résultat conditionnée à l'état attendu.
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

  /** Handshake sain : tout épisode non résolu du peer est clos, plus aucun retry. */
  async resolvePeer(remotePeerId: string, nowMs: number): Promise<number> {
    const res = await this.prisma.wgAlertEpisode.updateMany({
      where: { remotePeerId, status: { in: WG_ACTIVE_EPISODE_STATUSES } },
      data: { status: WgAlertEpisodeStatus.RESOLVED, resolvedAt: new Date(nowMs), nextAttemptAt: null, claimExpiresAt: null },
    });
    return res.count;
  }

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
      select: {
        id: true,
        remotePeerId: true,
        tenantId: true,
        alertType: true,
        attemptCount: true,
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
      },
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

  /**
   * Écrit le résultat d'une tentative, une seule fois : la mise à jour est conditionnée à `attemptCount`
   * attendu, donc un second écrivain (claim expiré) est ignoré. Transaction courte : aucun appel externe dedans.
   */
  async complete(id: string, previousAttemptCount: number, record: AttemptRecord, nowMs: number): Promise<CompletedAttempt> {
    const attemptNumber = previousAttemptCount + 1;
    const attemptedAt = new Date(nowMs);
    const providerAccepted = record.channels.some((c) => c.status === WgAlertAttemptStatus.PROVIDER_ACCEPTED);
    const exhausted = !providerAccepted && attemptNumber >= WG_ALERT_MAX_ATTEMPTS;
    const delay = WG_ALERT_RETRY_DELAYS_MS[attemptNumber - 1];
    const nextAttemptAt = providerAccepted || exhausted || delay === undefined ? null : new Date(nowMs + delay);
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
}
