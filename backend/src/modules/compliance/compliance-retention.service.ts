import { Injectable, Logger } from '@nestjs/common';
import { PaymentStatus, Prisma, RemotePeerStatus, TenantStatus, UserStatus } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveProofFile } from '../subscriptions/subscriptions.service';
import { PURGE_BATCH_SIZE, RETENTION, daysAgo } from './compliance.constants';

const ANONYMIZED_EMAIL_DOMAIN = 'anonymized.invalid';
// Valeur volontairement non vérifiable par argon2.verify : le compte ne peut plus se connecter.
const ANONYMIZED_PASSWORD_HASH = '!anonymized';

@Injectable()
export class ComplianceRetentionService {
  private readonly logger = new Logger(ComplianceRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Déplace les lignes d'AuditLog > 12 mois vers AuditLogArchive : copie,
   * vérification, puis suppression dans une même transaction. Aucune ligne
   * n'est supprimée sans sa copie archivée.
   */
  async archiveExpiredAuditLogs(now = new Date()): Promise<number> {
    const cutoff = daysAgo(RETENTION.auditLogDays, now);
    let total = 0;
    for (;;) {
      const moved = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.auditLog.findMany({
          where: { createdAt: { lt: cutoff } },
          orderBy: { createdAt: 'asc' },
          take: PURGE_BATCH_SIZE,
        });
        if (rows.length === 0) return { count: 0, full: false };

        const ids = rows.map((r) => r.id);
        await tx.auditLogArchive.createMany({
          data: rows.map(({ metadata, ...row }) => ({
            ...row,
            metadata: metadata ?? Prisma.DbNull,
          })),
          skipDuplicates: true,
        });
        const archived = await tx.auditLogArchive.count({ where: { id: { in: ids } } });
        if (archived !== ids.length) {
          throw new Error(`AuditLog archive incomplete (${archived}/${ids.length}), nothing deleted`);
        }
        const { count } = await tx.auditLog.deleteMany({ where: { id: { in: ids } } });
        return { count, full: rows.length === PURGE_BATCH_SIZE };
      });
      total += moved.count;
      if (!moved.full) break;
    }
    return total;
  }

  /**
   * Supprime le fichier puis la ligne ; un fichier impossible à supprimer garde sa ligne pour un nouvel essai.
   * Une preuve rattachée à une facture PAID n'est JAMAIS supprimée : pas de stratégie d'archivage définie.
   * Seules les preuves de factures PENDING/FAILED sont éligibles (REFUNDED, ancien PAID, est conservé aussi).
   */
  async purgePaymentProofs(now = new Date()): Promise<number> {
    const cutoff = daysAgo(RETENTION.paymentProofDays, now);
    let total = 0;
    for (;;) {
      const proofs = await this.prisma.paymentProof.findMany({
        where: {
          createdAt: { lt: cutoff },
          invoice: { status: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] } },
        },
        select: { id: true, imageUrl: true },
        orderBy: { createdAt: 'asc' },
        take: PURGE_BATCH_SIZE,
      });
      if (proofs.length === 0) break;

      const deletable: string[] = [];
      for (const proof of proofs) {
        if (await this.removeProofFile(proof.id, proof.imageUrl)) deletable.push(proof.id);
      }
      if (deletable.length === 0) break;

      const { count } = await this.prisma.paymentProof.deleteMany({
        where: { id: { in: deletable } },
      });
      total += count;
      if (proofs.length < PURGE_BATCH_SIZE) break;
    }
    return total;
  }

  /**
   * Identifiants RouterOS effacés N jours après la révocation de l'accès distant,
   * uniquement pour un tenant DELETED : un client actif garde ses identifiants
   * (restauration LAN) même après avoir retiré l'autorisation d'accès distant.
   */
  async wipeRevokedRouterCredentials(now = new Date()): Promise<number> {
    const cutoff = daysAgo(RETENTION.revokedRouterCredentialsDays, now);
    const { count } = await this.prisma.router.updateMany({
      where: {
        credEncrypted: { not: null },
        tenant: { status: TenantStatus.DELETED },
        remotePeer: {
          is: { status: RemotePeerStatus.REVOKED, revokedAt: { lt: cutoff } },
        },
      },
      data: { credEncrypted: null },
    });
    return count;
  }

  async anonymizeDeletedUsers(now = new Date()): Promise<number> {
    const cutoff = daysAgo(RETENTION.anonymizeDeletedUserDays, now);
    const users = await this.prisma.user.findMany({
      where: {
        status: UserStatus.DELETED,
        anonymizedAt: null,
        deletedAt: { lt: cutoff },
      },
      select: { id: true, email: true, tenantId: true },
      take: PURGE_BATCH_SIZE,
    });

    let anonymized = 0;
    for (const user of users) {
      try {
        await this.anonymizeUser(user, now);
        anonymized += 1;
      } catch (err) {
        this.logger.error(
          `Anonymization failed for user ${user.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return anonymized;
  }

  private async anonymizeUser(
    user: { id: string; email: string; tenantId: string },
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetCode.deleteMany({ where: { email: user.email } });
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: `deleted-${user.id}@${ANONYMIZED_EMAIL_DOMAIN}`,
          name: null,
          country: null,
          googleId: null,
          appleId: null,
          pushToken: null,
          notificationsEnabled: false,
          hasPassword: false,
          passwordHash: ANONYMIZED_PASSWORD_HASH,
          anonymizedAt: now,
        },
      });

      const tenant = await tx.tenant.findUnique({
        where: { id: user.tenantId },
        select: { status: true },
      });
      if (tenant?.status !== TenantStatus.DELETED) return;
      const othersPending = await tx.user.count({
        where: { tenantId: user.tenantId, anonymizedAt: null, id: { not: user.id } },
      });
      if (othersPending > 0) return;

      await tx.tenant.update({
        where: { id: user.tenantId },
        data: { name: 'Compte supprimé', slug: `deleted-${user.tenantId}`, country: null },
      });
      await tx.router.updateMany({
        where: { tenantId: user.tenantId },
        data: { credEncrypted: null, localAddress: null, alias: null },
      });
    });
  }

  /** @returns true si le fichier n'existe plus (supprimé ou déjà absent ou référence invalide). */
  private async removeProofFile(proofId: string, imageUrl: string): Promise<boolean> {
    let path: string;
    try {
      ({ path } = resolveProofFile(imageUrl));
    } catch {
      this.logger.warn(`Payment proof ${proofId}: invalid imageUrl, row purged without file`);
      return true;
    }
    try {
      await unlink(path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
      this.logger.error(
        `Payment proof ${proofId}: file removal failed, will retry: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }
}
