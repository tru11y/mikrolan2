import { TokenService } from './token.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { UserRole } from '@prisma/client';

const TTL = { JWT_ACCESS_TTL: 900, JWT_REFRESH_TTL: 2_592_000, JWT_ACCESS_SECRET: 'secret' };

function build() {
  const prisma = {
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') };
  const config = { get: jest.fn((k: keyof typeof TTL) => TTL[k]) };
  const service = new TokenService(prisma as never, jwt as never, config as never);
  return { service, prisma, jwt };
}

const user = { id: 'u1', tenantId: 't1', role: UserRole.OWNER };

function token(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    userId: 'u1',
    family: 'fam',
    revoked: false,
    replacedById: null,
    expiresAt: new Date(Date.now() + 1_000_000),
    createdAt: new Date(),
    user,
    ...over,
  };
}

describe('TokenService.rotate', () => {
  it('rotates a valid token and links the successor', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique.mockResolvedValueOnce(token());
    prisma.refreshToken.create.mockResolvedValueOnce({ id: 'r2' });

    const pair = await service.rotate('raw');

    expect(pair.accessToken).toBe('access.jwt');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { revoked: true, replacedById: 'r2' },
    });
  });

  it('rejects an unknown token', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
    await expect(service.rotate('raw')).rejects.toMatchObject({
      errorCode: ErrorCode.AUTH_TOKEN_INVALID,
    } as Partial<BusinessException>);
  });

  it('rejects an expired token', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique.mockResolvedValueOnce(
      token({ expiresAt: new Date(Date.now() - 1) }),
    );
    await expect(service.rotate('raw')).rejects.toMatchObject({
      errorCode: ErrorCode.AUTH_TOKEN_EXPIRED,
    });
  });

  it('recovers a lost-response retry within the grace window', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique
      .mockResolvedValueOnce(token({ revoked: true, replacedById: 'r2' })) // replayed predecessor
      .mockResolvedValueOnce(
        token({ id: 'r2', revoked: false, createdAt: new Date(Date.now() - 5_000) }),
      ); // fresh, unused successor
    prisma.refreshToken.create.mockResolvedValueOnce({ id: 'r3' });

    const pair = await service.rotate('raw');

    expect(pair.accessToken).toBe('access.jwt');
    // successor claimed atomically, no family-wide revocation
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'r2', revoked: false },
      data: { revoked: true },
    });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalledWith({
      where: { family: 'fam', revoked: false },
      data: { revoked: true },
    });
  });

  it('revokes the family when the successor is already consumed (true reuse)', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique
      .mockResolvedValueOnce(token({ revoked: true, replacedById: 'r2' }))
      .mockResolvedValueOnce(token({ id: 'r2', revoked: true }));

    await expect(service.rotate('raw')).rejects.toMatchObject({
      errorCode: ErrorCode.AUTH_TOKEN_REUSE,
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { family: 'fam', revoked: false },
      data: { revoked: true },
    });
  });

  it('revokes the family when the grace window has elapsed', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique
      .mockResolvedValueOnce(token({ revoked: true, replacedById: 'r2' }))
      .mockResolvedValueOnce(
        token({ id: 'r2', revoked: false, createdAt: new Date(Date.now() - 120_000) }),
      );

    await expect(service.rotate('raw')).rejects.toMatchObject({
      errorCode: ErrorCode.AUTH_TOKEN_REUSE,
    });
  });

  it('revokes the family when a concurrent replay already claimed the successor', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique
      .mockResolvedValueOnce(token({ revoked: true, replacedById: 'r2' }))
      .mockResolvedValueOnce(
        token({ id: 'r2', revoked: false, createdAt: new Date(Date.now() - 1_000) }),
      );
    prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 }); // lost the claim race

    await expect(service.rotate('raw')).rejects.toMatchObject({
      errorCode: ErrorCode.AUTH_TOKEN_REUSE,
    });
  });

  it('revokes the family for a legacy revoked token with no successor link', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique.mockResolvedValueOnce(
      token({ revoked: true, replacedById: null }),
    );
    await expect(service.rotate('raw')).rejects.toMatchObject({
      errorCode: ErrorCode.AUTH_TOKEN_REUSE,
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { family: 'fam', revoked: false },
      data: { revoked: true },
    });
  });
});
