import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { generateTotpSecret, totpAt } from './totp';
import { ErrorCode } from '../../common/error-codes';

const crypto = {
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ''),
};

const PASSWORD = 'Sup3r-Secret-pass!';
const SECRET = generateTotpSecret();
let passwordHash: string;

const now = () => Math.floor(Date.now() / 1000 / 30);

function setup(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 'u1',
    email: 'a@b.co',
    tenantId: 't1',
    role: 'OWNER',
    status: 'ACTIVE',
    hasPassword: true,
    passwordHash,
    totpSecretEnc: `enc:${SECRET}`,
    totpEnabledAt: new Date(),
    ...overrides,
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      findFirst: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const tokens = {
    issueTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }),
  };
  const mfa = new MfaService(prisma as never, crypto as never);
  const auth = new AuthService(
    prisma as never,
    tokens as never,
    {} as never,
    { get: jest.fn() } as never,
    {} as never,
    mfa,
  );
  return { auth, mfa, prisma, tokens };
}

beforeAll(async () => {
  passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 });
});

describe('login avec MFA', () => {
  it('mot de passe OK sans code → AUTH_MFA_REQUIRED, aucun jeton émis', async () => {
    const { auth, tokens } = setup();
    await expect(auth.login({ email: 'a@b.co', password: PASSWORD })).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: ErrorCode.AUTH_MFA_REQUIRED }),
    });
    expect(tokens.issueTokens).not.toHaveBeenCalled();
  });

  it('mot de passe OK + mauvais code → AUTH_MFA_INVALID, aucun jeton émis', async () => {
    const { auth, tokens } = setup();
    const wrong = totpAt(SECRET, now() + 10);
    await expect(auth.login({ email: 'a@b.co', password: PASSWORD, totpCode: wrong })).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: ErrorCode.AUTH_MFA_INVALID }),
    });
    expect(tokens.issueTokens).not.toHaveBeenCalled();
  });

  it('mauvais mot de passe + bon code → refusé (le code ne remplace pas le mot de passe)', async () => {
    const { auth, tokens } = setup();
    await expect(
      auth.login({ email: 'a@b.co', password: 'wrong-password', totpCode: totpAt(SECRET, now()) }),
    ).rejects.toBeDefined();
    expect(tokens.issueTokens).not.toHaveBeenCalled();
  });

  it('mot de passe OK + bon code → jetons émis', async () => {
    const { auth, tokens } = setup();
    await expect(
      auth.login({ email: 'a@b.co', password: PASSWORD, totpCode: totpAt(SECRET, now()) }),
    ).resolves.toMatchObject({ accessToken: 'a' });
    expect(tokens.issueTokens).toHaveBeenCalledTimes(1);
  });

  it('compte sans MFA → connexion inchangée', async () => {
    const { auth } = setup({ totpEnabledAt: null, totpSecretEnc: null });
    await expect(auth.login({ email: 'a@b.co', password: PASSWORD })).resolves.toMatchObject({ accessToken: 'a' });
  });

  it('secret en attente (setup sans enable) → MFA non exigée', async () => {
    const { auth } = setup({ totpEnabledAt: null });
    await expect(auth.login({ email: 'a@b.co', password: PASSWORD })).resolves.toBeDefined();
  });
});

describe('cycle setup → enable → disable', () => {
  it('setup stocke un secret chiffré et renvoie l’URL otpauth', async () => {
    const { mfa, prisma } = setup({ totpEnabledAt: null, totpSecretEnc: null });
    const res = await mfa.setup('u1');
    expect(res.otpauthUrl).toContain(`secret=${res.secret}`);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { totpSecretEnc: `enc:${res.secret}` } }),
    );
  });

  it('setup refusé si la MFA est déjà active', async () => {
    const { mfa } = setup();
    await expect(mfa.setup('u1')).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: ErrorCode.AUTH_MFA_ALREADY_ENABLED }),
    });
  });

  it('enable refuse un mauvais code, accepte le bon et révoque les sessions', async () => {
    const { mfa, prisma } = setup({ totpEnabledAt: null });
    await expect(mfa.enable('u1', totpAt(SECRET, now() + 10))).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: ErrorCode.AUTH_MFA_INVALID }),
    });
    await expect(mfa.enable('u1', totpAt(SECRET, now()))).resolves.toEqual({ enabled: true });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('disable exige mot de passe ET code valides', async () => {
    const { mfa, prisma } = setup();
    await expect(mfa.disable('u1', 'wrong', totpAt(SECRET, now()))).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: ErrorCode.AUTH_WRONG_PASSWORD }),
    });
    await expect(mfa.disable('u1', PASSWORD, totpAt(SECRET, now() + 10))).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: ErrorCode.AUTH_MFA_INVALID }),
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    await expect(mfa.disable('u1', PASSWORD, totpAt(SECRET, now()))).resolves.toEqual({ enabled: false });
  });
});
