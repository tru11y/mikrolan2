import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import {
  SubscriptionsService,
  TRIAL_DAYS,
} from '../subscriptions/subscriptions.service';
import {
  ChangePasswordDto,
  DeleteAccountDto,
  LoginDto,
  SignupDto,
  UpdateNotificationsDto,
  UpdateProfileDto,
} from './dto/auth.schemas';

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  async signup(dto: SignupDto): Promise<TokenPair> {
    const passwordHash = await argon2.hash(dto.password, ARGON);
    // Essai gratuit ouvert à l'inscription : l'app entière est utilisable en
    // local pendant TRIAL_DAYS, puis tout se verrouille jusqu'au passage PRO.
    const now = new Date();

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
                status: SubscriptionStatus.TRIALING,
                currentPeriodStart: now,
                currentPeriodEnd: new Date(
                  now.getTime() + TRIAL_DAYS * 86_400_000,
                ),
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
        throw new ConflictException('Cette adresse e-mail est déjà utilisée.');
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

    // Le back-office affiche la dernière connexion pour distinguer un compte
    // abandonné d'un compte actif. Sans await bloquant sur l'échec : ne pas
    // savoir horodater ne doit pas empêcher quelqu'un de se connecter.
    await this.prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => undefined);

    return this.tokens.issueTokens({
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  async me(userId: string, tenantId: string) {
    const [user, tenant, subscription] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          country: true,
          role: true,
          status: true,
          notificationsEnabled: true,
        },
      }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, status: true },
      }),
      this.prisma.subscription.findUnique({
        where: { tenantId },
        select: { plan: true, status: true, currentPeriodEnd: true },
      }),
    ]);
    if (!user || !tenant) throw new UnauthorizedException('Compte introuvable. Reconnectez-vous.');
    // L'app dessine ses cadenas à partir de ceci ; le serveur les applique.
    const entitlement = await this.subscriptions.getEntitlement(tenantId);
    return { user, tenant, subscription, entitlement };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.country !== undefined) data.country = dto.country;

    await this.prisma.user.update({ where: { id: userId }, data });
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        country: true,
        role: true,
        status: true,
        notificationsEnabled: true,
      },
    });
    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Compte introuvable. Reconnectez-vous.');

    const ok = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!ok) throw new UnauthorizedException('Mot de passe actuel incorrect');

    const passwordHash = await argon2.hash(dto.newPassword, ARGON);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    // Password change is a security boundary: revoke all sessions so any
    // stolen refresh token stops working immediately.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken);
  }

  async logout(refreshToken: string): Promise<{ revoked: true }> {
    await this.tokens.revoke(refreshToken);
    return { revoked: true };
  }

  async updateNotifications(userId: string, dto: UpdateNotificationsDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationsEnabled: dto.enabled },
    });
    return { notificationsEnabled: dto.enabled };
  }

  async registerPushToken(
    userId: string,
    token: string,
  ): Promise<{ registered: true }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pushToken: token },
    });
    return { registered: true };
  }

  async googleLogin(idToken: string): Promise<TokenPair> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) throw new UnauthorizedException('Google OAuth non configuré.');

    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) throw new UnauthorizedException('Token Google invalide.');
    const payload = (await res.json()) as Record<string, string>;

    if (payload.aud !== clientId) {
      throw new UnauthorizedException('Token Google invalide (audience).');
    }

    const googleId = payload.sub;
    const email = payload.email?.toLowerCase();
    if (!email) throw new UnauthorizedException('E-mail Google requis.');

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ googleId }, { email }],
      },
    });

    if (existing) {
      if (existing.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('Compte désactivé.');
      }
      if (!existing.googleId) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { googleId },
        });
      }
      await this.prisma.user
        .update({ where: { id: existing.id }, data: { lastLoginAt: new Date() } })
        .catch(() => undefined);
      return this.tokens.issueTokens({
        id: existing.id,
        tenantId: existing.tenantId,
        role: existing.role,
      });
    }

    const now = new Date();
    const name = payload.name || email.split('@')[0];
    const placeholderHash = await argon2.hash(randomBytes(32).toString('hex'), ARGON);

    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name,
          slug: slugify(name),
          subscription: {
            create: {
              plan: SubscriptionPlan.FREE,
              status: SubscriptionStatus.TRIALING,
              currentPeriodStart: now,
              currentPeriodEnd: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
            },
          },
        },
      });
      return tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          name,
          passwordHash: placeholderHash,
          googleId,
          role: UserRole.OWNER,
          status: UserStatus.ACTIVE,
        },
      });
    });

    return this.tokens.issueTokens({
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  async revokeAllSessions(userId: string): Promise<{ revoked: true }> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
    return { revoked: true };
  }

  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Compte introuvable. Reconnectez-vous.');

    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Mot de passe incorrect');

    // Soft delete — no cascade. Login already rejects non-ACTIVE users.
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.DELETED },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }
}
