import request from 'supertest';
import { AuditAction, UserRole, UserStatus } from '@prisma/client';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

const BASE = '/api/ticket-verifiers';

interface Seed {
  ownerA: { email: string; password: string; token: string; userId: string };
  memberA: { email: string; password: string; token: string };
  ownerB: { email: string; password: string; token: string };
  tenantAId: string;
  tenantBId: string;
  routerA1: string;
  routerA2: string;
  routerB1: string;
}

async function seed(app: NestFastifyApplication): Promise<Seed> {
  const prisma = app.get(PrismaService);

  const ownerA = await signupUser(app, {
    tenantName: 'Tenant A',
    email: `owner-a-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.local`,
  });
  const ownerAUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerA.email } });

  const ownerB = await signupUser(app, {
    tenantName: 'Tenant B',
    email: `owner-b-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.local`,
  });
  const ownerBUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerB.email } });

  // MEMBER in tenant A: pose en DB puis login.
  const memberPassword = 'MemberPass#1';
  const memberEmail = `member-a-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.local`;
  const argon2 = await import('argon2');
  await prisma.user.create({
    data: {
      tenantId: ownerAUser.tenantId,
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

  const memberTokens = await loginUser(app, memberEmail, memberPassword);
  const ownerATokens = await loginUser(app, ownerA.email, ownerA.password);
  const ownerBTokens = await loginUser(app, ownerB.email, ownerB.password);

  // Routers.
  const [rA1, rA2, rB1] = await Promise.all([
    prisma.router.create({ data: { tenantId: ownerAUser.tenantId, identity: `ra1-${Date.now()}` } }),
    prisma.router.create({ data: { tenantId: ownerAUser.tenantId, identity: `ra2-${Date.now()}` } }),
    prisma.router.create({ data: { tenantId: ownerBUser.tenantId, identity: `rb1-${Date.now()}` } }),
  ]);

  return {
    ownerA: { email: ownerA.email, password: ownerA.password, token: ownerATokens.accessToken, userId: ownerAUser.id },
    memberA: { email: memberEmail, password: memberPassword, token: memberTokens.accessToken },
    ownerB: { email: ownerB.email, password: ownerB.password, token: ownerBTokens.accessToken },
    tenantAId: ownerAUser.tenantId,
    tenantBId: ownerBUser.tenantId,
    routerA1: rA1.id,
    routerA2: rA2.id,
    routerB1: rB1.id,
  };
}

describe('Ticket verifiers CRUD (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let s: Seed;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    s = await seed(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const mk = (getToken: () => string) => ({
    get: (p: string) =>
      request(app.getHttpServer()).get(p).set('Authorization', `Bearer ${getToken()}`),
    post: (p: string) =>
      request(app.getHttpServer()).post(p).set('Authorization', `Bearer ${getToken()}`),
    patch: (p: string) =>
      request(app.getHttpServer()).patch(p).set('Authorization', `Bearer ${getToken()}`),
    delete: (p: string) =>
      request(app.getHttpServer()).delete(p).set('Authorization', `Bearer ${getToken()}`),
  });
  const asOwnerA = () => mk(() => s.ownerA.token);
  const asOwnerB = () => mk(() => s.ownerB.token);
  const asMemberA = () => mk(() => s.memberA.token);

  // Each test uses its own email; collect them so later tests can look them up.
  let primaryVerifier: { id: string; email: string; password: string };

  describe('authorization', () => {
    it('401 without JWT', async () => {
      await request(app.getHttpServer()).get(BASE).expect(401);
    });

    it('403 for MEMBER (RolesGuard refuses rank < ADMIN)', async () => {
      await asMemberA().get(BASE).expect(403);
    });

    it('OWNER can create', async () => {
      const email = `v1-${Date.now()}@e2e.local`;
      const password = 'VerifPass#1';
      const res = await asOwnerA()
        .post(BASE)
        .send({ email, password, name: 'Vendeur 1' })
        .expect(201);
      expect(res.body.data).toEqual(
        expect.objectContaining({
          email,
          name: 'Vendeur 1',
          status: UserStatus.ACTIVE,
          assignment: null,
        }),
      );
      expect(res.body.data.id).toBeDefined();
      primaryVerifier = { id: res.body.data.id, email, password };
    });

    it('role / tenantId forced on create (body cannot escalate)', async () => {
      const email = `escalate-${Date.now()}@e2e.local`;
      await asOwnerA()
        .post(BASE)
        .send({ email, password: 'LongPass#1', role: 'OWNER' })
        .expect(400); // Zod strict refuses the field.
      // Create a legit one, then verify its DB rows.
      await asOwnerA().post(BASE).send({ email, password: 'LongPass#1' }).expect(201);
      const u = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(u.role).toBe(UserRole.TICKET_VERIFIER);
      expect(u.tenantId).toBe(s.tenantAId);
    });

    it('TICKET_VERIFIER cannot access the CRUD', async () => {
      // Log in as the primary verifier we just created.
      const { accessToken } = await loginUser(
        app,
        primaryVerifier.email,
        primaryVerifier.password,
      );
      await request(app.getHttpServer())
        .get(BASE)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post(BASE)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: 'x@x', password: 'LongPass#1' })
        .expect(403);
    });
  });

  describe('ADMIN role coverage (lot 4)', () => {
    // Validates that the controller's @Roles(ADMIN) grants ADMIN the same
    // tenant-scoped capabilities as OWNER — same set of writes.
    let adminToken: string;
    let targetVerifierId: string;
    let targetVerifierEmail: string;
    let bVerifierId: string;

    beforeAll(async () => {
      const argon2 = await import('argon2');
      const adminPassword = 'AdminPass#1';
      const adminEmail = `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.local`;
      await prisma.user.create({
        data: {
          tenantId: s.tenantAId,
          email: adminEmail,
          passwordHash: await argon2.hash(adminPassword, {
            type: argon2.argon2id,
            memoryCost: 65536,
            timeCost: 3,
            parallelism: 4,
          }),
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        },
      });
      adminToken = (await loginUser(app, adminEmail, adminPassword)).accessToken;
      // Seed a verifier in tenant B so ADMIN of A cannot touch it.
      const bRes = await request(app.getHttpServer())
        .post(BASE)
        .set('Authorization', `Bearer ${s.ownerB.token}`)
        .send({ email: `vb-admin-${Date.now()}@e2e.local`, password: 'LongPass#1' })
        .expect(201);
      bVerifierId = bRes.body.data.id;
    });

    const asAdmin = {
      get: (p: string) => request(app.getHttpServer()).get(p).set('Authorization', `Bearer ${adminToken}`),
      post: (p: string) => request(app.getHttpServer()).post(p).set('Authorization', `Bearer ${adminToken}`),
      patch: (p: string) => request(app.getHttpServer()).patch(p).set('Authorization', `Bearer ${adminToken}`),
      delete: (p: string) => request(app.getHttpServer()).delete(p).set('Authorization', `Bearer ${adminToken}`),
    };

    it('ADMIN creates a verifier in own tenant', async () => {
      targetVerifierEmail = `v-admin-${Date.now()}@e2e.local`;
      const res = await asAdmin
        .post(BASE)
        .send({ email: targetVerifierEmail, password: 'LongPass#1' })
        .expect(201);
      targetVerifierId = res.body.data.id;
    });

    it('ADMIN lists verifiers (tenant A)', async () => {
      const res = await asAdmin.get(BASE).expect(200);
      const ids = (res.body.data.items as Array<{ id: string }>).map((x) => x.id);
      expect(ids).toContain(targetVerifierId);
      expect(ids).not.toContain(bVerifierId);
    });

    it('ADMIN assigns A1', async () => {
      await asAdmin
        .patch(`${BASE}/${targetVerifierId}/assignment`)
        .send({ routerId: s.routerA1 })
        .expect(200);
    });

    it('ADMIN suspends then reactivates', async () => {
      await asAdmin
        .patch(`${BASE}/${targetVerifierId}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(200);
      await asAdmin
        .patch(`${BASE}/${targetVerifierId}/status`)
        .send({ status: 'ACTIVE' })
        .expect(200);
    });

    it('ADMIN resets password', async () => {
      await asAdmin
        .post(`${BASE}/${targetVerifierId}/reset-password`)
        .send({ newPassword: 'NewLongPass#2' })
        .expect(200);
    });

    it('ADMIN revokes sessions', async () => {
      await asAdmin
        .post(`${BASE}/${targetVerifierId}/revoke-sessions`)
        .expect(200);
    });

    it('ADMIN of A cannot touch verifier of tenant B (404 generic)', async () => {
      await asAdmin.get(`${BASE}/${bVerifierId}`).expect(404);
      await asAdmin.patch(`${BASE}/${bVerifierId}/status`).send({ status: 'SUSPENDED' }).expect(404);
      await asAdmin.post(`${BASE}/${bVerifierId}/reset-password`).send({ newPassword: 'LongPass#1' }).expect(404);
      await asAdmin.delete(`${BASE}/${bVerifierId}`).expect(404);
    });

    it('ADMIN of A cannot assign to router of tenant B', async () => {
      const res = await asAdmin
        .patch(`${BASE}/${targetVerifierId}/assignment`)
        .send({ routerId: s.routerB1 })
        .expect(404);
      expect(res.body.errorCode).toBe('VERIFIER_ROUTER_FOREIGN');
    });
  });

  describe('tenant isolation', () => {
    let bVerifierId: string;

    beforeAll(async () => {
      // Create a verifier in tenant B so A can't see/modify it.
      const res = await asOwnerB()
        .post(BASE)
        .send({ email: `vb-${Date.now()}@e2e.local`, password: 'VerifPass#1' })
        .expect(201);
      bVerifierId = res.body.data.id;
    });

    it('listing from A does not include verifiers of B', async () => {
      const res = await asOwnerA().get(BASE).expect(200);
      const ids = (res.body.data.items as Array<{ id: string }>).map((x) => x.id);
      expect(ids).not.toContain(bVerifierId);
    });

    it('A cannot read a verifier of B (404 generic)', async () => {
      const res = await asOwnerA().get(`${BASE}/${bVerifierId}`).expect(404);
      expect(res.body.errorCode).toBe('VERIFIER_NOT_FOUND');
    });

    it('A cannot patch a verifier of B', async () => {
      await asOwnerA()
        .patch(`${BASE}/${bVerifierId}`)
        .send({ name: 'HACKED' })
        .expect(404);
    });

    it('A cannot assign its verifier to router B1', async () => {
      const res = await asOwnerA()
        .patch(`${BASE}/${primaryVerifier.id}/assignment`)
        .send({ routerId: s.routerB1 })
        .expect(404);
      expect(res.body.errorCode).toBe('VERIFIER_ROUTER_FOREIGN');
    });

    it('A cannot delete a verifier of B', async () => {
      await asOwnerA().delete(`${BASE}/${bVerifierId}`).expect(404);
    });
  });

  describe('DTO strictness', () => {
    it.each(['role', 'tenantId', 'status', 'passwordHash', 'assignedById', 'userId', 'refreshToken'])(
      '400 when create body carries %s',
      async (field) => {
        await asOwnerA()
          .post(BASE)
          .send({
            email: `strict-${field}-${Date.now()}@e2e.local`,
            password: 'LongPass#1',
            [field]: 'anything',
          })
          .expect(400);
      },
    );

    it('400 when assignment body is missing routerId', async () => {
      await asOwnerA()
        .patch(`${BASE}/${primaryVerifier.id}/assignment`)
        .send({})
        .expect(400);
    });

    it('400 on duplicate email → 409 VERIFIER_EMAIL_TAKEN', async () => {
      await asOwnerA()
        .post(BASE)
        .send({ email: primaryVerifier.email, password: 'LongPass#1' })
        .expect(409);
    });
  });

  describe('assignment / reassignment / removal — token invalidation', () => {
    let verifier: { id: string; email: string; password: string };
    let accessToken: string;
    let refreshToken: string;

    beforeAll(async () => {
      const email = `assign-${Date.now()}@e2e.local`;
      const password = 'VerifPass#1';
      const res = await asOwnerA()
        .post(BASE)
        .send({ email, password })
        .expect(201);
      verifier = { id: res.body.data.id, email, password };
      // Initial assignment on A1.
      await asOwnerA()
        .patch(`${BASE}/${verifier.id}/assignment`)
        .send({ routerId: s.routerA1 })
        .expect(200);
      const tokens = await loginUser(app, email, password);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    });

    it('verifier can verify a ticket on A1 after assignment', async () => {
      // Seed a voucher on A1 so the verify endpoint can respond.
      const plan = await prisma.plan.create({
        data: {
          tenantId: s.tenantAId,
          routerId: s.routerA1,
          name: '1H',
          slug: `h-${Date.now()}`,
          durationMinutes: 60, sharedUsers: 1,
          priceXof: 500,
        },
      });
      await prisma.voucher.create({
        data: {
          tenantId: s.tenantAId,
          planId: plan.id,
          routerId: s.routerA1,
          code: 'ASSIGN1',
          password: 'p',
          status: 'GENERATED',
          mikrotikId: 'mk-x',
        },
      });
      const res = await request(app.getHttpServer())
        .post('/api/ticket-verification/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCode: 'ASSIGN1' })
        .expect(200);
      expect(res.body.data.status).toBe('VALID');
    });

    it('reassignment to A2 revokes refresh tokens and swaps the scope', async () => {
      await asOwnerA()
        .patch(`${BASE}/${verifier.id}/assignment`)
        .send({ routerId: s.routerA2 })
        .expect(200);

      // Old refresh token must now be rejected by /auth/refresh.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      // The access token is still unexpired → ScopeGuard loads the NEW
      // assignment from DB. Verifying a voucher on A1 now yields NOT_FOUND
      // (the verifier is scoped on A2), not an auth error.
      const res = await request(app.getHttpServer())
        .post('/api/ticket-verification/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCode: 'ASSIGN1' })
        .expect(200);
      expect(res.body.data.status).toBe('NOT_FOUND');
    });

    it('removeAssignment refuses verification with the still-unexpired access token', async () => {
      await asOwnerA()
        .delete(`${BASE}/${verifier.id}/assignment`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/ticket-verification/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCode: 'ASSIGN1' })
        .expect(403);
    });
  });

  describe('suspension / reactivation / revoke-sessions', () => {
    let verifier: { id: string; email: string; password: string };
    let accessToken: string;
    let refreshToken: string;

    beforeAll(async () => {
      const email = `susp-${Date.now()}@e2e.local`;
      const password = 'VerifPass#1';
      const res = await asOwnerA()
        .post(BASE)
        .send({ email, password })
        .expect(201);
      verifier = { id: res.body.data.id, email, password };
      await asOwnerA()
        .patch(`${BASE}/${verifier.id}/assignment`)
        .send({ routerId: s.routerA1 })
        .expect(200);
      const tokens = await loginUser(app, email, password);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    });

    it('SUSPEND rejects old access token immediately + refresh token refused', async () => {
      await asOwnerA()
        .patch(`${BASE}/${verifier.id}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/ticket-verification/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ticketCode: 'ASSIGN1' })
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('REACTIVATE requires the verifier to log in again (old tokens stay dead)', async () => {
      await asOwnerA()
        .patch(`${BASE}/${verifier.id}/status`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      // Previous refresh token: still revoked.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
      // New login works.
      const fresh = await loginUser(app, verifier.email, verifier.password);
      expect(fresh.accessToken).toBeDefined();
      accessToken = fresh.accessToken;
    });

    it('revoke-sessions revokes all refresh tokens', async () => {
      // Grab a fresh refresh token first.
      const t = await loginUser(app, verifier.email, verifier.password);
      await asOwnerA()
        .post(`${BASE}/${verifier.id}/revoke-sessions`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: t.refreshToken })
        .expect(401);
    });
  });

  describe('soft delete', () => {
    it('DELETE sets status=DELETED, drops assignment, revokes tokens, excludes from list', async () => {
      const email = `del-${Date.now()}@e2e.local`;
      const password = 'VerifPass#1';
      const created = await asOwnerA()
        .post(BASE)
        .send({ email, password })
        .expect(201);
      const id = created.body.data.id as string;
      await asOwnerA()
        .patch(`${BASE}/${id}/assignment`)
        .send({ routerId: s.routerA1 })
        .expect(200);
      const tokens = await loginUser(app, email, password);

      await asOwnerA().delete(`${BASE}/${id}`).expect(200);

      // Verifier removed from the default list.
      const list = await asOwnerA().get(BASE).expect(200);
      const ids = (list.body.data.items as Array<{ id: string }>).map((x) => x.id);
      expect(ids).not.toContain(id);

      // Access token refused.
      await request(app.getHttpServer())
        .post('/api/ticket-verification/verify')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ ticketCode: 'ASSIGN1' })
        .expect(403);

      // Refresh token refused.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      // Login refused (status DELETED).
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(401);

      // Assignment row dropped.
      const assignment = await prisma.ticketVerifierAssignment.findUnique({
        where: { userId: id },
      });
      expect(assignment).toBeNull();
    });
  });

  describe('audit log', () => {
    it('CREATE / UPDATE / assignment / revoke / delete produce distinct AuditLog rows', async () => {
      const email = `audit-${Date.now()}@e2e.local`;
      const before = Date.now();
      const created = await asOwnerA()
        .post(BASE)
        .send({ email, password: 'LongPass#1' })
        .expect(201);
      const id = created.body.data.id as string;
      await asOwnerA()
        .patch(`${BASE}/${id}/assignment`)
        .send({ routerId: s.routerA1 })
        .expect(200);
      await asOwnerA()
        .patch(`${BASE}/${id}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(200);
      await asOwnerA().delete(`${BASE}/${id}`).expect(200);

      const rows = await prisma.auditLog.findMany({
        where: {
          tenantId: s.tenantAId,
          createdAt: { gte: new Date(before) },
          OR: [{ entityId: id }],
        },
        orderBy: { createdAt: 'asc' },
      });
      const kinds = rows.map(
        (r) => (r.metadata as Record<string, unknown>)['kind'],
      );
      expect(kinds).toEqual(
        expect.arrayContaining([
          'VERIFIER_CREATED',
          'VERIFIER_ASSIGNED',
          'VERIFIER_SUSPENDED',
          'VERIFIER_DELETED',
        ]),
      );
      expect(rows.find((r) => r.action === AuditAction.CREATE)).toBeDefined();
      expect(rows.find((r) => r.action === AuditAction.DELETE)).toBeDefined();

      // No password / hash / token in any audit row.
      const flat = JSON.stringify(rows.map((r) => r.metadata));
      expect(flat).not.toContain('LongPass#1');
      expect(flat).not.toMatch(/passwordHash/i);
      expect(flat).not.toMatch(/refreshToken/i);
    });
  });

  describe('response shape — never leaks sensitive data', () => {
    it('list / get never expose passwordHash / refresh tokens', async () => {
      const list = await asOwnerA().get(BASE).expect(200);
      const flat = JSON.stringify(list.body);
      expect(flat).not.toMatch(/passwordHash/i);
      expect(flat).not.toMatch(/refreshToken/i);
      expect(flat).not.toMatch(/accessToken/i);
    });
  });
});
