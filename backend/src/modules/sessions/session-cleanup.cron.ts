import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min sans lastSeenAt

@Injectable()
export class SessionCleanupCron {
  private readonly logger = new Logger(SessionCleanupCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanStaleSessions(): Promise<void> {
    const threshold = new Date(Date.now() - STALE_THRESHOLD_MS);

    const result = await this.prisma.session.updateMany({
      where: {
        status: 'ACTIVE',
        lastSeenAt: { lt: threshold },
      },
      data: {
        status: 'TERMINATED',
        terminatedAt: new Date(),
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned ${result.count} stale sessions`);
    }
  }
}
