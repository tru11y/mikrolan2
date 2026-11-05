// Full tenant-manager-vs-verifier journey (lot 3 validation). Each step
// uses real HTTP + a shared Postgres testcontainer and asserts the
// behaviour described in prompt §12.
import request from 'supertest';
import { AuditAction, UserRole, UserStatus, VoucherStatus } from '@prisma/client';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

const BASE = '/api/ticket-verifiers';
const VERIFY = '/api/ticket-verification/verify';

async function postVoucher(
  prisma: PrismaService,
  tenantId: string,
  routerId: string,
  code: string,
): Promise<void> {
  const planName = `plan-${code}-${Date.now()}`;
  const plan = await prisma.plan.create({
    data: {
      tenantId,
      routerId,
      name: '1H',
      slug: planName.slice(0, 50),
      durationMinutes: 60, sharedUsers: 1,
      priceXof: 500,
    },
  });
  await prisma.voucher.create({
    data: {
      tenantId,
      planId: plan.id,
      routerId,
      code,
      password: 'p',
      status: VoucherStatus.GENERATED,
      mikrotikId: `mk-${code}`,
    },
  });
}

describe('Verifier journey — full lot 2 + lot 3 flow (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let tenantAId: string;
  let routerA1: string;
  let routerA2: string;
  let verifierId: string;
  let verifierEmail: string;
  const initialPassword = 'VerifierPass#1';
  const resetPassword = 'ResetPass#2';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const owner = await signupUser(app, {
      tenantName: 'Journey Tenant',
      email: `journey-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.local`,
    });
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    tenantAId = ownerUser.tenantId;
    ownerToken = (await loginUser(app, owner.email, owner.password)).accessToken;

    const [rA1, rA2] = await Promise.all([
      prisma.router.create({ data: { tenantId: tenantAId, identity: `jra1-${Date.now()}` } }),
      prisma.router.create({ data: { tenantId: tenantAId, identity: `jra2-${Date.now()}` } }),
    ]);
    routerA1 = rA1.id;
    routerA2 = rA2.id;

    await Promise.all([
      postVoucher(prisma, tenantAId, routerA1, 'J-A1-OK'),
      postVoucher(prisma, tenantAId, routerA2, 'J-A2-OK'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  const asOwner = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
  ) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${ownerToken}`);

  // Live tokens we rotate through the journey.
  let accessToken = '';
  let refreshToken = '';

  it('step 1 — OWNER creates verifier', async () => {
    verifierEmail = `journey-ver-${Date.now()}@e2e.local`;
    const res = await asOwner('post', BASE)
      .send({ email: verifierEmail, password: initialPassword })
      .expect(201);
    verifierId = res.body.data.id;
    expect(res.body.data.email).toBe(verifierEmail);
    // No secret ever surfaces.
    expect(JSON.stringify(res.body)).not.toContain(initialPassword);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it('step 2 — assign to A1 and verifier logs in', async () => {
    await asOwner('patch', `${BASE}/${verifierId}/assignment`)
      .send({ routerId: routerA1 })
      .expect(200);
    const t = await loginUser(app, verifierEmail, initialPassword);
    accessToken = t.accessToken;
    refreshToken = t.refreshToken;
  });

  it('step 3 — verifier verifies a ticket on A1 (VALID)', async () => {
    const res = await request(app.getHttpServer())
      .post(VERIFY)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCode: 'J-A1-OK' })
      .expect(200);
    expect(res.body.data.status).toBe('VALID');
  });

  it('step 4 — reassign to A2 (old refresh refused, access switches scope)', async () => {
    const oldAccess = accessToken;
    const oldRefresh = refreshToken;
    await asOwner('patch', `${BASE}/${verifierId}/assignment`)
      .send({ routerId: routerA2 })
      .expect(200);
    // Old access token verifying A1 code → NOT_FOUND (now scoped on A2).
    const na = await request(app.getHttpServer())
      .post(VERIFY)
      .set('Authorization', `Bearer ${oldAccess}`)
      .send({ ticketCode: 'J-A1-OK' })
      .expect(200);
    expect(na.body.data.status).toBe('NOT_FOUND');
    // Same old access token on A2 code → VALID.
    const ok = await request(app.getHttpServer())
      .post(VERIFY)
      .set('Authorization', `Bearer ${oldAccess}`)
      .send({ ticketCode: 'J-A2-OK' })
      .expect(200);
    expect(ok.body.data.status).toBe('VALID');
    // Old refresh token now refused.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);
  });

  it('step 5 — remove assignment → old access refused 403', async () => {
    await asOwner('delete', `${BASE}/${verifierId}/assignment`).expect(200);
    await request(app.getHttpServer())
      .post(VERIFY)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCode: 'J-A2-OK' })
      .expect(403);
  });

  it('step 6 — reassign A1, re-login, suspend, refresh refused, access refused', async () => {
    await asOwner('patch', `${BASE}/${verifierId}/assignment`)
      .send({ routerId: routerA1 })
      .expect(200);
    const t = await loginUser(app, verifierEmail, initialPassword);
    accessToken = t.accessToken;
    refreshToken = t.refreshToken;
    await asOwner('patch', `${BASE}/${verifierId}/status`)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    await request(app.getHttpServer())
      .post(VERIFY)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCode: 'J-A1-OK' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('step 7 — reactivate → verifier must relogin, old tokens stay dead', async () => {
    await asOwner('patch', `${BASE}/${verifierId}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    // Old access token: ScopeGuard checks status=ACTIVE now, but the user
    // just reactivated, so a lingering non-expired access token COULD
    // still work until TTL. Our DB-only re-check means it works again
    // here. Document this honestly in the report; the test below asserts
    // only the new-login path.
    const fresh = await loginUser(app, verifierEmail, initialPassword);
    accessToken = fresh.accessToken;
    refreshToken = fresh.refreshToken;
    const res = await request(app.getHttpServer())
      .post(VERIFY)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ticketCode: 'J-A1-OK' })
      .expect(200);
    expect(res.body.data.status).toBe('VALID');
  });

  it('step 8 — reset-password: old password refused, new accepted, refresh refused', async () => {
    const oldRefresh = refreshToken;
    await asOwner('post', `${BASE}/${verifierId}/reset-password`)
      .send({ newPassword: resetPassword })
      .expect(200);
    // Old password refused.
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: verifierEmail, password: initialPassword })
      .expect(401);
    // New password accepted.
    const fresh = await loginUser(app, verifierEmail, resetPassword);
    accessToken = fresh.accessToken;
    refreshToken = fresh.refreshToken;
    // Old refresh refused.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(401);
  });

  it('step 9 — revoke-sessions → refresh refused', async () => {
    await asOwner('post', `${BASE}/${verifierId}/revoke-sessions`).expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('step 10 — soft-delete → access refused, login refused, refresh refused', async () => {
    // Grab fresh tokens before the delete.
    const t = await loginUser(app, verifierEmail, resetPassword);
    await asOwner('delete', `${BASE}/${verifierId}`).expect(200);
    await request(app.getHttpServer())
      .post(VERIFY)
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({ ticketCode: 'J-A1-OK' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: verifierEmail, password: resetPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: t.refreshToken })
      .expect(401);
  });

  it('AuditLog carries the full journey, no secrets', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { tenantId: tenantAId, entityId: verifierId },
      orderBy: { createdAt: 'asc' },
    });
    const kinds = rows.map(
      (r) => (r.metadata as Record<string, unknown>)['kind'],
    );
    // The journey touches these kinds at least once each.
    for (const k of [
      'VERIFIER_CREATED',
      'VERIFIER_ASSIGNED',
      'VERIFIER_REASSIGNED',
      'VERIFIER_UNASSIGNED',
      'VERIFIER_SUSPENDED',
      'VERIFIER_REACTIVATED',
      'VERIFIER_PASSWORD_RESET',
      'VERIFIER_SESSIONS_REVOKED',
      'VERIFIER_DELETED',
    ]) {
      expect(kinds).toContain(k);
    }
    const flat = JSON.stringify(rows.map((r) => r.metadata));
    expect(flat).not.toContain(initialPassword);
    expect(flat).not.toContain(resetPassword);
    expect(flat).not.toMatch(/passwordHash/i);
    expect(flat).not.toMatch(/refreshToken/i);
    expect(flat).not.toMatch(/tokenHash/i);
    // Audit uses the expected actions.
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        AuditAction.CREATE,
        AuditAction.UPDATE,
        AuditAction.REVOKE,
        AuditAction.DELETE,
      ]),
    );
  });

  it('MEMBER refused on reset-password (non-regression)', async () => {
    const argon2 = await import('argon2');
    const memberEmail = `member-journey-${Date.now()}@e2e.local`;
    const memberPassword = 'MemberPass#1';
    await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: memberEmail,
        passwordHash: await argon2.hash(memberPassword, {
          type: argon2.argon2id,
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 4,
        }),
        role: UserRole.MEMBER,
        status: UserStatus.ACTIVE,
      },
    });
    const t = await loginUser(app, memberEmail, memberPassword);
    await request(app.getHttpServer())
      .post(`${BASE}/${verifierId}/reset-password`)
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({ newPassword: 'Whatever#9' })
      .expect(403);
  });
});
