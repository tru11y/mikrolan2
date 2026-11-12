import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import type { NotificationType, UserRole } from '@prisma/client';
import type { ListNotificationsQueryDto } from './dto/notifications.schemas';
import type { PushJobData } from './notification.processor';

/** `SENT` = accepté par l'API Expo. Cela ne prouve pas l'affichage sur le téléphone. */
export type PushDeliveryResult = 'SENT' | 'NO_TOKEN' | 'DISABLED' | 'FAILED' | 'INVALID_TOKEN';

export interface PushSendSummary {
  status: PushDeliveryResult;
  tokensFound: number;
  accepted: number;
  invalid: number;
  failureCode?: string;
}

interface PushRecipient {
  userId: string;
  token: string;
}

interface CollectedRecipients {
  recipients: PushRecipient[];
  disabled: boolean;
  failureCode?: string;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_TIMEOUT_MS = 10_000;
const EXPO_TOKEN_RE = /^Expo(?:nent)?PushToken\[[^\]\s]+\]$/;

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  voucherId: string | null;
  routerId: string | null;
  read: boolean;
  createdAt: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('notifications') private readonly pushQueue: Queue<PushJobData>,
  ) {}

  async createAndPush(
    tenantId: string,
    type: NotificationType,
    title: string,
    body: string,
    routerId?: string | null,
    voucherId?: string | null,
  ): Promise<void> {
    const notification = await this.prisma.notification.create({
      data: { tenantId, type, title, body, routerId, voucherId },
    });

    const { recipients } = await this.collectPushRecipients(tenantId, routerId);
    const tokens = recipients.map((r) => r.token);
    if (!tokens.length) {
      this.logger.warn(`No push token for tenant ${tenantId} (notification ${notification.id}, type ${type})`);
      return;
    }

    try {
      await this.pushQueue.add('push', {
        notificationId: notification.id,
        tokens,
        title,
        body,
        data: routerId ? { routerId } : undefined,
      });
    } catch (e) {
      this.logger.warn(`BullMQ enqueue failed, sending directly: ${e instanceof Error ? e.message : e}`);
      await this.sendPushDirect(tenantId, recipients, title, body, routerId ? { routerId } : undefined);
    }
  }

  /**
   * `roles` restreint les destinataires (absent = tous les utilisateurs actifs du tenant, comportement historique).
   * Ne lève jamais : l'issue est dans le résumé retourné.
   */
  async sendPushToTenant(
    tenantId: string,
    title: string,
    body: string,
    routerId?: string | null,
    extraData?: Record<string, unknown>,
    roles?: UserRole[],
  ): Promise<PushSendSummary> {
    const collected = await this.collectPushRecipients(tenantId, routerId, roles);
    if (collected.failureCode) {
      return { status: 'FAILED', tokensFound: 0, accepted: 0, invalid: 0, failureCode: collected.failureCode };
    }
    if (!collected.recipients.length) {
      this.logger.warn(`No push token for tenant ${tenantId} ("${title}")${collected.disabled ? ' (notifications disabled)' : ''}`);
      return { status: collected.disabled ? 'DISABLED' : 'NO_TOKEN', tokensFound: 0, accepted: 0, invalid: 0 };
    }

    const data = { ...(routerId ? { routerId } : {}), ...extraData };
    return this.sendPushDirect(tenantId, collected.recipients, title, body, Object.keys(data).length ? data : undefined);
  }

  private async collectPushRecipients(
    tenantId: string,
    routerId?: string | null,
    roles?: UserRole[],
  ): Promise<CollectedRecipients> {
    try {
      if (routerId) {
        const router = await this.prisma.router.findFirst({
          where: { id: routerId, tenantId, deletedAt: null },
          select: { pushNotifications: true },
        });
        if (router && !router.pushNotifications) return { recipients: [], disabled: true };
      }

      const users = await this.prisma.user.findMany({
        where: {
          tenantId,
          pushToken: { not: null },
          status: 'ACTIVE',
          ...(roles ? { role: { in: roles } } : {}),
        },
        select: { id: true, pushToken: true, notificationsEnabled: true },
      });

      const enabled = users.filter((u) => u.notificationsEnabled && u.pushToken);
      return {
        recipients: enabled.map((u) => ({ userId: u.id, token: u.pushToken as string })),
        disabled: enabled.length === 0 && users.length > 0,
      };
    } catch (e) {
      this.logger.warn(`Token collection failed: ${e instanceof Error ? e.constructor.name : 'error'}`);
      return { recipients: [], disabled: false, failureCode: 'TOKEN_LOOKUP_FAILED' };
    }
  }

  private async sendPushDirect(
    tenantId: string,
    recipients: PushRecipient[],
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<PushSendSummary> {
    // Un même token (deux comptes sur un appareil) ne reçoit qu'un seul message.
    const usersByToken = new Map<string, string[]>();
    for (const r of recipients) usersByToken.set(r.token, [...(usersByToken.get(r.token) ?? []), r.userId]);
    const tokens = [...usersByToken.keys()];
    const base = { tokensFound: tokens.length };
    const sendable = tokens.filter((t) => EXPO_TOKEN_RE.test(t));
    const malformed = tokens.length - sendable.length;
    if (!sendable.length) {
      return { ...base, status: 'INVALID_TOKEN', accepted: 0, invalid: malformed, failureCode: 'INVALID_EXPO_TOKEN' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXPO_TIMEOUT_MS);
    try {
      const messages = sendable.map((token) => ({
        to: token,
        title,
        body,
        sound: 'default' as const,
        channelId: 'default',
        priority: 'high' as const,
        ...(data ? { data } : {}),
      }));

      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(`Expo push failed: HTTP ${res.status}`);
        return { ...base, status: 'FAILED', accepted: 0, invalid: malformed, failureCode: `HTTP_${res.status}` };
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return { ...base, status: 'FAILED', accepted: 0, invalid: malformed, failureCode: 'MALFORMED_RESPONSE' };
      }
      const tickets = (json as { data?: unknown } | null)?.data;
      if (!Array.isArray(tickets)) {
        return { ...base, status: 'FAILED', accepted: 0, invalid: malformed, failureCode: 'MALFORMED_RESPONSE' };
      }

      let accepted = 0;
      let failureCode: string | undefined;
      const dead: string[] = [];
      sendable.forEach((token, i) => {
        const t = tickets[i] as { status?: string; details?: { error?: string } } | undefined;
        if (t?.status === 'ok') {
          accepted++;
        } else if (t?.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
          dead.push(token);
        } else {
          failureCode ??= t?.status === 'error' ? (t.details?.error ?? 'EXPO_ERROR') : 'TICKET_MISSING';
        }
      });

      if (dead.length) this.logger.warn(`Expo: ${dead.length} token(s) DeviceNotRegistered`);
      if (failureCode) this.logger.warn(`Expo ticket error: ${failureCode}`);

      // Invalidation strictement ciblée : même utilisateur, même tenant, même token (jamais de purge globale).
      await Promise.all(
        dead.map((token) =>
          this.prisma.user
            .updateMany({ where: { id: { in: usersByToken.get(token) ?? [] }, tenantId, pushToken: token }, data: { pushToken: null } })
            .catch((e: unknown) => this.logger.warn(`Dead token cleanup failed: ${e instanceof Error ? e.constructor.name : 'error'}`)),
        ),
      );

      const invalid = dead.length + malformed;
      const status: PushDeliveryResult = accepted > 0 ? 'SENT' : failureCode ? 'FAILED' : 'INVALID_TOKEN';
      return { ...base, status, accepted, invalid, ...(failureCode ? { failureCode } : {}) };
    } catch {
      const failureCode = controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR';
      this.logger.warn(`Push error: ${failureCode}`);
      return { ...base, status: 'FAILED', accepted: 0, invalid: malformed, failureCode };
    } finally {
      clearTimeout(timer);
    }
  }

  async list(query: ListNotificationsQueryDto): Promise<NotificationDto[]> {
    const rows = await this.prisma.notification.findMany({
      where: query.unreadOnly ? { readAt: null } : {},
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      voucherId: n.voucherId,
      routerId: n.routerId,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async unreadCount(): Promise<number> {
    return this.prisma.notification.count({ where: { readAt: null } });
  }

  async markRead(id: string): Promise<{ read: true }> {
    const result = await this.prisma.notification.updateMany({
      where: { id },
      data: { readAt: new Date() },
    });
    if (result.count === 0) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.NOTIFICATION_NOT_FOUND, 'Notification introuvable.');
    return { read: true };
  }

  async markAllRead(): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
