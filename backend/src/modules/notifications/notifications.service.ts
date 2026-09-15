import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import type { NotificationType } from '@prisma/client';
import type { ListNotificationsQueryDto } from './dto/notifications.schemas';
import type { PushJobData } from './notification.processor';

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

    const tokens = await this.collectPushTokens(tenantId, routerId);
    if (!tokens.length) return;

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
      await this.sendPushDirect(tokens, title, body, routerId ? { routerId } : undefined);
    }
  }

  async sendPushToTenant(
    tenantId: string,
    title: string,
    body: string,
    routerId?: string | null,
    extraData?: Record<string, unknown>,
  ): Promise<void> {
    const tokens = await this.collectPushTokens(tenantId, routerId);
    if (!tokens.length) return;

    const data = { ...(routerId ? { routerId } : {}), ...extraData };
    await this.sendPushDirect(tokens, title, body, Object.keys(data).length ? data : undefined);
  }

  private async collectPushTokens(tenantId: string, routerId?: string | null): Promise<string[]> {
    try {
      if (routerId) {
        const router = await this.prisma.router.findFirst({
          where: { id: routerId, tenantId, deletedAt: null },
          select: { pushNotifications: true },
        });
        if (router && !router.pushNotifications) return [];
      }

      const users = await this.prisma.user.findMany({
        where: {
          tenantId,
          notificationsEnabled: true,
          pushToken: { not: null },
          status: 'ACTIVE',
        },
        select: { id: true, pushToken: true },
      });

      return users.map((u) => u.pushToken as string);
    } catch (e) {
      this.logger.warn(`Token collection failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  private async sendPushDirect(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const messages = tokens.map((to) => ({
        to,
        title,
        body,
        sound: 'default' as const,
        channelId: 'default',
        priority: 'high' as const,
        ...(data ? { data } : {}),
      }));

      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });

      if (!res.ok) {
        this.logger.warn(`Expo push failed: ${res.status}`);
        return;
      }

      const { data: tickets } = (await res.json()) as {
        data?: Array<{ status: string; details?: { error?: string } }>;
      };
      if (!tickets) return;

      const deadTokens = tickets
        .map((ticket, i) =>
          ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
            ? tokens[i]
            : null,
        )
        .filter((t): t is string => Boolean(t));

      if (deadTokens.length) {
        await this.prisma.user.updateMany({
          where: { pushToken: { in: deadTokens } },
          data: { pushToken: null },
        });
      }
    } catch (e) {
      this.logger.warn(`Push error: ${e instanceof Error ? e.message : e}`);
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
    if (result.count === 0) throw new NotFoundException('Notification introuvable.');
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
