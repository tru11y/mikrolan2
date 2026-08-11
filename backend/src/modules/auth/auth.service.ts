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
import { OAuth2Client } from 'google-auth-library';
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
  SetPasswordDto,
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
  private googleClient: OAuth2Client | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
  ) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (clientId) {
      this.googleClient = new OAuth2Client(clientId);
    }
  }

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
            hasPassword: true,
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
          hasPassword: true,
          googleId: true,
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
        hasPassword: true,
        googleId: true,
      },
    });
    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Compte introuvable. Reconnectez-vous.');
    if (!user.hasPassword) {
      throw new UnauthorizedException(
        'Compte OAuth — utilisez « Définir un mot de passe » à la place.',
      );
    }

    const ok = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!ok) throw new UnauthorizedException('Mot de passe actuel incorrect');

    const passwordHash = await argon2.hash(dto.newPassword, ARGON);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  async setPassword(userId: string, dto: SetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Compte introuvable. Reconnectez-vous.');
    if (user.hasPassword) {
      throw new ConflictException(
        'Un mot de passe existe déjà — utilisez « Changer le mot de passe ».',
      );
    }

    const passwordHash = await argon2.hash(dto.password, ARGON);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, hasPassword: true },
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
    if (!this.googleClient) {
      throw new UnauthorizedException('Google OAuth non configuré.');
    }

    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    let ticket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
    } catch {
      throw new UnauthorizedException('Token Google invalide.');
    }

    const payload = ticket.getPayload();
    if (!payload) throw new UnauthorizedException('Token Google invalide.');

    if (payload.email_verified !== true) {
      throw new UnauthorizedException('Adresse e-mail Google non vérifiée.');
    }

    const googleId = payload.sub;
    const email = payload.email?.toLowerCase();
    if (!email) throw new UnauthorizedException('E-mail Google requis.');

    // Lookup by googleId first (returning user), then by email (account linking).
    const byGoogleId = await this.prisma.user.findUnique({ where: { googleId } });
    const existing = byGoogleId ?? await this.prisma.user.findUnique({ where: { email } });

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
          hasPassword: false,
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

    if (user.hasPassword) {
      if (!dto.password) throw new UnauthorizedException('Mot de passe requis.');
      const ok = await argon2.verify(user.passwordHash, dto.password);
      if (!ok) throw new UnauthorizedException('Mot de passe incorrect');
    } else if (dto.googleIdToken) {
      if (!this.googleClient) throw new UnauthorizedException('Google OAuth non configuré.');
      const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
      try {
        const ticket = await this.googleClient.verifyIdToken({
          idToken: dto.googleIdToken,
          audience: clientId,
        });
        const payload = ticket.getPayload();
        if (payload?.sub !== user.googleId) {
          throw new UnauthorizedException('Compte Google incorrect.');
        }
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e;
        throw new UnauthorizedException('Token Google invalide.');
      }
    } else {
      throw new UnauthorizedException(
        'Vérification requise pour supprimer le compte.',
      );
    }

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
