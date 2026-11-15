import {
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserRole, UserStatus } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config/configuration';
import { AuthEventsService, type AuthEventName } from './auth-events.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface Principal {
  id: string;
  tenantId: string;
  role: UserRole;
}

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly events: AuthEventsService,
  ) {}

  async issueTokens(user: Principal, family?: string): Promise<TokenPair> {
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true });

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, tid: user.tenantId, role: user.role },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: accessTtl,
      },
    );

    const raw = randomBytes(32).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        family: family ?? randomUUID(),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return { accessToken, refreshToken: raw, expiresIn: accessTtl };
  }

  async rotate(rawRefresh: string): Promise<TokenPair> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawRefresh) },
      include: { user: { include: { tenant: { select: { status: true } } } } },
    });

    if (!record) {
      this.events.record('REFRESH_INVALID', { cause: 'unknown_token' });
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_INVALID, 'Invalid refresh token');
    }
    const ctx = { userId: record.userId, tenantId: record.user.tenantId, familyId: record.family };
    const tokenAgeMs = Date.now() - record.createdAt.getTime();

    // Reuse of an already-rotated token → compromise: revoke the whole family.
    if (record.revoked) {
      const successor = await this.prisma.refreshToken.findFirst({
        where: { family: record.family, createdAt: { gt: record.createdAt } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      this.events.record('REFRESH_REUSE_DETECTED', {
        ...ctx,
        cause: 'replay_of_revoked_token',
        extra: {
          tokenAgeMs,
          // Délai entre la rotation (émission du successeur) et ce rejeu : distingue une réponse perdue (secondes) d'un vol (jours).
          replayDelayMs: successor ? Date.now() - successor.createdAt.getTime() : -1,
        },
      });
      await this.revokeFamily(record.family, ctx, 'reuse');
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_REUSE, 'Refresh token reuse detected');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      this.events.record('REFRESH_EXPIRED', { ...ctx, cause: 'refresh_ttl', extra: { tokenAgeMs } });
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_EXPIRED, 'Refresh token expired');
    }

    if (
      record.user.status !== UserStatus.ACTIVE ||
      record.user.tenant.status === TenantStatus.DELETED
    ) {
      await this.revokeFamily(record.family, ctx, 'account_disabled');
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_ACCOUNT_DISABLED, 'Compte désactivé.');
    }

    // Consommation atomique : un seul appel concurrent peut gagner la rotation.
    // Le hash d'origine est conservé (revoked=true) pour détecter un rejeu ultérieur.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revoked: false },
      data: { revoked: true },
    });
    if (claimed.count === 0) {
      this.events.record('REFRESH_REUSE_DETECTED', { ...ctx, cause: 'concurrent_refresh', extra: { tokenAgeMs } });
      await this.revokeFamily(record.family, ctx, 'concurrent_refresh');
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_REUSE, 'Refresh token reuse detected');
    }
    this.events.record('REFRESH_ROTATED', { ...ctx, cause: 'rotation', extra: { tokenAgeMs } });

    const next = await this.issueTokens(
      {
        id: record.user.id,
        tenantId: record.user.tenantId,
        role: record.user.role,
      },
      record.family,
    );
    this.events.record('REFRESH_SUCCESS', { ...ctx, cause: 'rotation', extra: { tokenAgeMs } });

    return next;
  }

  private async revokeFamily(
    family: string,
    ctx: { userId: string; tenantId: string; familyId: string },
    cause: string,
  ): Promise<void> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { family, revoked: false },
      data: { revoked: true },
    });
    this.events.record('REFRESH_FAMILY_REVOKED', { ...ctx, cause, extra: { revokedCount: res.count } });
  }

  /** Événement de révocation décidé hors rotation (changement de mot de passe, déconnexion globale…). */
  recordSessionEvent(
    event: AuthEventName,
    userId: string | null,
    cause: string,
    extra?: Record<string, number | string | boolean>,
  ): void {
    if (!userId) {
      this.events.record(event, { cause, extra });
      return;
    }
    void this.prisma.user
      .findUnique({ where: { id: userId }, select: { tenantId: true } })
      .then((u) => this.events.record(event, { userId, tenantId: u?.tenantId ?? null, cause, extra }))
      .catch(() => this.events.record(event, { userId, cause, extra }));
  }

  async revoke(rawRefresh: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawRefresh) },
      select: { userId: true, family: true, user: { select: { tenantId: true } } },
    });
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawRefresh), revoked: false },
      data: { revoked: true },
    });
    if (record) {
      this.events.record('LOGOUT_USER', {
        userId: record.userId,
        tenantId: record.user.tenantId,
        familyId: record.family,
        cause: 'user_logout',
      });
    }
  }
}
