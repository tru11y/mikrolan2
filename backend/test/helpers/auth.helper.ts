import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';

export async function signupUser(
  app: NestFastifyApplication,
  overrides: Partial<{
    tenantName: string;
    email: string;
    password: string;
  }> = {},
) {
  const payload = {
    tenantName: overrides.tenantName ?? 'Test Tenant',
    email: overrides.email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: overrides.password ?? 'SecurePass123!',
  };
  const res = await request(app.getHttpServer())
    .post('/api/auth/signup')
    .send(payload)
    .expect(201);
  return { ...res.body.data, ...payload };
}

export async function loginUser(
  app: NestFastifyApplication,
  email: string,
  password: string,
) {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.data as { accessToken: string; refreshToken: string };
}
