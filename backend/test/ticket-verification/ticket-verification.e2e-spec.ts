import request from 'supertest';
import * as argon2 from 'argon2';
import { AuditAction, UserRole, UserStatus, VoucherStatus } from '@prisma/client';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

const ARGON = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

const VERIFY_PATH = '/api/ticket-verification/verify';

interface Seed {
  tenantAId: string;
  tenantBId: string;
  routerA1: string;
  routerA2: string;
  routerB1: string;
  verifierEmail: string;
  verifierPassword: string;
  verifierId: string;
  secondVerifierEmail: string;
  secondVerifierPassword: string;
  secondVerifierId: string;
  memberEmail: string;
  memberPassword: string;
  vouchers: {
    validA1: string;
    usedA1: string;
    expiredA1: string;
    revokedA1: string;
    unprovisionedA1: string;
    sameCodeA2: string; // code = "SHARED1" on A2 (same tenant)
    foreignB1: string; // code = "SHARED1" on B1 (foreign tenant)
  };
}

async function seed(app: NestFastifyApplication): Promise<Seed> {
  const prisma = app.get(PrismaService);

  // Tenant A via real signup → gives us an OWNER user and a FREE tenant.
  const ownerA = await signupUser(app, {
    tenantName: 'Tenant A',
    email: `owner-a-${Date.now()}@e2e.local`,
  });
  const ownerAUser = await prisma.user.findUniqueOrThrow({
    where: { email: ownerA.email },
  });
  const tenantAId = ownerAUser.tenantId;

  // Tenant B via signup (foreign tenant for isolation tests).
  const ownerB = await signupUser(app, {
    tenantName: 'Tenant B',
    email: `owner-b-${Date.now()}@e2e.local`,
  });
  const ownerBUser = await prisma.user.findUniqueOrThrow({
    where: { email: ownerB.email },
  });
  const tenantBId = ownerBUser.tenantId;

  // One MEMBER in tenant A (for cross-role tests).
  const memberPassword = 'MemberPass123!';
  const memberEmail = `member-a-${Date.now()}@e2e.local`;
  await prisma.user.create({
    data: {
      tenantId: tenantAId,
      email: memberEmail,
      passwordHash: await argon2.hash(memberPassword, ARGON),
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
    },
  });

  // One TICKET_VERIFIER in tenant A — created directly in DB because the
  // creation endpoint doesn't exist yet (lot 3). loginUser uses the real
  // /api/auth/login route, so this flow still exercises the auth service.
  const verifierPassword = 'VerifPass123!';
  const verifierEmail = `ver-${Date.now()}@e2e.local`;
  const verifier = await prisma.user.create({
    data: {
      tenantId: tenantAId,
      email: verifierEmail,
      passwordHash: await argon2.hash(verifierPassword, ARGON),
      role: UserRole.TICKET_VERIFIER,
      status: UserStatus.ACTIVE,
    },
  });

  // Second verifier in tenant A — same assigned router — for throttle isolation.
  const secondVerifierPassword = 'VerifPass456!';
  const secondVerifierEmail = `ver2-${Date.now()}@e2e.local`;
  const secondVerifier = await prisma.user.create({
    data: {
      tenantId: tenantAId,
      email: secondVerifierEmail,
      passwordHash: await argon2.hash(secondVerifierPassword, ARGON),
      role: UserRole.TICKET_VERIFIER,
      status: UserStatus.ACTIVE,
    },
  });

  // Routers.
  const [rA1, rA2, rB1] = await Promise.all([
    prisma.router.create({
      data: { tenantId: tenantAId, identity: `ra1-${Date.now()}` },
    }),
    prisma.router.create({
      data: { tenantId: tenantAId, identity: `ra2-${Date.now()}` },
    }),
    prisma.router.create({
      data: { tenantId: tenantBId, identity: `rb1-${Date.now()}` },
    }),
  ]);

  // Assignments: both verifiers → routerA1.
  await prisma.ticketVerifierAssignment.create({
    data: {
      userId: verifier.id,
      tenantId: tenantAId,
      routerId: rA1.id,
      assignedById: ownerAUser.id,
    },
  });
  await prisma.ticketVerifierAssignment.create({
    data: {
      userId: secondVerifier.id,
      tenantId: tenantAId,
      routerId: rA1.id,
      assignedById: ownerAUser.id,
    },
  });

  // Plans.
  const [planA1, planA2, planB1] = await Promise.all([
    prisma.plan.create({
      data: {
        tenantId: tenantAId,
        routerId: rA1.id,
        name: '1H',
        slug: '1h',
        durationMinutes: 60,
        priceXof: 500,
      },
    }),
    prisma.plan.create({
      data: {
        tenantId: tenantAId,
        routerId: rA2.id,
        name: '1H',
        slug: '1h',
        durationMinutes: 60,
        priceXof: 500,
      },
    }),
    prisma.plan.create({
      data: {
        tenantId: tenantBId,
        routerId: rB1.id,
        name: '1H',
        slug: '1h',
        durationMinutes: 60,
        priceXof: 500,
      },
    }),
  ]);

  // Vouchers.
  const mk = (
    tenantId: string,
    planId: string,
    routerId: string,
    code: string,
    status: VoucherStatus,
    mikrotikId: string | null,
  ) =>
    prisma.voucher.create({
      data: {
        tenantId,
        planId,
        routerId,
        code,
        password: 'secret-pw-DO-NOT-LEAK',
        status,
        mikrotikId: mikrotikId ?? '',
      },
    });

  const [vValid, vUsed, vExpired, vRevoked, vUnpro, vA2Shared, vB1Shared] =
    await Promise.all([
      mk(tenantAId, planA1.id, rA1.id, 'VALID1', VoucherStatus.GENERATED, 'mk-v-1'),
      mk(tenantAId, planA1.id, rA1.id, 'USED1', VoucherStatus.USED, 'mk-u-1'),
      mk(tenantAId, planA1.id, rA1.id, 'EXP1', VoucherStatus.EXPIRED, 'mk-e-1'),
      mk(tenantAId, planA1.id, rA1.id, 'REV1', VoucherStatus.REVOKED, 'mk-r-1'),
      mk(tenantAId, planA1.id, rA1.id, 'UNPRO1', VoucherStatus.GENERATED, null),
      mk(tenantAId, planA2.id, rA2.id, 'SHARED1', VoucherStatus.GENERATED, 'mk-a2-1'),
      mk(tenantBId, planB1.id, rB1.id, 'SHARED1', VoucherStatus.GENERATED, 'mk-b1-1'),
    ]);

  return {
    tenantAId,
    tenantBId,
    routerA1: rA1.id,
    routerA2: rA2.id,
    routerB1: rB1.id,
    verifierEmail,
    verifierPassword,
    verifierId: verifier.id,
    secondVerifierEmail,
    secondVerifierPassword,
    secondVerifierId: secondVerifier.id,
    memberEmail,
    memberPassword,
    vouchers: {
      validA1: vValid.id,
      usedA1: vUsed.id,
      expiredA1: vExpired.id,
      revokedA1: vRevoked.id,
      unprovisionedA1: vUnpro.id,
      sameCodeA2: vA2Shared.id,
      foreignB1: vB1Shared.id,
    },
  };
}

