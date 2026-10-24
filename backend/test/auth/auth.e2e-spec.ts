import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { MailService } from '../../src/modules/mail/mail.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { LEGACY_LEGAL_VERSION, LEGAL_VERSIONS } from '../../src/modules/legal/legal.versions';

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let mailService: MailService;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    mailService = app.get(MailService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/auth/signup', () => {
    it('creates user and tenant, returns tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({
          tenantName: 'Acme',
          email: `acme-${Date.now()}@test.com`,
          password: 'SecurePass123!',
          termsVersion: LEGAL_VERSIONS.terms,
          privacyVersion: LEGAL_VERSIONS.privacy,
        })
        .expect(201);

      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
    });

    it('rejects duplicate email with 409', async () => {
      const email = `dup-${Date.now()}@test.com`;
      await signupUser(app, { email });

      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({
          tenantName: 'Dup',
          email,
          password: 'SecurePass123!',
          termsVersion: LEGAL_VERSIONS.terms,
          privacyVersion: LEGAL_VERSIONS.privacy,
        })
        .expect(409);
    });

    it('rejects short password with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({
          tenantName: 'X',
          email: `short-${Date.now()}@test.com`,
          password: 'abc',
          termsVersion: LEGAL_VERSIONS.terms,
          privacyVersion: LEGAL_VERSIONS.privacy,
        })
        .expect(400);
    });

    it('accepts a legacy client signup (no versions) and records consent as legacy', async () => {
      const email = `legacy-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({ tenantName: 'Legacy', email, password: 'SecurePass123!' })
        .expect(201);

      const row = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(row.termsVersion).toBe(LEGACY_LEGAL_VERSION);
      expect(row.privacyVersion).toBe(LEGACY_LEGAL_VERSION);
      expect(row.termsAcceptedAt).toBeNull();
      expect(row.privacyAcceptedAt).toBeNull();
    });

    it('rejects a single legal version without its pair with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({
          tenantName: 'Half',
          email: `half-${Date.now()}@test.com`,
          password: 'SecurePass123!',
          termsVersion: LEGAL_VERSIONS.terms,
        })
        .expect(400);
    });

    it('rejects a stale legal version with 409 and creates no account', async () => {
      const email = `stale-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({
          tenantName: 'Stale',
          email,
          password: 'SecurePass123!',
          termsVersion: '1999-01-01',
          privacyVersion: LEGAL_VERSIONS.privacy,
        })
        .expect(409);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'SecurePass123!' })
        .expect(401);
    });

    it('records the accepted versions on the user', async () => {
      const u = await signupUser(app);
      const row = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      expect(row.termsVersion).toBe(LEGAL_VERSIONS.terms);
      expect(row.privacyVersion).toBe(LEGAL_VERSIONS.privacy);
      expect(row.termsAcceptedAt).toBeInstanceOf(Date);
      expect(row.privacyAcceptedAt).toBeInstanceOf(Date);
    });
  });

  describe('POST /api/auth/legal-consent', () => {
    it('refuses a stale version then accepts the current one', async () => {
      const u = await signupUser(app);
      await request(app.getHttpServer())
        .post('/api/auth/legal-consent')
        .set('Authorization', `Bearer ${u.accessToken}`)
        .send({ termsVersion: '1999-01-01', privacyVersion: LEGAL_VERSIONS.privacy })
        .expect(409);
      await request(app.getHttpServer())
        .post('/api/auth/legal-consent')
        .set('Authorization', `Bearer ${u.accessToken}`)
        .send({ termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy })
        .expect(200);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns tokens for valid credentials', async () => {
      const u = await signupUser(app);
      const res = await loginUser(app, u.email, u.password);
      expect(res).toHaveProperty('accessToken');
      expect(res).toHaveProperty('refreshToken');
    });

    it('rejects wrong password with 401', async () => {
      const u = await signupUser(app);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: u.email, password: 'WrongPassword1!' })
        .expect(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('issues new token pair from valid refresh token', async () => {
      const u = await signupUser(app);
      const login = await loginUser(app, u.email, u.password);

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: login.refreshToken })
        .expect(200);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).not.toBe(login.refreshToken);
    });

    it('rejects invalid refresh token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'a]'.padEnd(64, '0') })
        .expect(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns current user with valid token', async () => {
      const u = await signupUser(app);
      const login = await loginUser(app, u.email, u.password);

      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.accessToken}`)
        .expect(200);

      expect(res.body.data.user).toHaveProperty('email', u.email);
    });

    it('rejects unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .expect(401);
    });
  });

  describe('POST /api/vouchers/verify', () => {
    it('unknown ticket is 404 VOUCHER_NOT_FOUND, invalid JWT stays 401', async () => {
      const u = await signupUser(app);
      const login = await loginUser(app, u.email, u.password);

      const unknown = await request(app.getHttpServer())
        .post('/api/vouchers/verify')
        .set('Authorization', `Bearer ${login.accessToken}`)
        .send({ ticket: 'ZZ-SYNTH-0000' })
        .expect(404);
      expect(unknown.body.errorCode).toBe('VOUCHER_NOT_FOUND');

      await request(app.getHttpServer())
        .post('/api/vouchers/verify')
        .set('Authorization', 'Bearer not-a-valid-jwt')
        .send({ ticket: 'ZZ-SYNTH-0000' })
        .expect(401);
    });
  });

  describe('Password reset flow', () => {
    it('request always returns 200 (prevents email enumeration)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/password-reset/request')
        .send({ email: 'nonexistent@test.com' })
        .expect(200);
    });

    it('full flow: request → capture code from mail mock → confirm → login with new password', async () => {
      const u = await signupUser(app);

      await request(app.getHttpServer())
        .post('/api/auth/password-reset/request')
        .send({ email: u.email })
        .expect(200);

      const mockSend = mailService.sendPasswordReset as jest.Mock;
      const lastCall = mockSend.mock.calls[mockSend.mock.calls.length - 1];
      expect(lastCall).toBeDefined();
      const [, code] = lastCall;

      const newPassword = 'NewSecurePass456!';
      await request(app.getHttpServer())
        .post('/api/auth/password-reset/confirm')
        .send({ email: u.email, code, newPassword })
        .expect(200);

      await loginUser(app, u.email, newPassword);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('invalidates the refresh token', async () => {
      const u = await signupUser(app);
      const login = await loginUser(app, u.email, u.password);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .send({ refreshToken: login.refreshToken })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: login.refreshToken })
        .expect(401);
    });
  });
});
