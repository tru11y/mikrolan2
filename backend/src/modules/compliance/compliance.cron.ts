import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ComplianceRetentionService } from './compliance-retention.service';
import { PeerRevocationService } from './peer-revocation.service';

@Injectable()
export class ComplianceCron {
  private readonly logger = new Logger(ComplianceCron.name);

  constructor(
    private readonly retention: ComplianceRetentionService,
    private readonly peers: PeerRevocationService,
    private readonly config: ConfigService,
  ) {}

  /** Purges et révocations ne s'exécutent que lorsque la conformité est activée (COMPLIANCE_ENFORCED). */
  private get enabled(): boolean {
    return this.config.get<boolean>('COMPLIANCE_ENFORCED') === true;
  }

  @Cron('30 3 * * *')
  async dailyRetention(): Promise<void> {
    if (!this.enabled) return;
    await this.run('audit logs archived', () => this.retention.archiveExpiredAuditLogs());
    await this.run('audit archive purged', () => this.retention.purgeExpiredAuditArchive());
    await this.run('payment proofs purged', () => this.retention.purgePaymentProofs());
    await this.run('router credentials wiped', () => this.retention.wipeRevokedRouterCredentials());
    await this.run('users anonymized', () => this.retention.anonymizeDeletedUsers());
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async revokeDeletedTenantPeers(): Promise<void> {
    if (!this.enabled) return;
    await this.run('deleted-tenant peers revoked', () => this.peers.revokeAllForDeletedTenants());
  }

  /** Une tâche en échec ne doit pas bloquer les suivantes. */
  private async run(label: string, task: () => Promise<number>): Promise<void> {
    try {
      const count = await task();
      if (count > 0) this.logger.log(`${count} ${label}`);
    } catch (err) {
      this.logger.error(`${label}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
