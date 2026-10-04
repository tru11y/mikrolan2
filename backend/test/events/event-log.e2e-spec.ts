/**
 * EventLog unifié — chemin réel : action métier -> trace en base -> Audit Center.
 * DB PostgreSQL réelle (testcontainers), injection Nest réelle.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser, promoteToSuperAdmin } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('EventLog unifié (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  let tenantId: string;
  let owner: string;
  let admin: string;
  let routerId: string;
  let planId: string;
  let batchId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const rows = (where: Record<string, unknown>) =>
    prisma.auditLog.findMany({ where: { tenantId, ...where }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const user = await signupUser(app, { tenantName: 'Events Tenant' });
    owner = (await loginUser(app, user.email, user.password)).accessToken;
    tenantId = (await prisma.tenant.findFirstOrThrow({ where: { users: { some: { email: user.email } } } })).id;

    const adminUser = await signupUser(app, { tenantName: 'Platform' });
    admin = (await promoteToSuperAdmin(app, adminUser.email, adminUser.password)).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('routeur créé : SUCCESS tracé avec son id', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/routers')
      .set(auth(owner))
      .send({ identity: `evt-${Date.now()}`, mode: 'LOCAL' })
      .expect(201);
    routerId = res.body.data.id;

    const [row] = await rows({ entityType: 'Router', action: 'CREATE' });
    expect(row).toMatchObject({ entityId: routerId, outcome: 'SUCCESS' });
  });

  it('routeur en doublon : FAILED tracé avec un code, l API répond une vraie erreur', async () => {
    const identity = `dup-${Date.now()}`;
    await request(app.getHttpServer()).post('/api/routers').set(auth(owner)).send({ identity, mode: 'LOCAL' }).expect(201);
    await request(app.getHttpServer()).post('/api/routers').set(auth(owner)).send({ identity, mode: 'LOCAL' }).expect(409);

    const failed = await rows({ entityType: 'Router', outcome: 'FAILED' });
    expect(failed).toHaveLength(1);
    expect(failed[0].metadata).toMatchObject({ identity, errorCode: 'ROUTER_DUPLICATE_IDENTITY' });
  });

  it('forfait créé : SUCCESS ; forfait inexistant modifié : FAILED avec ROUTER/PLAN code', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/routers/${routerId}/plans`)
      .set(auth(owner))
      .send({ name: '1 heure', durationMinutes: 60, priceXof: 500 })
      .expect(201);
    planId = res.body.data.id;
    expect(await rows({ entityType: 'Plan', action: 'CREATE', outcome: 'SUCCESS' })).toHaveLength(1);

    await request(app.getHttpServer())
      .patch(`/api/routers/${routerId}/plans/00000000-0000-4000-8000-000000000000`)
      .set(auth(owner))
      .send({ priceXof: 600 })
      .expect(404);
    const failed = await rows({ entityType: 'Plan', action: 'UPDATE', outcome: 'FAILED' });
    expect(failed).toHaveLength(1);
    expect(failed[0].metadata).toMatchObject({ errorCode: 'PLAN_NOT_FOUND' });
  });

  it('génération LAN : SUCCESS "en attente du push", puis échec LAN signalé => lot FAILED + événement FAILED', async () => {
    const gen = await request(app.getHttpServer())
      .post(`/api/routers/${routerId}/vouchers/generate`)
      .set(auth(owner))
      .send({ planId, quantity: 3 })
      .expect(200);
    batchId = gen.body.data.batchId;
    expect(gen.body.data).toMatchObject({ pushedByServer: false, totalCount: 3 });

    const [created] = await rows({ entityType: 'VoucherBatch', entityId: batchId, action: 'CREATE' });
    expect(created).toMatchObject({ outcome: 'SUCCESS' });
    expect(created.metadata).toMatchObject({ via: 'lan', awaitingLanPush: true });

    await request(app.getHttpServer())
      .post(`/api/routers/${routerId}/vouchers/push-failure`)
      .set(auth(owner))
      .send({ batchId, reason: 'Routeur injoignable (timeout)', errorCode: 'LanUnreachableError' })
      .expect(200);

    const batch = await prisma.voucherBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe('FAILED');
    const [failed] = await rows({ entityType: 'VoucherBatch', entityId: batchId, action: 'UPDATE' });
    expect(failed).toMatchObject({ outcome: 'FAILED' });
    expect(failed.metadata).toMatchObject({ errorCode: 'LanUnreachableError', totalCount: 3 });
  });

  it('confirmation LAN partielle : lot PARTIAL_SUCCESS + événement PARTIAL_SUCCESS', async () => {
    const gen = await request(app.getHttpServer())
      .post(`/api/routers/${routerId}/vouchers/generate`)
      .set(auth(owner))
      .send({ planId, quantity: 4 })
      .expect(200);
    const partialBatch = gen.body.data.batchId as string;
    const two = gen.body.data.vouchers.slice(0, 2).map((v: { id: string }, i: number) => ({ id: v.id, mikrotikId: `*${i}` }));

    await request(app.getHttpServer())
      .post(`/api/routers/${routerId}/vouchers/confirm`)
      .set(auth(owner))
      .send({ batchId: partialBatch, items: two })
      .expect(200);

    const batch = await prisma.voucherBatch.findUniqueOrThrow({ where: { id: partialBatch } });
    expect(batch).toMatchObject({ status: 'PARTIAL_SUCCESS', generated: 2 });
    const [row] = await rows({ entityId: partialBatch, action: 'UPDATE' });
    expect(row).toMatchObject({ outcome: 'PARTIAL_SUCCESS' });
    expect(row.metadata).toMatchObject({ confirmed: 2, totalCount: 4 });
  });

  // Contrat consommé par le mobile pour un routeur LOCAL : le lot arrive en GENERATING, le
  // téléphone pousse en LAN puis confirme ; seul un ticket confirmé (mikrotikId) est distribuable.
  describe('génération LAN — provisionnement (contrat mobile)', () => {
    const generateLan = async (quantity: number) => {
      const gen = await request(app.getHttpServer())
        .post(`/api/routers/${routerId}/vouchers/generate`)
        .set(auth(owner))
        .send({ planId, quantity })
        .expect(200);
      return gen.body.data as { batchId: string; batchStatus: string; pushedByServer: boolean; push?: unknown; vouchers: { id: string }[] };
    };
    const listed = async (batchId: string, includeUnprovisioned = false) =>
      (
        await request(app.getHttpServer())
          .get(`/api/routers/${routerId}/vouchers`)
          .query({ batchId, ...(includeUnprovisioned ? { includeUnprovisioned: 'true' } : {}) })
          .set(auth(owner))
          .expect(200)
      ).body.data as { id: string; provisioned: boolean }[];
    const batchCounts = async (batchId: string) => {
      const res = await request(app.getHttpServer()).get(`/api/routers/${routerId}/vouchers/batches`).set(auth(owner)).expect(200);
      return (res.body.data as { id: string; status: string; voucherCount: number; provisionedCount: number }[]).find((b) => b.id === batchId);
    };
    const confirm = (batchId: string, ids: string[]) =>
      request(app.getHttpServer())
        .post(`/api/routers/${routerId}/vouchers/confirm`)
        .set(auth(owner))
        .send({ batchId, items: ids.map((id, i) => ({ id, mikrotikId: `*L${i}` })) })
        .expect(200);

    it('COMPLETED : GENERATING + push présent, rien de distribuable avant confirm, 10/10 après', async () => {
      const gen = await generateLan(10);
      expect(gen).toMatchObject({ batchStatus: 'GENERATING', pushedByServer: false });
      expect(gen.push).toBeDefined();
      expect(await listed(gen.batchId)).toHaveLength(0);

      await confirm(gen.batchId, gen.vouchers.map((v) => v.id));

      const ready = await listed(gen.batchId);
      expect(ready).toHaveLength(10);
      expect(ready.every((v) => v.provisioned)).toBe(true);
      expect(await batchCounts(gen.batchId)).toMatchObject({ status: 'COMPLETED', voucherCount: 10, provisionedCount: 10 });
    });

    it('PARTIAL_SUCCESS : 10 préparés, 8 confirmés => 8 distribuables, 10 visibles avec includeUnprovisioned', async () => {
      const gen = await generateLan(10);
      await confirm(gen.batchId, gen.vouchers.slice(0, 8).map((v) => v.id));

      expect(await listed(gen.batchId)).toHaveLength(8);
      const audit = await listed(gen.batchId, true);
      expect(audit).toHaveLength(10);
      expect(audit.filter((v) => !v.provisioned)).toHaveLength(2);
      expect(await batchCounts(gen.batchId)).toMatchObject({ status: 'PARTIAL_SUCCESS', voucherCount: 10, provisionedCount: 8 });
    });

    it('FAILED : 10 préparés, 0 confirmé (push-failure) => 0 distribuable, lot FAILED', async () => {
      const gen = await generateLan(10);
      await request(app.getHttpServer())
        .post(`/api/routers/${routerId}/vouchers/push-failure`)
        .set(auth(owner))
        .send({ batchId: gen.batchId, reason: 'Routeur injoignable (timeout)', errorCode: 'LanUnreachableError' })
        .expect(200);

      expect(await listed(gen.batchId)).toHaveLength(0);
      expect(await listed(gen.batchId, true)).toHaveLength(10);
      expect(await batchCounts(gen.batchId)).toMatchObject({ status: 'FAILED', voucherCount: 10, provisionedCount: 0 });
    });
  });

  it('coffre PDF : dépôt SUCCESS, refus de type FAILED, téléchargement SUCCESS, introuvable FAILED', async () => {
    const base = `/api/routers/${routerId}/vouchers`;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    const up = await request(app.getHttpServer())
      .post(`${base}/batches/${batchId}/vault`)
      .set(auth(owner))
      .attach('file', pdf, { filename: 'lot.pdf', contentType: 'application/pdf' })
      .expect(201);
    const vaultId = up.body.data.id as string;
    const [stored] = await rows({ entityType: 'TicketVault', action: 'CREATE', outcome: 'SUCCESS' });
    expect(stored).toMatchObject({ entityId: vaultId });
    expect(stored.metadata).toMatchObject({ batchId });

    await request(app.getHttpServer())
      .post(`${base}/batches/${batchId}/vault`)
      .set(auth(owner))
      .attach('file', Buffer.from('pas un pdf'), { filename: 'x.txt', contentType: 'text/plain' })
      .expect(400);
    const refused = await rows({ entityType: 'TicketVault', action: 'CREATE', outcome: 'FAILED' });
    expect(refused).toHaveLength(1);
    expect(refused[0].metadata).toMatchObject({ errorCode: 'FILE_TYPE_UNSUPPORTED' });

    await request(app.getHttpServer()).get(`${base}/vault/${vaultId}`).set(auth(owner)).expect(200);
    expect(await rows({ entityType: 'TicketVault', action: 'EXPORT', outcome: 'SUCCESS' })).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`${base}/vault/00000000-0000-4000-8000-000000000000`)
      .set(auth(owner))
      .expect(404);
    const missing = await rows({ entityType: 'TicketVault', action: 'EXPORT', outcome: 'FAILED' });
    expect(missing).toHaveLength(1);
    expect(missing[0].metadata).toMatchObject({ errorCode: 'VAULT_PDF_NOT_FOUND', reason: 'not_found' });
  });

  it('action LAN déclarée par l app (reboot diagnostic en échec) : tracée en Diagnostic FAILED', async () => {
    await request(app.getHttpServer())
      .post(`/api/routers/${routerId}/events`)
      .set(auth(owner))
      .send({ kind: 'REBOOT', outcome: 'FAILED', errorCode: 'LanUnreachableError', message: 'Routeur injoignable (timeout)' })
      .expect(200);

    const [row] = await rows({ entityType: 'Diagnostic', action: 'REBOOT' });
    expect(row).toMatchObject({ entityId: routerId, outcome: 'FAILED' });
    expect(row.metadata).toMatchObject({ source: 'app', via: 'lan', errorCode: 'LanUnreachableError' });
  });

  it('un routeur d un autre tenant ne peut pas recevoir d événement', async () => {
    const other = await signupUser(app, { tenantName: 'Other' });
    const otherToken = (await loginUser(app, other.email, other.password)).accessToken;
    await request(app.getHttpServer())
      .post(`/api/routers/${routerId}/events`)
      .set(auth(otherToken))
      .send({ kind: 'REBOOT', outcome: 'SUCCESS' })
      .expect(404);
  });

  it('ticket de support : SUCCESS tracé en catégorie SUPPORT', async () => {
    await request(app.getHttpServer())
      .post('/api/support/tickets')
      .set(auth(owner))
      .send({ subject: 'Tickets non reçus', body: 'Le lot 3 n est pas sur le routeur.' })
      .expect(201);
    const [row] = await rows({ entityType: 'SupportTicket', action: 'CREATE' });
    expect(row).toMatchObject({ outcome: 'SUCCESS' });
  });

  describe('Audit Center (GET /api/admin/audit)', () => {
    it('filtre par catégorie et résultat, expose category + outcome + code d erreur', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/audit')
        .query({ tenantId, category: 'TICKETS', outcome: 'FAILED', limit: 50 })
        .set(auth(admin))
        .expect(200);

      const items = res.body.data.items as Array<Record<string, any>>;
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.category).toBe('TICKETS');
        expect(item.outcome).toBe('FAILED');
      }
      expect(items.some((i) => i.entityType === 'VoucherBatch' && i.metadata?.errorCode === 'LanUnreachableError')).toBe(true);
    });

    it('catégorie VAULT : dépôt réussi et refusé visibles', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/audit')
        .query({ tenantId, category: 'VAULT' })
        .set(auth(admin))
        .expect(200);
      const items = res.body.data.items as Array<Record<string, any>>;
      expect(items.every((i) => i.entityType === 'TicketVault' && i.category === 'VAULT')).toBe(true);
      expect(new Set(items.map((i) => i.outcome))).toEqual(new Set(['SUCCESS', 'FAILED']));
    });

    it('catégorie DIAGNOSTICS : ne renvoie que des diagnostics', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/audit')
        .query({ tenantId, category: 'DIAGNOSTICS' })
        .set(auth(admin))
        .expect(200);
      const items = res.body.data.items as Array<Record<string, any>>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.entityType === 'Diagnostic')).toBe(true);
    });

    it('les quatre résultats existent et PARTIAL_SUCCESS est filtrable', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/audit')
        .query({ tenantId, outcome: 'PARTIAL_SUCCESS' })
        .set(auth(admin))
        .expect(200);
      const items = res.body.data.items as Array<Record<string, any>>;
      expect(items.some((i) => i.entityType === 'VoucherBatch')).toBe(true);
      expect(items.every((i) => i.outcome === 'PARTIAL_SUCCESS')).toBe(true);
    });

    it('refuse un filtre de catégorie inconnu et interdit l accès au non super-admin', async () => {
      await request(app.getHttpServer()).get('/api/admin/audit').query({ category: 'NOPE' }).set(auth(admin)).expect(400);
      await request(app.getHttpServer()).get('/api/admin/audit').set(auth(owner)).expect(403);
    });
  });
});
