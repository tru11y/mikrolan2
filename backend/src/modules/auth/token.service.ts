import {
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, TenantStatus, UserRole, UserStatus } from '@prisma/client';
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

    // Rejeu d'un jeton déjà tourné : grâce bornée (réponse perdue / rotation
    // concurrente) sinon compromission → révocation de la famille.
    if (record.revoked) {
      return this.handleRevokedReplay(record, ctx, tokenAgeMs);
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
    // rotatedAt/graceExpiresAt ouvrent la fenêtre de grâce pour les rejeux bénins.
    const grace = this.config.get('AUTH_REFRESH_GRACE_SECONDS', { infer: true });
    const now = Date.now();
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revoked: false },
      data: {
        revoked: true,
        rotatedAt: new Date(now),
        graceExpiresAt: new Date(now + grace * 1000),
      },
    });
    if (claimed.count === 0) {
      // Perdant d'une rotation concurrente : relire l'état gagné et appliquer la grâce.
      const fresh = await this.prisma.refreshToken.findUnique({
        where: { id: record.id },
        include: { user: { include: { tenant: { select: { status: true } } } } },
      });
      if (fresh) return this.handleRevokedReplay(fresh, ctx, tokenAgeMs, 'concurrent_refresh');
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

  /**
   * Jeton déjà tourné présenté à nouveau. Dans la fenêtre de grâce et tant que le
   * successeur n'a pas lui-même été utilisé (révoqué), c'est un rejeu bénin (réponse
   * perdue, rotation concurrente) : on réémet un jeton dans la famille sans la révoquer.
   * Hors grâce, ou successeur déjà consommé → compromission : révocation de la famille.
   */
  private async handleRevokedReplay(
    record: Prisma.RefreshTokenGetPayload<{
      include: { user: { include: { tenant: { select: { status: true } } } } };
    }>,
    ctx: { userId: string; tenantId: string; familyId: string },
    tokenAgeMs: number,
    cause: 'replay_of_revoked_token' | 'concurrent_refresh' = 'replay_of_revoked_token',
  ): Promise<TokenPair> {
    const grace = this.config.get('AUTH_REFRESH_GRACE_SECONDS', { infer: true });
    const successor = await this.prisma.refreshToken.findFirst({
      where: { family: record.family, createdAt: { gt: record.createdAt } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, revoked: true },
    });
    const replayDelayMs = successor ? Date.now() - successor.createdAt.getTime() : -1;
    const inGrace =
      grace > 0 && record.graceExpiresAt != null && record.graceExpiresAt.getTime() > Date.now();
    const successorUnused = successor !== null && !successor.revoked;

    if (inGrace && successorUnused) {
      this.events.record('REFRESH_GRACE_REPLAY', { ...ctx, cause, extra: { tokenAgeMs, replayDelayMs } });
      const next = await this.issueTokens(
        { id: record.user.id, tenantId: record.user.tenantId, role: record.user.role },
        record.family,
      );
      this.events.record('REFRESH_SUCCESS', { ...ctx, cause: 'grace_replay', extra: { tokenAgeMs } });
      return next;
    }

    this.events.record('REFRESH_REUSE_DETECTED', { ...ctx, cause, extra: { tokenAgeMs, replayDelayMs } });
    await this.revokeFamily(record.family, ctx, cause === 'concurrent_refresh' ? 'concurrent_refresh' : 'reuse');
    throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_REUSE, 'Refresh token reuse detected');
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
