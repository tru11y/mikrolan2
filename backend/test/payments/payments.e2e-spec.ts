import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser, promoteToSuperAdmin } from '../helpers/auth.helper';

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

  describe('Manual payment flow: request-upgrade → upload-proof → validate/reject', () => {
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
        .post('/api/subscriptions/upload-proof')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .field('invoiceId', invoiceId)
        .field('method', 'WAVE')
        .attach('file', Buffer.from('fake-image-bytes'), {
          filename: 'proof.png',
          contentType: 'image/png',
        })
        .expect(200);

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
});
