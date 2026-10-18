import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { EventLogService } from '../events/event-log.service';
import { LEGAL_VERSIONS } from '../legal/legal.versions';
import { PeerRevocationService } from './peer-revocation.service';

@Injectable()
export class RemoteAccessAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
    private readonly peers: PeerRevocationService,
  ) {}

  async status(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { remoteAccessAcceptedAt: true, remoteAccessVersion: true },
    });
    const version = tenant?.remoteAccessVersion ?? null;
    return {
      accepted: version === LEGAL_VERSIONS.remoteAccess,
      acceptedAt: tenant?.remoteAccessAcceptedAt ?? null,
      acceptedVersion: version,
      currentVersion: LEGAL_VERSIONS.remoteAccess,
    };
  }

  async accept(tenantId: string, userId: string, version: string) {
    if (version !== LEGAL_VERSIONS.remoteAccess) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        ErrorCode.LEGAL_VERSION_MISMATCH,
        "L'autorisation a été mise à jour. Relisez-la puis réessayez.",
      );
    }
    const now = new Date();
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        remoteAccessAcceptedAt: now,
        remoteAccessVersion: version,
        remoteAccessAcceptedById: userId,
      },
    });
    await this.eventLog.success(
      AuditAction.CONFIRM,
      'Tenant',
      tenantId,
      { kind: 'REMOTE_ACCESS_AUTHORIZATION', version },
      { tenantId, userId },
    );
    return this.status(tenantId);
  }

  async revoke(tenantId: string, userId: string) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        remoteAccessAcceptedAt: null,
        remoteAccessVersion: null,
        remoteAccessAcceptedById: null,
      },
    });
    const revokedPeers = await this.peers.revokeAllForTenant(
      tenantId,
      'AUTHORIZATION_REVOKED',
      userId,
    );
    await this.eventLog.success(
      AuditAction.REVOKE,
      'Tenant',
      tenantId,
      { kind: 'REMOTE_ACCESS_AUTHORIZATION', revokedPeers },
      { tenantId, userId },
    );
    return { revoked: true as const, revokedPeers };
  }
}
