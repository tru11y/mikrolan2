import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RouterHealth } from '@prisma/client';

const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min sans heartbeat = OFFLINE
const DEGRADED_THRESHOLD = 3; // 3+ sync failures = DEGRADED

@Injectable()
export class RouterHealthCron {
  private readonly logger = new Logger(RouterHealthCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkRouterHealth(): Promise<void> {
    const now = new Date();
    const threshold = new Date(now.getTime() - OFFLINE_THRESHOLD_MS);

    const routers = await this.prisma.router.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        identity: true,
        health: true,
        lastHeartbeat: true,
        syncFailCount: true,
      },
    });

    for (const router of routers) {
      let newHealth: RouterHealth = router.health;

      if (!router.lastHeartbeat || router.lastHeartbeat < threshold) {
        newHealth = RouterHealth.OFFLINE;
      } else if (router.syncFailCount >= DEGRADED_THRESHOLD) {
        newHealth = RouterHealth.DEGRADED;
      } else {
        newHealth = RouterHealth.ONLINE;
      }

      if (newHealth === router.health) continue;

      await this.prisma.router.update({
        where: { id: router.id },
        data: { health: newHealth },
      });

      if (newHealth === RouterHealth.OFFLINE && router.health !== RouterHealth.OFFLINE) {
        await this.notifications.createAndPush(
          router.tenantId,
          'ROUTER_OFFLINE',
          `Routeur ${router.identity} hors ligne`,
          `Le routeur ${router.identity} ne répond plus depuis 5 minutes.`,
          router.id,
        );
        this.logger.warn(`Router ${router.identity} → OFFLINE`);
      }

      if (newHealth === RouterHealth.ONLINE && router.health === RouterHealth.OFFLINE) {
        await this.notifications.createAndPush(
          router.tenantId,
          'ROUTER_ONLINE',
          `Routeur ${router.identity} en ligne`,
          `Le routeur ${router.identity} est de nouveau joignable.`,
          router.id,
        );
        this.logger.log(`Router ${router.identity} → ONLINE`);
      }
    }
  }
}
