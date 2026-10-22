import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { LEGAL_VERSIONS } from '../legal/legal.versions';
import appleSignin from 'apple-signin-auth';

jest.mock('apple-signin-auth', () => ({ __esModule: true, default: { verifyIdToken: jest.fn() } }));

// ─── Mocks ───────────────────────────────────────────────
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn(),
    count: jest.fn(),
  },
  tenant: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  subscription: { findUnique: jest.fn() },
  refreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
  invoice: { updateMany: jest.fn().mockResolvedValue({}) },
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
  get: jest.fn((key: string): string | undefined => {
    if (key === 'GOOGLE_CLIENT_ID') return undefined;
    return undefined;
  }),
};

const mockMail = {
  sendWelcome: jest.fn().mockResolvedValue(undefined),
  sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  sendRouterOffline: jest.fn().mockResolvedValue(undefined),
  sendInvoice: jest.fn().mockResolvedValue(undefined),
};

function buildService() {
  return new AuthService(
    mockPrisma as any,
    mockTokens as any,
    mockSubscriptions as any,
    mockConfig as any,
    mockMail as any,
  );
}

// ─── Shared fixtures ─────────────────────────────────────
const PASSWORD = 'P@ssw0rd123!';
const LEGAL = { termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy };
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
        ...LEGAL,
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

    it('stores the accepted legal versions and timestamps on the user', async () => {
      const service = buildService();
      mockPrisma.tenant.create.mockResolvedValue({ id: 't1' });
      mockPrisma.user.create.mockResolvedValue({ id: 'u1', tenantId: 't1', role: UserRole.OWNER });

      await service.signup({ tenantName: 'Café', email: 'a@b.com', password: PASSWORD, ...LEGAL });

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            termsVersion: LEGAL_VERSIONS.terms,
            privacyVersion: LEGAL_VERSIONS.privacy,
            termsAcceptedAt: expect.any(Date),
            privacyAcceptedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('rejects a stale legal version with 409 before creating anything', async () => {
      const service = buildService();

      await expect(
        service.signup({
          tenantName: 'X',
          email: 'a@b.com',
          password: PASSWORD,
          termsVersion: '1999-01-01',
          privacyVersion: LEGAL_VERSIONS.privacy,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(mockPrisma.tenant.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
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
        service.signup({ tenantName: 'X', email: 'dup@t.com', password: PASSWORD, ...LEGAL }),
      ).rejects.toMatchObject({ status: 409 });
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
      ).rejects.toMatchObject({ status: 401 });
    });

    it('rejects unknown user with same error (no enumeration)', async () => {
      const service = buildService();
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nope@x.com', password: PASSWORD }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('rejects inactive user', async () => {
      const service = buildService();
      mockPrisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.DELETED,
      });

      await expect(
        service.login({ email: 'a@b.com', password: PASSWORD }),
      ).rejects.toMatchObject({ status: 401 });
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

      await expect(service.me('u1', 't1')).rejects.toMatchObject({ status: 401 });
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
      ).rejects.toMatchObject({ status: 401 });
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

  describe('acceptLegal', () => {
    it('records current versions', async () => {
      const service = buildService();

      await service.acceptLegal('u1', LEGAL);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          termsVersion: LEGAL_VERSIONS.terms,
          privacyVersion: LEGAL_VERSIONS.privacy,
          termsAcceptedAt: expect.any(Date),
          privacyAcceptedAt: expect.any(Date),
        }),
      });
    });

    it('rejects an outdated version with 409', async () => {
      const service = buildService();

      await expect(
        service.acceptLegal('u1', { termsVersion: LEGAL_VERSIONS.terms, privacyVersion: '1999-01-01' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteAccount', () => {
    const user = { id: 'u1', tenantId: 't1', hasPassword: true, passwordHash: '' };

    beforeAll(async () => {
      user.passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    });

    it('stamps deletedAt, revokes tokens, soft-deletes the tenant and fails pending invoices when no other user remains', async () => {
      const service = buildService();
      mockPrisma.user.findFirst.mockResolvedValue(user);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.deleteAccount('u1', { password: PASSWORD });

      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { tenantId: 't1', id: { not: 'u1' }, status: { not: UserStatus.DELETED } },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { status: UserStatus.DELETED, deletedAt: expect.any(Date) },
      });
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revoked: false },
        data: { revoked: true },
      });
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { status: 'DELETED', deletedAt: expect.any(Date) },
      });
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', status: 'PENDING' },
        data: { status: 'FAILED' },
      });
    });

    it('keeps the tenant (and its invoices) when other users remain, suspended ones included', async () => {
      const service = buildService();
      mockPrisma.user.findFirst.mockResolvedValue({ ...user, role: UserRole.ADMIN });
      mockPrisma.user.count.mockResolvedValue(2);

      await service.deleteAccount('u1', { password: PASSWORD });

      expect(mockPrisma.user.update).toHaveBeenCalled();
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to delete an OWNER while other users remain (409), nothing written', async () => {
      const service = buildService();
      mockPrisma.user.findFirst.mockResolvedValue({ ...user, role: UserRole.OWNER });
      mockPrisma.user.count.mockResolvedValue(1);

      await expect(service.deleteAccount('u1', { password: PASSWORD })).rejects.toMatchObject({ status: 409 });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    });

    describe('Apple account (no password)', () => {
      const appleUser = { id: 'u1', tenantId: 't1', hasPassword: false, passwordHash: '', appleId: 'apple-sub-1' };
      const verify = appleSignin.verifyIdToken as jest.Mock;
      const dto = { appleIdentityToken: 'x'.repeat(30), appleNonce: 'nonce-1' };

      beforeEach(() => {
        verify.mockReset();
        mockConfig.get.mockImplementation((k: string) => (k === 'APPLE_CLIENT_ID' ? 'com.mikrolan.app' : undefined));
      });
      afterEach(() => mockConfig.get.mockImplementation(() => undefined));

      it('deletes the account when the Apple token matches the stored appleId', async () => {
        const service = buildService();
        mockPrisma.user.findFirst.mockResolvedValue(appleUser);
        mockPrisma.user.count.mockResolvedValue(0);
        verify.mockResolvedValue({ sub: 'apple-sub-1' });

        await service.deleteAccount('u1', dto);

        expect(verify).toHaveBeenCalledWith(
          dto.appleIdentityToken,
          expect.objectContaining({ nonce: expect.stringMatching(/^[0-9a-f]{64}$/) }),
        );
        expect(mockPrisma.user.update).toHaveBeenCalled();
      });

      it('rejects a token belonging to another Apple account (401), nothing deleted', async () => {
        const service = buildService();
        mockPrisma.user.findFirst.mockResolvedValue(appleUser);
        verify.mockResolvedValue({ sub: 'someone-else' });

        await expect(service.deleteAccount('u1', dto)).rejects.toMatchObject({ status: 401 });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      });

      it('rejects an invalid Apple token (401)', async () => {
        const service = buildService();
        mockPrisma.user.findFirst.mockResolvedValue(appleUser);
        verify.mockRejectedValue(new Error('bad signature'));

        await expect(service.deleteAccount('u1', dto)).rejects.toMatchObject({ status: 401 });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      });

      it('rejects an Apple account without stored appleId (401)', async () => {
        const service = buildService();
        mockPrisma.user.findFirst.mockResolvedValue({ ...appleUser, appleId: null });
        verify.mockResolvedValue({ sub: 'apple-sub-1' });

        await expect(service.deleteAccount('u1', dto)).rejects.toMatchObject({ status: 401 });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
      });
    });

    it('does not delete anything on a wrong password', async () => {
      const service = buildService();
      mockPrisma.user.findFirst.mockResolvedValue(user);

      await expect(service.deleteAccount('u1', { password: 'wrong-password' })).rejects.toMatchObject({
        status: 401,
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
