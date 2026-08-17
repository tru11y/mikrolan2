import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

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

/**
 * Il n'existe pas de route pour créer un SUPER_ADMIN — c'est un rôle
 * plateforme, jamais attribuable via signup. On le pose directement en base,
 * puis on relogue : le rôle est figé dans le JWT à l'émission (token.service.ts).
 */
export async function promoteToSuperAdmin(
  app: NestFastifyApplication,
  email: string,
  password: string,
) {
  const prisma = app.get(PrismaService);
  await prisma.user.update({
    where: { email },
    data: { role: UserRole.SUPER_ADMIN },
  });
  return loginUser(app, email, password);
}