describe('Ticket verification (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let s: Seed;
  let verifierToken: string;
  let memberToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    s = await seed(app);
    verifierToken = (
      await loginUser(app, s.verifierEmail, s.verifierPassword)
    ).accessToken;
    memberToken = (
      await loginUser(app, s.memberEmail, s.memberPassword)
    ).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const asVerifier = () =>
    request(app.getHttpServer())
      .post(VERIFY_PATH)
      .set('Authorization', `Bearer ${verifierToken}`);

  describe('authentication / authorization', () => {
    it('401 without Authorization header', async () => {
      await request(app.getHttpServer())
        .post(VERIFY_PATH)
        .send({ ticketCode: 'VALID1' })
        .expect(401);
    });

    it('401 with an invalid JWT', async () => {
      await request(app.getHttpServer())
        .post(VERIFY_PATH)
        .set('Authorization', 'Bearer not-a-jwt')
        .send({ ticketCode: 'VALID1' })
        .expect(401);
    });

    it('403 for a MEMBER JWT (role not in @Roles(TICKET_VERIFIER))', async () => {
      await request(app.getHttpServer())
        .post(VERIFY_PATH)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ ticketCode: 'VALID1' })
        .expect(403);
    });

    it('403 for a verifier whose DB role was changed after the JWT was issued', async () => {
      await prisma.user.update({
        where: { id: s.verifierId },
        data: { role: UserRole.MEMBER },
      });
      await asVerifier().send({ ticketCode: 'VALID1' }).expect(403);
      await prisma.user.update({
        where: { id: s.verifierId },
        data: { role: UserRole.TICKET_VERIFIER },
      });
    });

    it('403 for a verifier suspended after the JWT was issued', async () => {
      await prisma.user.update({
        where: { id: s.verifierId },
        data: { status: UserStatus.SUSPENDED },
      });
      await asVerifier().send({ ticketCode: 'VALID1' }).expect(403);
      await prisma.user.update({
        where: { id: s.verifierId },
        data: { status: UserStatus.ACTIVE },
      });
    });

    it('403 for a verifier whose assignment was removed', async () => {
      const old = await prisma.ticketVerifierAssignment.findUniqueOrThrow({
        where: { userId: s.verifierId },
      });
      await prisma.ticketVerifierAssignment.delete({
        where: { userId: s.verifierId },
      });
      await asVerifier().send({ ticketCode: 'VALID1' }).expect(403);
      await prisma.ticketVerifierAssignment.create({ data: old });
    });
  });

  describe('result mapping', () => {
    it('VALID + ALLOW_CUSTOMER on the assigned router', async () => {
      const res = await asVerifier()
        .send({ ticketCode: 'VALID1' })
        .expect(200);
      const body = res.body.data;
      expect(body.status).toBe('VALID');
      expect(body.recommendedAction).toBe('ALLOW_CUSTOMER');
      expect(body.ticket).toEqual(
        expect.objectContaining({ planName: '1H', durationMinutes: 60 }),
      );
    });

    it('ALREADY_USED + DO_NOT_REPLACE', async () => {
      const res = await asVerifier()
        .send({ ticketCode: 'USED1' })
        .expect(200);
      expect(res.body.data.status).toBe('ALREADY_USED');
      expect(res.body.data.recommendedAction).toBe('DO_NOT_REPLACE');
    });

    it('EXPIRED + SELL_NEW_TICKET', async () => {
      const res = await asVerifier()
        .send({ ticketCode: 'EXP1' })
        .expect(200);
      expect(res.body.data.status).toBe('EXPIRED');
      expect(res.body.data.recommendedAction).toBe('SELL_NEW_TICKET');
    });

    it('BLOCKED + CONTACT_MANAGER on REVOKED', async () => {
      const res = await asVerifier()
        .send({ ticketCode: 'REV1' })
        .expect(200);
      expect(res.body.data.status).toBe('BLOCKED');
      expect(res.body.data.recommendedAction).toBe('CONTACT_MANAGER');
    });

    it('TEMPORARILY_UNAVAILABLE + RETRY_LATER on not-yet-provisioned', async () => {
      const res = await asVerifier()
        .send({ ticketCode: 'UNPRO1' })
        .expect(200);
      expect(res.body.data.status).toBe('TEMPORARILY_UNAVAILABLE');
      expect(res.body.data.recommendedAction).toBe('RETRY_LATER');
      // Must NOT expose provisioning internals.
      const flat = JSON.stringify(res.body);
      expect(flat).not.toContain('mikrotik');
      expect(flat).not.toContain('mk-');
    });
  });

  describe('hotspot isolation — byte-identical NOT_FOUND', () => {
    const expectCanonicalNotFound = (body: Record<string, unknown>): void => {
      expect(body).toEqual({
        status: 'NOT_FOUND',
        message: 'Ticket inexistant',
        recommendedAction: 'CHECK_ENTERED_CODE',
      });
    };

    it('nowhere in DB → NOT_FOUND', async () => {
      const res = await asVerifier()
        .send({ ticketCode: 'NOPE999' })
        .expect(200);
      expectCanonicalNotFound(res.body.data);
    });

    it('exists on A2 (same tenant, other router) → identical NOT_FOUND', async () => {
      const res = await asVerifier()
        .send({ ticketCode: 'SHARED1' })
        .expect(200);
      expectCanonicalNotFound(res.body.data);
      // Explicitly: NO voucherId / routerId / tenantId / mikrotikId leaked.
      const flat = JSON.stringify(res.body);
      expect(flat).not.toContain(s.vouchers.sameCodeA2);
      expect(flat).not.toContain(s.routerA2);
      expect(flat).not.toContain('mk-a2');
    });

    it('body for the three NOT_FOUND cases is strictly identical', async () => {
      const [r1, r2, r3] = await Promise.all([
        asVerifier().send({ ticketCode: 'NOPE999' }).expect(200),
        asVerifier().send({ ticketCode: 'SHARED1' }).expect(200),
        asVerifier().send({ ticketCode: 'FOREIGN-ONLY-ON-B1-' + Date.now() }).expect(200),
      ]);
      // The 3rd request targets a code that only EXISTS on tenant B's router.
      // Use the deterministic 'SHARED1' presence on B1 explicitly here:
      const rb = await asVerifier()
        .send({ ticketCode: 'SHARED1' })
        .expect(200);
      // SHARED1 appears on A2 AND B1; both must look like a plain NOT_FOUND.
      expect(JSON.stringify(r1.body.data)).toBe(JSON.stringify(rb.body.data));
      expect(JSON.stringify(r2.body.data)).toBe(JSON.stringify(rb.body.data));
      // r3 was a truly inexistent code — same canonical shape.
      expect(JSON.stringify(r3.body.data)).toBe(JSON.stringify(rb.body.data));
    });
  });

  describe('DTO strictness', () => {
    it('400 when the body carries a routerId', async () => {
      await asVerifier()
        .send({ ticketCode: 'VALID1', routerId: s.routerA2 })
        .expect(400);
    });

    it.each(['tenantId', 'hotspotId', 'sellerId', 'userId', 'role'])(
      '400 when the body carries %s',
      async (field) => {
        await asVerifier()
          .send({ ticketCode: 'VALID1', [field]: 'anything' })
          .expect(400);
      },
    );

    it('400 on empty body', async () => {
      await asVerifier().send({}).expect(400);
    });

    it('400 on whitespace-only ticketCode', async () => {
      await asVerifier().send({ ticketCode: '   ' }).expect(400);
    });

    it('400 on too-long ticketCode', async () => {
      await asVerifier()
        .send({ ticketCode: 'A'.repeat(65) })
        .expect(400);
    });
  });

  describe('response does not expose sensitive data', () => {
    it('VALID response never contains tenantId/routerId/voucherId/password', async () => {
      const res = await asVerifier()
        .send({ ticketCode: 'VALID1' })
        .expect(200);
      const flat = JSON.stringify(res.body);
      expect(flat).not.toContain(s.tenantAId);
      expect(flat).not.toContain(s.routerA1);
      expect(flat).not.toContain(s.vouchers.validA1);
      expect(flat).not.toMatch(/password/i);
      expect(flat).not.toContain('secret-pw-DO-NOT-LEAK');
    });
  });

  describe('audit log in Postgres', () => {
    it('VALID writes one VERIFY row with the voucherId and NO full code', async () => {
      const before = Date.now();
      await asVerifier().send({ ticketCode: 'VALID1' }).expect(200);
      const row = await prisma.auditLog.findFirst({
        where: {
          action: AuditAction.VERIFY,
          tenantId: s.tenantAId,
          createdAt: { gte: new Date(before) },
          entityId: s.vouchers.validA1,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(row).not.toBeNull();
      const meta = row!.metadata as Record<string, unknown>;
      expect(meta['result']).toBe('VALID');
      expect(meta['source']).toBe('MANUAL');
      expect(meta['routerId']).toBe(s.routerA1);
      expect(meta['codeFingerprint']).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(meta)).not.toContain('VALID1');
      expect(JSON.stringify(meta)).not.toContain('secret-pw-DO-NOT-LEAK');
      // The authenticated verifier is the actor.
      expect(row!.userId).toBe(s.verifierId);
    });

    it('NOT_FOUND on A2 code does NOT store the foreign voucherId', async () => {
      const before = Date.now();
      await asVerifier().send({ ticketCode: 'SHARED1' }).expect(200);
      const row = await prisma.auditLog.findFirst({
        where: {
          action: AuditAction.VERIFY,
          tenantId: s.tenantAId,
          createdAt: { gte: new Date(before) },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(row).not.toBeNull();
      expect(row!.entityId).toBeNull();
      const meta = row!.metadata as Record<string, unknown>;
      expect(meta['result']).toBe('NOT_FOUND');
      // Audit never carries the foreign voucherId or router.
      expect(JSON.stringify(meta)).not.toContain(s.vouchers.sameCodeA2);
      expect(JSON.stringify(meta)).not.toContain(s.routerA2);
    });

    it('fingerprint is stable across two verifications of the same code', async () => {
      const now = Date.now();
      await asVerifier().send({ ticketCode: 'VALID1' }).expect(200);
      await asVerifier().send({ ticketCode: 'VALID1' }).expect(200);
      const rows = await prisma.auditLog.findMany({
        where: {
          action: AuditAction.VERIFY,
          tenantId: s.tenantAId,
          createdAt: { gte: new Date(now) },
          entityId: s.vouchers.validA1,
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const fp1 = (rows[0]!.metadata as Record<string, unknown>)['codeFingerprint'];
      const fp2 = (rows[1]!.metadata as Record<string, unknown>)['codeFingerprint'];
      expect(fp1).toEqual(fp2);
    });
  });

  describe('bypass attempts on existing endpoints', () => {
    it('TICKET_VERIFIER is refused on POST /api/vouchers/verify', async () => {
      await request(app.getHttpServer())
        .post('/api/vouchers/verify')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ ticket: 'VALID1', routerId: s.routerA1 })
        .expect(403);
    });

    it('TICKET_VERIFIER is refused on GET /api/routers/:id/vouchers', async () => {
      await request(app.getHttpServer())
        .get(`/api/routers/${s.routerA1}/vouchers`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(403);
    });

    it('TICKET_VERIFIER is refused on GET /api/routers/:id/vouchers/lookup', async () => {
      await request(app.getHttpServer())
        .get(`/api/routers/${s.routerA1}/vouchers/lookup?code=VALID1`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(403);
    });

    it('TICKET_VERIFIER is refused on GET /api/routers/:id/vouchers/batches', async () => {
      await request(app.getHttpServer())
        .get(`/api/routers/${s.routerA1}/vouchers/batches`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(403);
    });

    it('TICKET_VERIFIER is refused on an admin voucher-generation endpoint', async () => {
      await request(app.getHttpServer())
        .post(`/api/routers/${s.routerA1}/vouchers/generate`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ planId: 'ignored', quantity: 1 })
        .expect(403);
    });

    // Non-regression: MEMBER still has access to the open endpoints.
    it('MEMBER keeps access to GET /api/routers/:id/vouchers', async () => {
      await request(app.getHttpServer())
        .get(`/api/routers/${s.routerA1}/vouchers`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
    });
  });
});
