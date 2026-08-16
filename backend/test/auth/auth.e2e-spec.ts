import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { MailService } from '../../src/modules/mail/mail.service';

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let mailService: MailService;

  beforeAll(async () => {
    app = await createTestApp();
    mailService = app.get(MailService);
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
        .send({ tenantName: 'Dup', email, password: 'SecurePass123!' })
        .expect(409);
    });

    it('rejects short password with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({
          tenantName: 'X',
          email: `short-${Date.now()}@test.com`,
          password: 'abc',
        })
        .expect(400);
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
