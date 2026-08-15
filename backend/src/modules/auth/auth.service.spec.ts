import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

// ─── Mocks ───────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn(),
  },
  tenant: {
    create: jest.fn(),
    findUnique: jest.fn(),
  },
  subscription: { findUnique: jest.fn() },
  refreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn((fn: (tx: any) => Promise<unknown>): Promise<unknown> => fn(mockPrisma)),
};

const mockTokens = {
  issueTokens: jest.fn().mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    expiresIn: 900,
  }),
  rotate: jest.fn().mockResolvedValue({
    accessToken: 'at2',
    refreshToken: 'rt2',
    expiresIn: 900,
  }),
  revoke: jest.fn().mockResolvedValue(undefined),
};

const mockSubscriptions = {
  getEntitlement: jest.fn().mockResolvedValue({
    tier: 'FREE',
    localAllowed: true,
    remoteAllowed: false,
    endsAt: null,
    daysLeft: null,
    tierKey: null,
    routerLimit: 1,
  }),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'GOOGLE_CLIENT_ID') return undefined;
    return undefined;
  }),
};

function buildService() {
  return new AuthService(
    mockPrisma as any,
    mockTokens as any,
    mockSubscriptions as any,
    mockConfig as any,
  );
}

// ─── Shared fixtures ─────────────────────────────────────
const PASSWORD = 'P@ssw0rd123!';
let PASSWORD_HASH: string;

beforeAll(async () => {
  PASSWORD_HASH = await argon2.hash(PASSWORD, { type: argon2.argon2id });
});

beforeEach(() => jest.clearAllMocks());

// ─── Tests ───────────────────────────────────────────────
describe('AuthService', () => {
  describe('signup', () => {
    it('creates tenant + user and returns tokens', async () => {
      const service = buildService();
      mockPrisma.tenant.create.mockResolvedValue({ id: 't1' });
      mockPrisma.user.create.mockResolvedValue({
        id: 'u1',
        tenantId: 't1',
        role: UserRole.OWNER,
      });

      const result = await service.signup({
        tenantName: 'Café WiFi',
        email: 'Owner@Test.com',
        password: PASSWORD,
      });

      expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });
      expect(mockTokens.issueTokens).toHaveBeenCalledWith({
        id: 'u1',
        tenantId: 't1',
        role: UserRole.OWNER,
      });
      // email lowercased
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'owner@test.com' }),
        }),
      );
    });

    it('throws ConflictException on duplicate email (P2002)', async () => {
      const service = buildService();
      const p2002 = Object.assign(new Error(), { code: 'P2002' });
      Object.setPrototypeOf(
        p2002,
        (await import('@prisma/client')).Prisma.PrismaClientKnownRequestError.prototype,
      );
      mockPrisma.$transaction.mockRejectedValueOnce(p2002);

      await expect(
        service.signup({ tenantName: 'X', email: 'dup@t.com', password: PASSWORD }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    const activeUser = {
      id: 'u1',
      tenantId: 't1',
      role: UserRole.OWNER,
      status: UserStatus.ACTIVE,
      passwordHash: '', // set in beforeAll
    };

    beforeAll(async () => {
      activeUser.passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    });

    it('returns tokens on valid credentials', async () => {
      const service = buildService();
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);

      const result = await service.login({ email: 'A@b.com', password: PASSWORD });

      expect(result).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 900 });
      expect(mockTokens.issueTokens).toHaveBeenCalledWith({
        id: 'u1',
        tenantId: 't1',
        role: UserRole.OWNER,
      });
    });

    it('rejects wrong password with uniform error', async () => {
      const service = buildService();
      mockPrisma.user.findUnique.mockResolvedValue(activeUser);

      await expect(
        service.login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects unknown user with same error (no enumeration)', async () => {
      const service = buildService();
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nope@x.com', password: PASSWORD }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects inactive user', async () => {
      const service = buildService();
      mockPrisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.DELETED,
      });

      await expect(
        service.login({ email: 'a@b.com', password: PASSWORD }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('delegates to tokens.rotate', async () => {
      const service = buildService();
      const result = await service.refresh('some-rt');
      expect(mockTokens.rotate).toHaveBeenCalledWith('some-rt');
      expect(result).toEqual({ accessToken: 'at2', refreshToken: 'rt2', expiresIn: 900 });
    });
  });

  describe('me (getProfile)', () => {
    const user = {
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      country: null,
      role: UserRole.OWNER,
      status: UserStatus.ACTIVE,
      notificationsEnabled: true,
      hasPassword: true,
      googleId: null,
    };
    const tenant = { id: 't1', name: 'T', slug: 't-abc', status: 'ACTIVE' };
    const sub = {
      plan: SubscriptionPlan.FREE,
      status: SubscriptionStatus.TRIALING,
      currentPeriodEnd: new Date(),
    };

    it('returns profile with entitlement for regular user', async () => {
      const service = buildService();
      mockPrisma.user.findFirst.mockResolvedValue(user);
      mockPrisma.tenant.findUnique.mockResolvedValue(tenant);
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);

      const result = await service.me('u1', 't1');

      expect(mockSubscriptions.getEntitlement).toHaveBeenCalledWith('t1');
      expect(result.entitlement.tier).toBe('FREE');
    });

    it('SUPER_ADMIN gets PRO entitlement without subscription check', async () => {
      const service = buildService();
      mockPrisma.user.findFirst.mockResolvedValue({
        ...user,
        role: UserRole.SUPER_ADMIN,
      });
      mockPrisma.tenant.findUnique.mockResolvedValue(tenant);
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);

      const result = await service.me('u1', 't1');

      expect(mockSubscriptions.getEntitlement).not.toHaveBeenCalled();
      expect(result.entitlement).toEqual({
        tier: 'PRO',
        localAllowed: true,
        remoteAllowed: true,
        endsAt: null,
        daysLeft: null,
        tierKey: null,
        routerLimit: null,
      });
    });

    it('throws if user not found', async () => {
      const service = buildService();
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.tenant.findUnique.mockResolvedValue(tenant);
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);

      await expect(service.me('u1', 't1')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('revokes all refresh tokens after password change', async () => {
      const service = buildService();
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        hasPassword: true,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      });

      await service.changePassword('u1', {
        currentPassword: PASSWORD,
        newPassword: 'N3wP@ss!',
      });

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revoked: false },
        data: { revoked: true },
      });
    });

    it('rejects OAuth-only accounts', async () => {
      const service = buildService();
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        hasPassword: false,
      });

      await expect(
        service.changePassword('u1', {
          currentPassword: 'x',
          newPassword: 'y',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token', async () => {
      const service = buildService();
      const result = await service.logout('some-rt');
      expect(mockTokens.revoke).toHaveBeenCalledWith('some-rt');
      expect(result).toEqual({ revoked: true });
    });
  });
});
