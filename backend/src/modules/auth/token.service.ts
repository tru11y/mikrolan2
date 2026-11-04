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

    if (!record) throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_INVALID, 'Invalid refresh token');

    // Reuse of an already-rotated token → compromise: revoke the whole family.
    if (record.revoked) {
      await this.prisma.refreshToken.updateMany({
        where: { family: record.family, revoked: false },
        data: { revoked: true },
      });
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_REUSE, 'Refresh token reuse detected');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_EXPIRED, 'Refresh token expired');
    }

    if (
      record.user.status !== UserStatus.ACTIVE ||
      record.user.tenant.status === TenantStatus.DELETED
    ) {
      await this.prisma.refreshToken.updateMany({
        where: { family: record.family, revoked: false },
        data: { revoked: true },
      });
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_ACCOUNT_DISABLED, 'Compte désactivé.');
    }

    // Consommation atomique : un seul appel concurrent peut gagner la rotation.
    // Le hash d'origine est conservé (revoked=true) pour détecter un rejeu ultérieur.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revoked: false },
      data: { revoked: true },
    });
    if (claimed.count === 0) {
      await this.prisma.refreshToken.updateMany({
        where: { family: record.family, revoked: false },
        data: { revoked: true },
      });
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_REUSE, 'Refresh token reuse detected');
    }

    const next = await this.issueTokens(
      {
        id: record.user.id,
        tenantId: record.user.tenantId,
        role: record.user.role,
      },
      record.family,
    );

    return next;
  }

  async revoke(rawRefresh: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawRefresh), revoked: false },
      data: { revoked: true },
    });
  }
}
