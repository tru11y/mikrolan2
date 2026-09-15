import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';

export interface PushJobData {
  notificationId: string;
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Processor('notifications')
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<PushJobData>): Promise<void> {
    const { notificationId, tokens, title, body, data } = job.data;

    const messages = tokens.map((to) => ({
      to,
      title,
      body,
      sound: 'default' as const,
      channelId: 'default',
      priority: 'high' as const,
      ...(data && Object.keys(data).length ? { data } : {}),
    }));

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      throw new Error(`Expo push failed: ${res.status}`);
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { pushSentAt: new Date(), retryCount: job.attemptsMade },
    });

    this.logger.log(`Push sent for notification ${notificationId}`);
  }
}
