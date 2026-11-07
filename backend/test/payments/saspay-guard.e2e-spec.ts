import request from 'supertest';
import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentProvider, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SaspayClient } from '../../src/modules/payments/saspay/saspay.client';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { SaspayService } from '../../src/modules/payments/saspay/saspay.service';
import { signupUser, loginUser, promoteToSuperAdmin } from '../helpers/auth.helper';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('synthetic-fixture-not-a-real-image'),
]);
const PROOFS_DIR = join(process.cwd(), 'private-uploads', 'proofs');
const proofFiles = () => (existsSync(PROOFS_DIR) ? readdirSync(PROOFS_DIR).sort() : []);

describe('SasPay — blocage des actions manuelles (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let admin: string;
  let tierId: string;
  let tierKey: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.SASPAY_ENABLED = 'true';
    process.env.SASPAY_WEBHOOK_SECRET = 'whsec_test';
    const { createTestApp } = await import('../helpers/app.helper');
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const a = await signupUser(app);
    admin = (await promoteToSuperAdmin(app, a.email, a.password)).accessToken;
    tierKey = `guard-${Date.now()}`;
    const res = await http()
      .post('/api/admin/tiers')
      .set(auth(admin))
      .send({ key: tierKey, name: 'Pro', monthlyXof: 15000, features: [] })
      .expect(201);
    tierId = res.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function tenant() {
    const u = await signupUser(app);
    const login = await loginUser(app, u.email, u.password);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: u.email }, select: { tenantId: true } });
    return { token: login.accessToken, tenantId: row.tenantId };
  }

  async function invoice(tenantId: string, provider: PaymentProvider, status: PaymentStatus) {
    return prisma.invoice.create({
      data: {
        tenantId,
        amount: 15000,
        currency: 'XOF',
        tierId,
        billingPeriod: 'MONTHLY',
        periodDays: 30,
        provider,
        status,
        idempotencyKey: `guard-${tenantId}-${Math.random().toString(36).slice(2)}`,
      },
    });
  }

  const CODE = 'SASPAY_INVOICE_MANAGED_BY_WEBHOOK';
  const STATUSES: Array<[string, PaymentStatus]> = [
    ['PENDING', PaymentStatus.PENDING],
    ['PAID', PaymentStatus.PAID],
    ['FAILED', PaymentStatus.FAILED],
  ];

  describe('validate / reject sur facture SASPAY → 409', () => {
    it.each(STATUSES)('validate SASPAY %s → 409', async (_l, status) => {
      const t = await tenant();
      const inv = await invoice(t.tenantId, PaymentProvider.SASPAY, status);
      const res = await http().post(`/api/admin/invoices/${inv.id}/validate`).set(auth(admin)).send({}).expect(409);
      expect(JSON.stringify(res.body)).toContain(CODE);
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      expect(after.status).toBe(status);
    });

    it.each(STATUSES)('reject SASPAY %s → 409', async (_l, status) => {
      const t = await tenant();
      const inv = await invoice(t.tenantId, PaymentProvider.SASPAY, status);
      const res = await http()
        .post(`/api/admin/invoices/${inv.id}/reject`)
        .set(auth(admin))
        .send({ reason: 'x' })
        .expect(409);
      expect(JSON.stringify(res.body)).toContain(CODE);
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      expect(after.status).toBe(status);
    });

    it('SASPAY PENDING validate n\'active pas l\'abonnement', async () => {
      const t = await tenant();
      const inv = await invoice(t.tenantId, PaymentProvider.SASPAY, PaymentStatus.PENDING);
      await http().post(`/api/admin/invoices/${inv.id}/validate`).set(auth(admin)).send({}).expect(409);
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: t.tenantId } });
      expect(sub.plan).not.toBe('PRO');
    });

    it('MANUAL PENDING reste validable (décision documentée)', async () => {
      const t = await tenant();
      const inv = await invoice(t.tenantId, PaymentProvider.MANUAL, PaymentStatus.PENDING);
      await http().post(`/api/admin/invoices/${inv.id}/validate`).set(auth(admin)).send({}).expect(200);
    });
  });

  describe('upload-proof → 410', () => {
    it('410 MANUAL_PAYMENT_PROOF_DISABLED, aucun fichier, aucune ligne, aucun audit UPLOAD', async () => {
      const t = await tenant();
      const inv = await invoice(t.tenantId, PaymentProvider.MANUAL, PaymentStatus.PENDING);
      const filesBefore = proofFiles();
      const proofsBefore = await prisma.paymentProof.count();
      const uploadsBefore = await prisma.auditLog.count({ where: { action: 'UPLOAD', entityType: 'PaymentProof' } });

      const res = await http()
        .post('/api/subscriptions/upload-proof')
        .set(auth(t.token))
        .field('invoiceId', inv.id)
        .field('method', 'WAVE')
        .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(410);
      expect(JSON.stringify(res.body)).toContain('MANUAL_PAYMENT_PROOF_DISABLED');

      expect(proofFiles()).toEqual(filesBefore);
      expect(await prisma.paymentProof.count()).toBe(proofsBefore);
      expect(await prisma.auditLog.count({ where: { action: 'UPLOAD', entityType: 'PaymentProof' } })).toBe(uploadsBefore);
    });

    it('410 aussi sans fichier ni champs (anciennes APK)', async () => {
      const t = await tenant();
      await http().post('/api/subscriptions/upload-proof').set(auth(t.token)).expect(410);
    });
  });

  describe('lecture des preuves historiques conservée', () => {
    async function seedProof() {
      const t = await tenant();
      const inv = await invoice(t.tenantId, PaymentProvider.MANUAL, PaymentStatus.PAID);
      mkdirSync(PROOFS_DIR, { recursive: true });
      const name = `hist-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      writeFileSync(join(PROOFS_DIR, name), PNG);
      const proof = await prisma.paymentProof.create({
        data: { invoiceId: inv.id, method: 'WAVE', imageUrl: `/private-uploads/proofs/${name}` },
      });
      return { t, inv, proof };
    }

    it('propriétaire et SUPER_ADMIN lisent le fichier', async () => {
      const { t, proof } = await seedProof();
      await http().get(`/api/subscriptions/proofs/${proof.id}`).set(auth(t.token)).expect(200);
      await http().get(`/api/subscriptions/proofs/${proof.id}`).set(auth(admin)).expect(200);
    });

    it('autre tenant → 404', async () => {
      const { proof } = await seedProof();
      const other = await tenant();
      await http().get(`/api/subscriptions/proofs/${proof.id}`).set(auth(other.token)).expect(404);
    });

    it('GET /admin/invoices/:id/proofs liste la preuve', async () => {
      const { inv, proof } = await seedProof();
      const res = await http().get(`/api/admin/invoices/${inv.id}/proofs`).set(auth(admin)).expect(200);
      expect(JSON.stringify(res.body)).toContain(proof.id);
    });
  });

  describe('provider exposé', () => {
    it('GET /admin/invoices expose provider MANUAL et SASPAY', async () => {
      const t = await tenant();
      const s = await invoice(t.tenantId, PaymentProvider.SASPAY, PaymentStatus.PENDING);
      const m = await invoice(t.tenantId, PaymentProvider.MANUAL, PaymentStatus.FAILED);
      type Row = { id: string; provider?: string };
      const list = async (status: string): Promise<Row[]> => {
        const res = await http().get(`/api/admin/invoices?limit=100&status=${status}`).set(auth(admin)).expect(200);
        return res.body.data.items ?? res.body.data;
      };
      expect((await list('PENDING')).find((i) => i.id === s.id)?.provider).toBe('SASPAY');
      expect((await list('FAILED')).find((i) => i.id === m.id)?.provider).toBe('MANUAL');
    });

    it('GET /admin/tenants/:id expose provider sans secret', async () => {
      const t = await tenant();
      const s = await invoice(t.tenantId, PaymentProvider.SASPAY, PaymentStatus.PAID);
      const m = await invoice(t.tenantId, PaymentProvider.MANUAL, PaymentStatus.PAID);
      const res = await http().get(`/api/admin/tenants/${t.tenantId}`).set(auth(admin)).expect(200);
      const inv: Array<{ id: string; provider?: string }> = res.body.data.invoices;
      expect(inv.find((i) => i.id === s.id)?.provider).toBe('SASPAY');
      expect(inv.find((i) => i.id === m.id)?.provider).toBe('MANUAL');
      expect(JSON.stringify(res.body)).not.toMatch(/providerSessionId|rawLastEvent|checkoutUrl|idempotencyKey/);
    });
  });

  describe('POST /subscriptions/:tenantId/activate', () => {
    it('SASPAY PENDING existante → 409 SASPAY_PAYMENT_CONFIRMATION_REQUIRED', async () => {
      const t = await tenant();
      const inv = await invoice(t.tenantId, PaymentProvider.SASPAY, PaymentStatus.PENDING);
      const res = await http()
        .post(`/api/subscriptions/${t.tenantId}/activate`)
        .set(auth(admin))
        .send({ periodDays: 30 })
        .expect(409);
      expect(JSON.stringify(res.body)).toContain('SASPAY_PAYMENT_CONFIRMATION_REQUIRED');
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      expect(after.status).toBe(PaymentStatus.PENDING);
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: t.tenantId } });
      expect(sub.plan).not.toBe('PRO');
    });

    it('invoiceId explicite SASPAY → 409', async () => {
      const t = await tenant();
      const inv = await invoice(t.tenantId, PaymentProvider.SASPAY, PaymentStatus.PENDING);
      await http().post(`/api/subscriptions/${t.tenantId}/activate`).set(auth(admin)).send({ invoiceId: inv.id }).expect(409);
    });

    it('facture MANUAL PENDING reste activable par SUPER_ADMIN', async () => {
      const t = await tenant();
      await invoice(t.tenantId, PaymentProvider.MANUAL, PaymentStatus.PENDING);
      await http().post(`/api/subscriptions/${t.tenantId}/activate`).set(auth(admin)).send({}).expect(200);
    });

    describe('scoping tenant / facture', () => {
      const activate = (tenantId: string, body: object) =>
        http().post(`/api/subscriptions/${tenantId}/activate`).set(auth(admin)).send(body);
      const planOf = async (tenantId: string) =>
        (await prisma.subscription.findUniqueOrThrow({ where: { tenantId } })).plan;

      it('tenant inexistant → 404 TENANT_NOT_FOUND', async () => {
        const res = await activate('00000000-0000-4000-8000-000000000000', {}).expect(404);
        expect(JSON.stringify(res.body)).toContain('TENANT_NOT_FOUND');
      });

      it('invoiceId inexistant → 404 INVOICE_NOT_FOUND, aucune activation', async () => {
        const t = await tenant();
        const spy = jest.spyOn(app.get(SubscriptionsService), 'activate');
        const res = await activate(t.tenantId, { invoiceId: '00000000-0000-4000-8000-000000000000' }).expect(404);
        expect(JSON.stringify(res.body)).toContain('INVOICE_NOT_FOUND');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
        expect(await planOf(t.tenantId)).not.toBe('PRO');
      });

      it('invoiceId autre tenant → même 404 INVOICE_NOT_FOUND, aucune activation', async () => {
        const t = await tenant();
        const other = await tenant();
        const foreign = await invoice(other.tenantId, PaymentProvider.MANUAL, PaymentStatus.PENDING);
        const spy = jest.spyOn(app.get(SubscriptionsService), 'activate');
        const res = await activate(t.tenantId, { invoiceId: foreign.id }).expect(404);
        expect(JSON.stringify(res.body)).toContain('INVOICE_NOT_FOUND');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
        expect(await planOf(t.tenantId)).not.toBe('PRO');
        expect((await prisma.invoice.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe('PENDING');
      });

      it.each(STATUSES)('invoiceId SASPAY %s → 409 SASPAY_PAYMENT_CONFIRMATION_REQUIRED', async (_l, status) => {
        const t = await tenant();
        const inv = await invoice(t.tenantId, PaymentProvider.SASPAY, status);
        const res = await activate(t.tenantId, { invoiceId: inv.id }).expect(409);
        expect(JSON.stringify(res.body)).toContain('SASPAY_PAYMENT_CONFIRMATION_REQUIRED');
        expect(await planOf(t.tenantId)).not.toBe('PRO');
      });

      it('invoiceId MANUAL PENDING du bon tenant → comportement existant (200, PAID)', async () => {
        const t = await tenant();
        const inv = await invoice(t.tenantId, PaymentProvider.MANUAL, PaymentStatus.PENDING);
        await activate(t.tenantId, { invoiceId: inv.id }).expect(200);
        expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('PAID');
      });

      it('sans invoiceId, SASPAY PENDING → 409', async () => {
        const t = await tenant();
        await invoice(t.tenantId, PaymentProvider.SASPAY, PaymentStatus.PENDING);
        await activate(t.tenantId, {}).expect(409);
      });

      it('sans invoiceId, SASPAY PAID seule → comportement existant (200)', async () => {
        const t = await tenant();
        await invoice(t.tenantId, PaymentProvider.SASPAY, PaymentStatus.PAID);
        await invoice(t.tenantId, PaymentProvider.MANUAL, PaymentStatus.PENDING);
        await activate(t.tenantId, {}).expect(200);
      });
    });

    it('non SUPER_ADMIN → 403', async () => {
      const t = await tenant();
      await http().post(`/api/subscriptions/${t.tenantId}/activate`).set(auth(t.token)).send({}).expect(403);
    });
  });

  describe('flux SasPay inchangé', () => {
    it('checkout crée facture SASPAY PENDING, le webhook active (doublon idempotent)', async () => {
      const t = await tenant();
      jest.spyOn(app.get(SaspayClient), 'createCheckoutSession').mockResolvedValue({
        id: 'sess_guard_1',
        checkoutUrl: 'https://pay.example/c/1',
        expiresAt: new Date(Date.now() + 3600_000),
      } as never);

      const res = await http()
        .post('/api/payments/saspay/checkout')
        .set(auth(t.token))
        .send({ tierKey, billingPeriod: 'MONTHLY' });
      expect([200, 201]).toContain(res.status);
      const { invoiceId, intentId } = res.body.data;
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(inv.provider).toBe('SASPAY');
      expect(inv.status).toBe('PENDING');

      const svc = app.get(SaspayService);
      const event = {
        event: 'transaction.success',
        data: {
          id: 'sess_guard_1',
          reference: `MKL-${invoiceId}`,
          charged: 15000,
          currency: 'XOF',
          metadata: { intentId, invoiceId, tenantId: t.tenantId },
        },
      };
      expect((await svc.handleWebhookEvent(event, 'hash-guard-1')).reason).toBe('activated');
      expect((await svc.handleWebhookEvent(event, 'hash-guard-1')).reason).toBe('duplicate_delivery');

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(after.status).toBe('PAID');
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: t.tenantId } });
      expect(sub.plan).toBe('PRO');
    });
  });
});
