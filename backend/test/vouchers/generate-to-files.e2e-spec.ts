import request from 'supertest';
import { VoucherStatus } from '@prisma/client';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Parcours Tickets → Fichiers (routeur LOCAL, cas courant) :
 * génération d'un lot → confirmation du push LAN → le lot apparaît dans « Fichiers »
 * avec les bons compteurs et ses tickets sont listés. Les ids de ticket sont ceux
 * renvoyés par la génération, pas inventés par le test.
 */
describe('Tickets → Fichiers (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let token: string;
  let routerId: string;
  let identity: string;
  let planId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const owner = await signupUser(app, { tenantName: 'Files', email: `files-${Date.now()}@e2e.local` });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    token = (await loginUser(app, owner.email, owner.password)).accessToken;
    identity = `files-${Date.now()}`;
    const router = await prisma.router.create({ data: { tenantId: user.tenantId, identity } });
    routerId = router.id;
    const plan = await prisma.plan.create({
      data: { tenantId: user.tenantId, routerId, name: '1 day', slug: '1day', durationMinutes: 1440, sharedUsers: 1, priceXof: 300 },
    });
    planId = plan.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const api = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](`/api/routers/${routerId}/vouchers${path}`).set('Authorization', `Bearer ${token}`);

  it('génère 3 tickets, confirme le push LAN, puis le lot est visible dans Fichiers', async () => {
    const gen = await api('post', '/generate').send({ planId, quantity: 3 }).expect(200);
    const data = gen.body.data as { batchId: string; vouchers?: { id: string; code: string }[]; items?: { id: string; code: string }[] };
    const created = data.vouchers ?? data.items ?? [];
    expect(data.batchId).toBeTruthy();
    expect(created).toHaveLength(3);

    // Avant confirmation : rien n'est « prêt à vendre » (aucune preuve côté routeur).
    const before = await api('get', '/batches').expect(200);
    const lotBefore = (before.body.data as { id: string; voucherCount: number; provisionedCount?: number }[]).find((b) => b.id === data.batchId);
    expect(lotBefore?.voucherCount).toBe(3);
    expect(lotBefore?.provisionedCount).toBe(0);

    await api('post', '/confirm')
      .send({
        batchId: data.batchId,
        observedRouterIdentity: identity,
        items: created.map((v, i) => ({ id: v.id, mikrotikId: `*${i + 1}A` })),
      })
      .expect(200);

    // Fichiers : le lot affiche 3 tickets prêts.
    const after = await api('get', '/batches').expect(200);
    const lot = (after.body.data as { id: string; voucherCount: number; provisionedCount: number; status: string }[]).find((b) => b.id === data.batchId);
    expect(lot).toMatchObject({ voucherCount: 3, provisionedCount: 3 });

    // Détail du lot : 3 tickets GENERATED, provisionnés.
    const list = await api('get', `?batchId=${data.batchId}`).expect(200);
    const rows = list.body.data as { code: string; status: VoucherStatus }[];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === VoucherStatus.GENERATED)).toBe(true);
    expect(new Set(rows.map((r) => r.code))).toEqual(new Set(created.map((c) => c.code)));
  });

  it('un push LAN confirmé avec une identité de routeur différente est refusé (lot non marqué prêt)', async () => {
    const gen = await api('post', '/generate').send({ planId, quantity: 1 }).expect(200);
    const data = gen.body.data as { batchId: string; vouchers?: { id: string }[]; items?: { id: string }[] };
    const created = data.vouchers ?? data.items ?? [];
    const res = await api('post', '/confirm').send({
      batchId: data.batchId,
      observedRouterIdentity: 'un-autre-routeur',
      items: created.map((v) => ({ id: v.id, mikrotikId: '*FF' })),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const lots = await api('get', '/batches').expect(200);
    const lot = (lots.body.data as { id: string; provisionedCount: number }[]).find((b) => b.id === data.batchId);
    expect(lot?.provisionedCount).toBe(0);
  });
});
