import request from 'supertest';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PaymentProvider, PaymentStatus } from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser, promoteToSuperAdmin } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { SaspayService } from '../../src/modules/payments/saspay/saspay.service';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('synthetic'),
]);
const SASPAY_CODE = 'SASPAY_INVOICE_MANAGED_BY_WEBHOOK';
const SASPAY_MESSAGE = 'Cette facture SasPay est gérée automatiquement par le webhook de paiement.';
const PROOFS_DIR = join(process.cwd(), 'private-uploads', 'proofs');
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

describe('SasPay invoices — manual activation blocked (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app.close();
  });

  async function setup(provider: PaymentProvider, status: PaymentStatus = PaymentStatus.PENDING) {
    const adminUser = await signupUser(app);
    const admin = await promoteToSuperAdmin(app, adminUser.email, adminUser.password);
    const tierKey = `blk-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    await request(app.getHttpServer())
      .post('/api/admin/tiers')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ key: tierKey, name: 'Pro', monthlyXof: 15000, features: [] })
      .expect(201);
    const owner = await signupUser(app);
    const ownerLogin = await loginUser(app, owner.email, owner.password);
    const up = await request(app.getHttpServer())
      .post('/api/subscriptions/request-upgrade')
      .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
      .send({ tierKey })
      .expect(200);
    const invoiceId: string = up.body.data.invoice.id;
    const invoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { provider, status, paidAt: status === PaymentStatus.PAID ? new Date() : null },
    });
    return { admin, ownerLogin, invoice, invoiceId, tenantId: invoice.tenantId };
  }

  const post = (path: string, token: string) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`);

  describe('validate / reject on SASPAY invoices', () => {
    it('PENDING validate → 409 with the exact error envelope', async () => {
      const { admin, invoiceId, tenantId } = await setup(PaymentProvider.SASPAY);
      const res = await post(`/api/admin/invoices/${invoiceId}/validate`, admin.accessToken).send({}).expect(409);
      expect(res.body).toEqual({
        success: false,
        data: null,
        message: SASPAY_MESSAGE,
        error: null,
        errorCode: SASPAY_CODE,
      });
      expect((await prisma.invoice.findUnique({ where: { id: invoiceId } }))?.status).toBe('PENDING');
      expect((await prisma.subscription.findUnique({ where: { tenantId } }))?.plan).not.toBe('PRO');
    });

    it('PENDING reject → 409, invoice untouched', async () => {
      const { admin, invoiceId } = await setup(PaymentProvider.SASPAY);
      const res = await post(`/api/admin/invoices/${invoiceId}/reject`, admin.accessToken).send({ reason: 'x' }).expect(409);
      expect(res.body.errorCode).toBe(SASPAY_CODE);
      expect((await prisma.invoice.findUnique({ where: { id: invoiceId } }))?.status).toBe('PENDING');
    });

    it('PAID validate → 409', async () => {
      const { admin, invoiceId } = await setup(PaymentProvider.SASPAY, PaymentStatus.PAID);
      const res = await post(`/api/admin/invoices/${invoiceId}/validate`, admin.accessToken).send({}).expect(409);
      expect(res.body.errorCode).toBe(SASPAY_CODE);
    });

    it('MANUAL PENDING validate still works (legacy path unchanged)', async () => {
      const { admin, invoiceId, ownerLogin } = await setup(PaymentProvider.MANUAL);
      await post(`/api/admin/invoices/${invoiceId}/validate`, admin.accessToken).send({}).expect(200);
      const me = await request(app.getHttpServer())
        .get('/api/subscriptions/me')
        .set('Authorization', `Bearer ${ownerLogin.accessToken}`)
        .expect(200);
      expect(me.body.data.plan).toBe('PRO');
    });
  });

  describe('provider exposed in admin responses', () => {
    it('GET /admin/invoices and GET /admin/tenants/:id expose provider', async () => {
      const { admin, invoiceId, tenantId } = await setup(PaymentProvider.SASPAY);
      const list = await request(app.getHttpServer())
        .get('/api/admin/invoices?limit=100')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      const items = list.body.data.items ?? list.body.data;
      expect(items.find((i: { id: string }) => i.id === invoiceId).provider).toBe('SASPAY');

      const t = await request(app.getHttpServer())
        .get(`/api/admin/tenants/${tenantId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(t.body.data.invoices.find((i: { id: string }) => i.id === invoiceId).provider).toBe('SASPAY');
    });

    it('provider is never null/omitted: every row is MANUAL or SASPAY in both views', async () => {
      const m = await setup(PaymentProvider.MANUAL);
      const sp = await setup(PaymentProvider.SASPAY, PaymentStatus.PAID);
      const rows: Array<{ id: string; provider: unknown }> = [];
      for (const status of ['PENDING', 'PAID']) {
        const list = await request(app.getHttpServer())
          .get(`/api/admin/invoices?limit=100&status=${status}`)
          .set('Authorization', `Bearer ${m.admin.accessToken}`)
          .expect(200);
        rows.push(...(list.body.data.items ?? list.body.data));
      }
      expect(rows.length).toBeGreaterThan(1);
      for (const r of rows) expect(['MANUAL', 'SASPAY']).toContain(r.provider);
      expect(rows.find((r) => r.id === m.invoiceId)?.provider).toBe('MANUAL');
      expect(rows.find((r) => r.id === sp.invoiceId)?.provider).toBe('SASPAY');
      for (const c of [m, sp]) {
        const t = await request(app.getHttpServer())
          .get(`/api/admin/tenants/${c.tenantId}`)
          .set('Authorization', `Bearer ${m.admin.accessToken}`)
          .expect(200);
        for (const i of t.body.data.invoices) expect(['MANUAL', 'SASPAY']).toContain(i.provider);
        expect(t.body.data.invoices[0].provider).toBe(c === m ? 'MANUAL' : 'SASPAY');
      }
    });
  });

  describe('POST /subscriptions/:tenantId/activate', () => {
    it('SASPAY PENDING on tenant, no invoiceId → 409, nothing activated', async () => {
      const { admin, invoiceId, tenantId } = await setup(PaymentProvider.SASPAY);
      const res = await post(`/api/subscriptions/${tenantId}/activate`, admin.accessToken).send({}).expect(409);
      expect(res.body.errorCode).toBe(SASPAY_CODE);
      expect((await prisma.invoice.findUnique({ where: { id: invoiceId } }))?.status).toBe('PENDING');
      expect((await prisma.subscription.findUnique({ where: { tenantId } }))?.plan).not.toBe('PRO');
    });

    it('explicit SASPAY PENDING invoiceId → 409', async () => {
      const { admin, invoiceId, tenantId } = await setup(PaymentProvider.SASPAY);
      const res = await post(`/api/subscriptions/${tenantId}/activate`, admin.accessToken).send({ invoiceId }).expect(409);
      expect(res.body.errorCode).toBe(SASPAY_CODE);
    });

    it.each([PaymentStatus.PAID, PaymentStatus.FAILED])(
      'explicit SASPAY invoiceId with status %s → 409, status untouched',
      async (status) => {
        const { admin, invoiceId, tenantId } = await setup(PaymentProvider.SASPAY, status);
        const res = await post(`/api/subscriptions/${tenantId}/activate`, admin.accessToken).send({ invoiceId }).expect(409);
        expect(res.body.errorCode).toBe(SASPAY_CODE);
        expect((await prisma.invoice.findUnique({ where: { id: invoiceId } }))?.status).toBe(status);
      },
    );

    it('MANUAL PENDING, no invoiceId → existing behaviour (200)', async () => {
      const { admin, tenantId } = await setup(PaymentProvider.MANUAL);
      await post(`/api/subscriptions/${tenantId}/activate`, admin.accessToken).send({}).expect(200);
    });

    it('explicit MANUAL PENDING invoiceId → existing behaviour (200, invoice PAID)', async () => {
      const { admin, invoiceId, tenantId } = await setup(PaymentProvider.MANUAL);
      await post(`/api/subscriptions/${tenantId}/activate`, admin.accessToken).send({ invoiceId }).expect(200);
      expect((await prisma.invoice.findUnique({ where: { id: invoiceId } }))?.status).toBe('PAID');
    });

    it('no invoiceId and no SASPAY PENDING (only a PAID SASPAY) → guard does not fire', async () => {
      const { admin, tenantId } = await setup(PaymentProvider.SASPAY, PaymentStatus.PAID);
      const res = await post(`/api/subscriptions/${tenantId}/activate`, admin.accessToken).send({});
      expect(res.status).not.toBe(409);
    });

    it('invoice of ANOTHER tenant → same 404 as an unknown id (no 409 leak), nothing changed', async () => {
      const a = await setup(PaymentProvider.MANUAL);
      const b = await setup(PaymentProvider.SASPAY);
      const c = await setup(PaymentProvider.MANUAL);
      const unknown = await post(`/api/subscriptions/${a.tenantId}/activate`, a.admin.accessToken)
        .send({ invoiceId: ZERO_UUID }).expect(404);
      const crossSaspay = await post(`/api/subscriptions/${a.tenantId}/activate`, a.admin.accessToken)
        .send({ invoiceId: b.invoiceId }).expect(404);
      await post(`/api/subscriptions/${a.tenantId}/activate`, a.admin.accessToken)
        .send({ invoiceId: c.invoiceId }).expect(404);
      expect(crossSaspay.body).toEqual(unknown.body);
      expect((await prisma.invoice.findUnique({ where: { id: b.invoiceId } }))?.status).toBe('PENDING');
      expect((await prisma.invoice.findUnique({ where: { id: c.invoiceId } }))?.status).toBe('PENDING');
      expect((await prisma.subscription.findUnique({ where: { tenantId: a.tenantId } }))?.plan).not.toBe('PRO');
    });

    it('unknown tenant → 404 TENANT_NOT_FOUND', async () => {
      const { admin } = await setup(PaymentProvider.MANUAL);
      const res = await post(`/api/subscriptions/${ZERO_UUID}/activate`, admin.accessToken).send({}).expect(404);
      expect(res.body.errorCode).toBe('TENANT_NOT_FOUND');
    });

    it('activate() is never reached when the guard returns 409', async () => {
      const { admin, tenantId } = await setup(PaymentProvider.SASPAY);
      const spy = jest.spyOn(app.get(SubscriptionsService), 'activate');
      await post(`/api/subscriptions/${tenantId}/activate`, admin.accessToken).send({}).expect(409);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('POST /subscriptions/upload-proof → 410 before multipart and any business work', () => {
    const BIG = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(6 * 1024 * 1024, 0x41)]);
    const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('synthetic')]);

    const sideEffects = async (tenantId: string, invoiceId: string) => ({
      proofs: await prisma.paymentProof.count({ where: { invoiceId } }),
      notifications: await prisma.notification.count({ where: { tenantId } }),
      uploadAudits: await prisma.auditLog.count({ where: { action: 'UPLOAD' } }),
      files: (await readdir(PROOFS_DIR)).length,
    });

    const variants: Array<[string, (r: request.Test) => request.Test]> = [
      ['no file / empty JSON body', (r) => r.send({})],
      ['small valid JPEG', (r) => r.field('invoiceId', 'x').field('method', 'WAVE').attach('file', JPEG, { filename: 'p.jpg', contentType: 'image/jpeg' })],
      ['file > 5 MB', (r) => r.field('invoiceId', 'x').field('method', 'WAVE').attach('file', BIG, { filename: 'p.png', contentType: 'image/png' })],
      ['invalid mimetype', (r) => r.field('invoiceId', 'x').field('method', 'WAVE').attach('file', Buffer.from('<html>'), { filename: 'p.html', contentType: 'text/html' })],
    ];

    it.each(variants)('%s → identical 410 contract and zero side effect', async (_name, build) => {
      const { ownerLogin, invoiceId, tenantId } = await setup(PaymentProvider.MANUAL);
      await mkdir(PROOFS_DIR, { recursive: true });
      const before = await sideEffects(tenantId, invoiceId);
      const tmpBefore = new Set(await readdir(tmpdir()));
      const outcome = await build(
        request(app.getHttpServer()).post('/api/subscriptions/upload-proof').set('Authorization', `Bearer ${ownerLogin.accessToken}`),
      ).then(
        (res) => ({ status: res.status, body: res.body as Record<string, unknown> } as { status: number; body: Record<string, unknown> }),
        (err: NodeJS.ErrnoException) => ({ status: 0, body: { reset: err.code } } as { status: number; body: Record<string, unknown> }),
      );
      if (_name === 'file > 5 MB') {
        // Limite globale Fastify (bodyLimit 1 MiB) : le corps est refusé avant
        // le contrôleur (413 ou connexion coupée), jamais traité. Documenté.
        expect([0, 410, 413]).toContain(outcome.status);
      } else {
        expect(outcome.status).toBe(410);
        expect(outcome.body).toMatchObject({ success: false, data: null, errorCode: 'MANUAL_PAYMENT_PROOF_DISABLED' });
        expect(typeof (outcome.body as Record<string, unknown>).message).toBe('string');
      }
      expect(await sideEffects(tenantId, invoiceId)).toEqual(before);
      // tmpdir est partagé (autres processus peuvent y créer/supprimer) :
      // on ne regarde que les NOUVELLES entrées liées à un upload multipart.
      const tmpNew = (await readdir(tmpdir())).filter((f) => !tmpBefore.has(f));
      expect(tmpNew.filter((f) => /multipart|busboy|fastify|upload|proof/i.test(f))).toEqual([]);
      expect(before.proofs).toBe(0);
    });
  });

  describe('historical proofs stay readable', () => {
    async function seedHistoricalProof() {
      const ctx = await setup(PaymentProvider.MANUAL, PaymentStatus.PAID);
      await mkdir(PROOFS_DIR, { recursive: true });
      const filename = `hist-${Date.now()}-${Math.floor(Math.random() * 1e9)}.png`;
      await writeFile(join(PROOFS_DIR, filename), PNG);
      const proof = await prisma.paymentProof.create({
        data: { invoiceId: ctx.invoiceId, method: 'WAVE', imageUrl: `/private-uploads/proofs/${filename}` },
      });
      return { ...ctx, proofId: proof.id };
    }

    it('admin lists proofs of a MANUAL invoice', async () => {
      const { admin, invoiceId, proofId } = await seedHistoricalProof();
      const res = await request(app.getHttpServer())
        .get(`/api/admin/invoices/${invoiceId}/proofs`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(JSON.stringify(res.body)).toContain(proofId);
    });

    it('owner and SUPER_ADMIN download the file; other tenant gets 404', async () => {
      const { admin, ownerLogin, proofId } = await seedHistoricalProof();
      await request(app.getHttpServer()).get(`/api/subscriptions/proofs/${proofId}`).set('Authorization', `Bearer ${ownerLogin.accessToken}`).expect(200);
      await request(app.getHttpServer()).get(`/api/subscriptions/proofs/${proofId}`).set('Authorization', `Bearer ${admin.accessToken}`).expect(200);
      const other = await signupUser(app);
      const otherLogin = await loginUser(app, other.email, other.password);
      await request(app.getHttpServer()).get(`/api/subscriptions/proofs/${proofId}`).set('Authorization', `Bearer ${otherLogin.accessToken}`).expect(404);
    });
  });

  describe('SasPay webhook unchanged', () => {
    async function seedIntent() {
      const ctx = await setup(PaymentProvider.SASPAY);
      const ref = `TXN-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      const user = await prisma.user.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
      const intent = await prisma.paymentIntent.create({
        data: {
          tenantId: ctx.tenantId,
          userId: user.id,
          invoiceId: ctx.invoiceId,
          idempotencyKey: `idem-${ref}`,
          providerSessionId: `cs-${ref}`,
          amountRequested: ctx.invoice.amount,
        },
      });
      return { ...ctx, intent, ref };
    }
    const evt = (ref: string, sessionId: string, amount: number) => ({
      event: 'transaction.success',
      timestamp: Date.now(),
      data: { id: sessionId, reference: ref, charged: amount, net_amount: amount, fee: 0, currency: 'XOF' },
    });

    it('transaction.success activates subscription and marks invoice PAID', async () => {
      const { tenantId, invoiceId, intent, ref, invoice } = await seedIntent();
      const r = await app
        .get(SaspayService)
        .handleWebhookEvent(evt(ref, intent.providerSessionId as string, invoice.amount) as never, `h-${ref}`);
      expect(r.reason).toBe('activated');
      expect((await prisma.invoice.findUnique({ where: { id: invoiceId } }))?.status).toBe('PAID');
      expect((await prisma.subscription.findUnique({ where: { tenantId } }))?.plan).toBe('PRO');
    });

    it('webhook calls activate() and never activateManually()', async () => {
      const { intent, ref, invoice } = await seedIntent();
      const subs = app.get(SubscriptionsService);
      const act = jest.spyOn(subs, 'activate');
      const man = jest.spyOn(subs, 'activateManually');
      await app
        .get(SaspayService)
        .handleWebhookEvent(evt(ref, intent.providerSessionId as string, invoice.amount) as never, `hs-${ref}`);
      expect(act).toHaveBeenCalledTimes(1);
      expect(man).not.toHaveBeenCalled();
      act.mockRestore();
      man.mockRestore();
    });

    it('underpaid success does not activate (amount guard unchanged)', async () => {
      const { tenantId, intent, ref, invoice } = await seedIntent();
      const r = await app
        .get(SaspayService)
        .handleWebhookEvent(evt(ref, intent.providerSessionId as string, invoice.amount - 1) as never, `hu-${ref}`);
      expect(r.reason).toBe('amount_mismatch');
      expect((await prisma.subscription.findUnique({ where: { tenantId } }))?.plan).not.toBe('PRO');
    });

    it('redelivery never extends the period twice (characterises current behaviour)', async () => {
      const { tenantId, intent, ref, invoice } = await seedIntent();
      const saspay = app.get(SaspayService);
      const e = evt(ref, intent.providerSessionId as string, invoice.amount) as never;
      await saspay.handleWebhookEvent(e, `h1-${ref}`);
      const end1 = (await prisma.subscription.findUnique({ where: { tenantId } }))?.currentPeriodEnd;
      expect((await saspay.handleWebhookEvent(e, `h1-${ref}`)).reason).toBe('duplicate_delivery');
      // Défaut séparé, hors périmètre : même référence + eventHash différent →
      // l'update de l'intent ne lève pas P2002 (même ligne), `activate` est
      // rappelé et lève INVOICE_ALREADY_PROCESSED (HTTP 400 côté webhook).
      // Aucune double extension.
      await expect(saspay.handleWebhookEvent(e, `h2-${ref}`)).rejects.toMatchObject({
        message: expect.stringContaining('déjà été traitée'),
      });
      expect((await prisma.subscription.findUnique({ where: { tenantId } }))?.currentPeriodEnd).toEqual(end1);
    });
  });
});
