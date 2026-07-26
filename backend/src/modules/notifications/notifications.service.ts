import { Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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
    if (result.count === 0) throw new NotFoundException('Notification not found');
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
