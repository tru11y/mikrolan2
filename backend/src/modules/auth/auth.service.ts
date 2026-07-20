import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Prisma,
  SubscriptionPlan,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService, TokenPair } from './token.service';
import { LoginDto, SignupDto } from './dto/auth.schemas';

// Argon2id params (fintech-grade) — see global profile.
const ARGON: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'tenant'}-${randomBytes(3).toString('hex')}`;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async signup(dto: SignupDto): Promise<TokenPair> {
    const passwordHash = await argon2.hash(dto.password, ARGON);

    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: dto.tenantName,
            slug: slugify(dto.tenantName),
            subscription: {
              create: {
                plan: SubscriptionPlan.FREE,
                status: SubscriptionStatus.ACTIVE,
              },
            },
          },
        });
        return tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.email.toLowerCase(),
            passwordHash,
            role: UserRole.OWNER,
            status: UserStatus.ACTIVE,
          },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Email already registered');
      }
      throw e;
    }

    return this.tokens.issueTokens({
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    // Uniform failure to avoid user-enumeration.
    const invalid = new UnauthorizedException('Invalid credentials');
    if (!user || user.status !== UserStatus.ACTIVE) {
      // Still spend time hashing to reduce timing signal.
      await argon2.hash(dto.password, ARGON).catch(() => undefined);
      throw invalid;
    }

    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw invalid;

    return this.tokens.issueTokens({
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken);
  }

  async logout(refreshToken: string): Promise<{ revoked: true }> {
    await this.tokens.revoke(refreshToken);
    return { revoked: true };
  }
}
