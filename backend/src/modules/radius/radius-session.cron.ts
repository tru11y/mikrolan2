import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { SessionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { setTenantContext, tenantStore } from '../../common/context/tenant-context';

/**
 * Filet de sécurité : une session ACTIVE sans Interim/Stop depuis
 * `RADIUS_SESSION_TTL_SECONDS` (NAS injoignable, Stop perdu) est fermée. Le
 * balayage ouvre un contexte tenant par tenant concerné (modèle `syncRouter`).
 */
@Injectable()
export class RadiusSessionCron {
  private readonly logger = new Logger(RadiusSessionCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Interval(60_000)
  async closeStaleSessions(): Promise<void> {
    const ttl = this.config.get<number>('RADIUS_SESSION_TTL_SECONDS') ?? 150;
    const threshold = new Date(Date.now() - ttl * 1000);

    // Hors contexte tenant : lecture non filtrée des tenants concernés.
    const stale = await this.prisma.session.findMany({
      where: { status: SessionStatus.ACTIVE, lastSeenAt: { lt: threshold } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    for (const { tenantId } of stale) {
      await tenantStore.run({}, async () => {
        setTenantContext({ tenantId, userId: 'system-radius', role: UserRole.OWNER });
        const result = await this.prisma.session.updateMany({
          where: { status: SessionStatus.ACTIVE, lastSeenAt: { lt: threshold } },
          data: { status: SessionStatus.TERMINATED, terminatedAt: new Date() },
        });
        if (result.count > 0) {
          this.logger.log(`closed ${result.count} stale RADIUS sessions tenant=${tenantId}`);
        }
      });
    }
  }
}
