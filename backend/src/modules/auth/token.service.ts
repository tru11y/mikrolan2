import {
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
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

  // A refresh whose rotation response is lost (flaky mobile network, app killed
  // mid-flight) leaves the client holding the just-revoked predecessor. Replaying
  // it within this window, while its successor is still unused, is treated as that
  // lost retry rather than token theft.
  private static readonly ROTATION_GRACE_MS = 60_000;

  async issueTokens(user: Principal, family?: string): Promise<TokenPair> {
    return (await this.createPair(user, family)).pair;
  }

  private async createPair(
    user: Principal,
    family?: string,
  ): Promise<{ pair: TokenPair; refreshId: string }> {
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
    const record = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        family: family ?? randomUUID(),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return {
      pair: { accessToken, refreshToken: raw, expiresIn: accessTtl },
      refreshId: record.id,
    };
  }

  async rotate(rawRefresh: string): Promise<TokenPair> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawRefresh) },
      include: { user: true },
    });

    if (!record) throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_INVALID, 'Invalid refresh token');

    if (record.revoked) {
      const next = await this.rotateWithinGrace(record);
      if (next) return next;

      // Genuine reuse of a rotated token → compromise: revoke the whole family.
      await this.prisma.refreshToken.updateMany({
        where: { family: record.family, revoked: false },
        data: { revoked: true },
      });
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_REUSE, 'Refresh token reuse detected');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_TOKEN_EXPIRED, 'Refresh token expired');
    }

    const { pair, refreshId } = await this.createPair(
      {
        id: record.user.id,
        tenantId: record.user.tenantId,
        role: record.user.role,
      },
      record.family,
    );

    // Keep the original tokenHash so a later replay of this token is detected
    // as reuse (revoked=true); link the successor so a lost-response retry of
    // this token can be recovered within the grace window instead of punished.
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revoked: true, replacedById: refreshId },
    });

    return pair;
  }

  // Recovers a lost rotation response: if the replayed token's successor exists,
  // is still unused, and is fresh, re-issue a pair in the same family. The
  // successor is claimed atomically so concurrent replays can't both succeed.
  // Returns null when this is not a recoverable retry (→ caller treats as reuse).
  private async rotateWithinGrace(
    record: { id: string; family: string; replacedById: string | null; user: { id: string; tenantId: string; role: UserRole } },
  ): Promise<TokenPair | null> {
    if (!record.replacedById) return null;

    const successor = await this.prisma.refreshToken.findUnique({
      where: { id: record.replacedById },
    });
    if (
      !successor ||
      successor.revoked ||
      Date.now() - successor.createdAt.getTime() >= TokenService.ROTATION_GRACE_MS
    ) {
      return null;
    }

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: successor.id, revoked: false },
      data: { revoked: true },
    });
    if (claimed.count !== 1) return null;

    const { pair, refreshId } = await this.createPair(
      { id: record.user.id, tenantId: record.user.tenantId, role: record.user.role },
      record.family,
    );
    await this.prisma.refreshToken.update({
      where: { id: successor.id },
      data: { replacedById: refreshId },
    });

    return pair;
  }

  async revoke(rawRefresh: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawRefresh), revoked: false },
      data: { revoked: true },
    });
  }
}
