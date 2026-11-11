import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Garde-fou de performance : recherche par préfixe sur un tenant de 5 000 tickets
 * (`PERF_N` pour monter en charge). Exigence : < 1 s. Le plan d'exécution est affiché.
 */
const N = Number(process.env.PERF_N ?? 5000);

describe(`Recherche de tickets — performance (${N} tickets)`, () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let token: string;
  let routerId: string;
  let tenantId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const owner = await signupUser(app, { tenantName: 'Perf', email: `perf-${Date.now()}@e2e.local` });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    tenantId = user.tenantId;
    token = (await loginUser(app, owner.email, owner.password)).accessToken;
    const router = await prisma.router.create({ data: { tenantId, identity: `perf-${Date.now()}` } });
    routerId = router.id;
    const plan = await prisma.plan.create({
      data: { tenantId, routerId, name: '1H', slug: '1h', durationMinutes: 60, sharedUsers: 1, priceXof: 500 },
    });
    const base = Date.now();
    const rows = Array.from({ length: N }, (_, i) => ({
      tenantId, planId: plan.id, routerId,
      code: `${['3d', '1d', '7h'][i % 3]}${String(1_000_000 + i)}`,
      password: 'x', mikrotikId: `*${i}`, createdAt: new Date(base - i * 1000),
    }));
    for (let i = 0; i < rows.length; i += 1000) await prisma.voucher.createMany({ data: rows.slice(i, i + 1000) });
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  const timed = async (qs: string) => {
    const t0 = process.hrtime.bigint();
    const res = await request(app.getHttpServer())
      .get(`/api/routers/${routerId}/vouchers/search${qs}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, res };
  };

  it('préfixe : < 1 s, et le plan d’exécution est tracé', async () => {
    await timed('?q=3d10'); // chauffe
    const runs = [] as number[];
    for (const q of ['3d10', '1d100', '7h2000', '3d1000']) runs.push((await timed(`?q=${q}&limit=50`)).ms);
    const worst = Math.max(...runs);
    // eslint-disable-next-line no-console
    console.log(`PERF N=${N} recherche préfixe (ms) : ${runs.map((r) => r.toFixed(1)).join(' / ')} — pire ${worst.toFixed(1)} ms`);
    expect(worst).toBeLessThan(1000);

    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN ANALYZE SELECT id, code FROM "Voucher" WHERE "tenantId" = '${tenantId}' AND "routerId" = '${routerId}' AND code ILIKE '3d10%' AND NOT ("mikrotikId" IS NULL OR "mikrotikId" = '') ORDER BY "createdAt" DESC, id DESC LIMIT 51`,
    );
    // eslint-disable-next-line no-console
    console.log(plan.map((r) => r['QUERY PLAN']).join('\n'));
  });

  it('pagination profonde : la dernière page reste < 1 s', async () => {
    let cursor: string | null = null;
    let worst = 0;
    let pages = 0;
    do {
      const qs: string = `?limit=200${cursor ? `&cursor=${cursor}` : ''}`;
      const { ms, res }: { ms: number; res: request.Response } = await timed(qs);
      worst = Math.max(worst, ms);
      cursor = res.body.data.nextCursor as string | null;
      pages++;
    } while (cursor);
    // eslint-disable-next-line no-console
    console.log(`PERF N=${N} pagination : ${pages} pages, pire page ${worst.toFixed(1)} ms`);
    expect(pages).toBe(Math.ceil(N / 200));
    expect(worst).toBeLessThan(1000);
  }, 120_000);
});
