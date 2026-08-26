import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListNotificationsQueryDto } from './dto/notifications.schemas';

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

  constructor(private readonly prisma: PrismaService) {}

  async sendPushToTenant(
    tenantId: string,
    title: string,
    body: string,
    routerId?: string | null,
    extraData?: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (routerId) {
        const router = await this.prisma.router.findFirst({
          where: { id: routerId, tenantId, deletedAt: null },
          select: { pushNotifications: true },
        });
        if (router && !router.pushNotifications) return;
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
      if (!users.length) return;

      const data = { ...(routerId ? { routerId } : {}), ...extraData };
      const messages = users.map((u) => ({
        to: u.pushToken as string,
        title,
        body,
        sound: 'default' as const,
        channelId: 'default',
        priority: 'high' as const,
        ...(Object.keys(data).length ? { data } : {}),
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

      const deadUserIds = tickets
        .map((ticket, i) =>
          ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
            ? users[i]?.id
            : null,
        )
        .filter((id): id is string => Boolean(id));

      await Promise.all(
        deadUserIds.map((id) =>
          this.prisma.user.update({ where: { id }, data: { pushToken: null } }),
        ),
      );
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
