import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      async () => {
        try {
          await this.redis.ping();
          return { redis: { status: 'up' as const } };
        } catch {
          return { redis: { status: 'down' as const } };
        }
      },
    ]);
  }

  @Get('system')
  async system() {
    const mem = process.memoryUsage();
    const uptime = process.uptime();

    const [tenantCount, routerCount, activeSessionCount, openTicketCount] =
      await Promise.all([
        this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
        this.prisma.router.count({ where: { deletedAt: null } }),
        this.prisma.session.count({ where: { status: 'ACTIVE' } }),
        this.prisma.supportTicket.count({
          where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
        }),
      ]);

    return {
      uptime: Math.round(uptime),
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
      counts: {
        tenants: tenantCount,
        routers: routerCount,
        activeSessions: activeSessionCount,
        openTickets: openTicketCount,
      },
    };
  }
}
