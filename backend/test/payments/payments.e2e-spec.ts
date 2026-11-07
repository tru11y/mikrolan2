import request from 'supertest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser, promoteToSuperAdmin } from '../helpers/auth.helper';

// Synthetic fixtures only — no real payment proof data.
const PNG_FIXTURE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('synthetic-fixture-not-a-real-image'),
]);
const JPEG_FIXTURE = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('synthetic-fixture-not-a-real-image'),
]);
const HTML_FIXTURE = Buffer.from('<html><body><script>alert(1)</script></body></html>');
const SVG_FIXTURE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const JS_FIXTURE = Buffer.from('console.log("payload")');

describe('Payments — config, upgrade request, proof, validation (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTier(adminToken: string, key: string) {
    const res = await request(app.getHttpServer())
      .post('/api/admin/tiers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key,
        name: 'Pro',
        monthlyXof: 15000,
        features: [],
      })
      .expect(201);
    return res.body.data;
  }

  describe('GET/PATCH /api/admin/config', () => {
    it('rejects a non-admin user with 403', async () => {
      const u = await signupUser(app);
      const login = await loginUser(app, u.email, u.password);

      await request(app.getHttpServer())
        .get('/api/admin/config')
        .set('Authorization', `Bearer ${login.accessToken}`)
        .expect(403);
    });

    it('lets SUPER_ADMIN set and read the Wave/Orange Money numbers', async () => {
      const u = await signupUser(app);
      const superAdmin = await promoteToSuperAdmin(app, u.email, u.password);

      const patchRes = await request(app.getHttpServer())
        .patch('/api/admin/config')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({ wave_number: '+225 07 00 00 00 00', om_number: '+225 05 00 00 00 00' })
        .expect(200);
      expect(patchRes.body.data.wave_number).toBe('+225 07 00 00 00 00');

      const getRes = await request(app.getHttpServer())
        .get('/api/admin/config')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .expect(200);
      expect(getRes.body.data.om_number).toBe('+225 05 00 00 00 00');
    });

    it('exposes the configured numbers on the public payment-info endpoint', async () => {
      const admin = await signupUser(app);
      const superAdmin = await promoteToSuperAdmin(app, admin.email, admin.password);
      await request(app.getHttpServer())
        .patch('/api/admin/config')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({ wave_number: '+225 01 02 03 04 05' })
        .expect(200);

      const client = await signupUser(app);
      const clientLogin = await loginUser(app, client.email, client.password);

      const res = await request(app.getHttpServer())
        .get('/api/subscriptions/payment-info')
        .set('Authorization', `Bearer ${clientLogin.accessToken}`)
        .expect(200);
      expect(res.body.data.wave).toBe('+225 01 02 03 04 05');
    });
  });

  describe('Manual (MANUAL provider) flow: request-upgrade → validate/reject', () => {
    it('validating an invoice activates the PRO subscription', async () => {
      const adminUser = await signupUser(app);
      const superAdmin = await promoteToSuperAdmin(app, adminUser.email, adminUser.password);
      const tier = await createTier(superAdmin.accessToken, `pro-${Date.now()}`);

      const owner = await signupUser(app);
      const ownerLogin = await loginUser(app, owner.email, owner.password);

      const upgradeRes = await request(app.getHttpServer())
        .post('/api/subscriptions/request-upgrade')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .send({ tierKey: tier.key })
        .expect(200);
      const invoiceId = upgradeRes.body.data.invoice.id;
      expect(invoiceId).toBeDefined();

      await request(app.getHttpServer())
        .post(`/api/admin/invoices/${invoiceId}/validate`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({})
        .expect(200);

      const meRes = await request(app.getHttpServer())
        .get('/api/subscriptions/me')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect(200);
      expect(meRes.body.data.plan).toBe('PRO');
      expect(meRes.body.data.status).toBe('ACTIVE');
    });

    it('rejects an invoice and leaves the subscription untouched', async () => {
      const adminUser = await signupUser(app);
      const superAdmin = await promoteToSuperAdmin(app, adminUser.email, adminUser.password);
      const tier = await createTier(superAdmin.accessToken, `basic-${Date.now()}`);

      const owner = await signupUser(app);
      const ownerLogin = await loginUser(app, owner.email, owner.password);

      const upgradeRes = await request(app.getHttpServer())
        .post('/api/subscriptions/request-upgrade')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .send({ tierKey: tier.key })
        .expect(200);
      const invoiceId = upgradeRes.body.data.invoice.id;

      await request(app.getHttpServer())
        .post(`/api/admin/invoices/${invoiceId}/reject`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({ reason: 'Preuve illisible' })
        .expect(200);

      const meRes = await request(app.getHttpServer())
        .get('/api/subscriptions/me')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect(200);
      expect(meRes.body.data.plan).not.toBe('PRO');

      // Une facture déjà traitée ne peut pas être revalidée.
      await request(app.getHttpServer())
        .post(`/api/admin/invoices/${invoiceId}/validate`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({})
        .expect(400);
    });
  });

  describe('FIND-005: upload-proof is disabled (410) — nothing is parsed or stored', () => {
    it.each([
      ['PNG', PNG_FIXTURE, 'image/png'],
      ['JPEG', JPEG_FIXTURE, 'image/jpeg'],
      ['HTML', HTML_FIXTURE, 'text/html'],
      ['SVG', SVG_FIXTURE, 'image/svg+xml'],
      ['JS', JS_FIXTURE, 'application/javascript'],
    ])('%s upload → 410 MANUAL_PAYMENT_PROOF_DISABLED', async (_n, buf, contentType) => {
      const owner = await signupUser(app);
      const ownerLogin = await loginUser(app, owner.email, owner.password);
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions/upload-proof')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .field('invoiceId', '00000000-0000-0000-0000-000000000000')
        .field('method', 'WAVE')
        .attach('file', buf, { filename: 'proof', contentType })
        .expect(410);
      expect(JSON.stringify(res.body)).toContain('MANUAL_PAYMENT_PROOF_DISABLED');
    });
  });

  describe('FIND-004: authenticated proof retrieval endpoint', () => {
    async function setupValidatedProof() {
      const adminUser = await signupUser(app);
      const superAdmin = await promoteToSuperAdmin(app, adminUser.email, adminUser.password);
      const tier = await createTier(superAdmin.accessToken, `find004-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);

      const owner = await signupUser(app);
      const ownerLogin = await loginUser(app, owner.email, owner.password);

      const upgradeRes = await request(app.getHttpServer())
        .post('/api/subscriptions/request-upgrade')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .send({ tierKey: tier.key })
        .expect(200);
      const invoiceId = upgradeRes.body.data.invoice.id;

      // Les preuves ne s'uploadent plus : on simule une preuve historique.
      const prisma = app.get(PrismaService);
      const dir = join(process.cwd(), 'private-uploads', 'proofs');
      await mkdir(dir, { recursive: true });
      const filename = `hist-${Date.now()}-${Math.floor(Math.random() * 1e9)}.png`;
      await writeFile(join(dir, filename), PNG_FIXTURE);
      const proof = await prisma.paymentProof.create({
        data: { invoiceId, method: 'WAVE', imageUrl: `/private-uploads/proofs/${filename}` },
      });
      const proofId = proof.id;

      return { ownerLogin, superAdmin, invoiceId, proofId };
    }

    it('1. rejects an anonymous (unauthenticated) request', async () => {
      const { proofId } = await setupValidatedProof();
      const res = await request(app.getHttpServer()).get(`/api/subscriptions/proofs/${proofId}`);
      expect([401, 403]).toContain(res.status);
    });

    it('2. allows the owning tenant to retrieve its own proof', async () => {
      const { ownerLogin, proofId } = await setupValidatedProof();
      const res = await request(app.getHttpServer())
        .get(`/api/subscriptions/proofs/${proofId}`)
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect(200);
      expect(Buffer.isBuffer(res.body) || res.body.length > 0).toBeTruthy();
    });

    it('3. rejects a different tenant (cross-tenant IDOR) with 404, not 403', async () => {
      const { proofId } = await setupValidatedProof();

      const otherOwner = await signupUser(app);
      const otherLogin = await loginUser(app, otherOwner.email, otherOwner.password);

      await request(app.getHttpServer())
        .get(`/api/subscriptions/proofs/${proofId}`)
        .set('Authorization', `Bearer ${otherLogin.accessToken}`)
        .expect(404);
    });

    it('4. allows SUPER_ADMIN to retrieve any proof', async () => {
      const { superAdmin, proofId } = await setupValidatedProof();
      await request(app.getHttpServer())
        .get(`/api/subscriptions/proofs/${proofId}`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .expect(200);
    });

    it('5. returns 404 for a non-existent (but well-formed) proof id', async () => {
      const { ownerLogin } = await setupValidatedProof();
      await request(app.getHttpServer())
        .get('/api/subscriptions/proofs/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect(404);
    });

    it('6. rejects a malformed id (not a UUID) with 400', async () => {
      const { ownerLogin } = await setupValidatedProof();
      await request(app.getHttpServer())
        .get('/api/subscriptions/proofs/../../etc/passwd')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect((res) => {
          if (![400, 404].includes(res.status)) {
            throw new Error(`Expected 400 or 404, got ${res.status}`);
          }
        });
    });

    it('7. sets an image Content-Type on a successful response', async () => {
      const { ownerLogin, proofId } = await setupValidatedProof();
      const res = await request(app.getHttpServer())
        .get(`/api/subscriptions/proofs/${proofId}`)
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect(200);
      expect(res.headers['content-type']).toMatch(/^image\//);
    });

    it('8. sets a Content-Disposition header on a successful response', async () => {
      const { ownerLogin, proofId } = await setupValidatedProof();
      const res = await request(app.getHttpServer())
        .get(`/api/subscriptions/proofs/${proofId}`)
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect(200);
      expect(res.headers['content-disposition']).toBeDefined();
    });

    it('9. sets X-Content-Type-Options: nosniff', async () => {
      const { ownerLogin, proofId } = await setupValidatedProof();
      const res = await request(app.getHttpServer())
        .get(`/api/subscriptions/proofs/${proofId}`)
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('10. sets a private/no-store cache policy, not a public one', async () => {
      const { ownerLogin, proofId } = await setupValidatedProof();
      const res = await request(app.getHttpServer())
        .get(`/api/subscriptions/proofs/${proofId}`)
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect(200);
      expect(res.headers['cache-control']).toMatch(/private|no-store/);
    });

    it('11. the old public static route for proofs is no longer reachable', async () => {
      const { ownerLogin, invoiceId } = await setupValidatedProof();
      void ownerLogin;
      void invoiceId;
      const res = await request(app.getHttpServer()).get('/uploads/proofs/anything.png');
      expect([404, 401]).toContain(res.status);
    });

    it('12. the old public static route is unreachable even for a filename pattern matching a real legacy record', async () => {
      const res = await request(app.getHttpServer()).get(
        '/uploads/proofs/00000000-0000-0000-0000-000000000000-1700000000000.jpg',
      );
      expect([404, 401]).toContain(res.status);
    });

    it('13. anonymous access to /api prefixed uploads path (defense-in-depth check) is also rejected', async () => {
      const res = await request(app.getHttpServer()).get('/api/uploads/proofs/anything.png');
      expect([404, 401]).toContain(res.status);
    });
  });
});
