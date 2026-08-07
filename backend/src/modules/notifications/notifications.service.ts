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
        select: { pushToken: true },
      });
      const tokens = users
        .map((u) => u.pushToken)
        .filter((t): t is string => Boolean(t));
      if (!tokens.length) return;

      const messages = tokens.map((to) => ({ to, title, body, sound: 'default' as const }));
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        this.logger.warn(`Expo push failed: ${res.status}`);
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
