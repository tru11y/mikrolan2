/**
 * Contrat API de Plan.sharedUsers (appareils simultanés) : obligatoire à la création, entier >= 1,
 * aucune valeur par défaut silencieuse ni côté API ni côté base. DB PostgreSQL réelle.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Plan.sharedUsers — contrat API et base (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let owner: string;
  let routerId: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const base = { name: 'Forfait', durationMinutes: 60, priceXof: 500 };
  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/api/routers/${routerId}/plans`).set(auth()).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const user = await signupUser(app, { tenantName: 'SharedUsers Tenant' });
    owner = (await loginUser(app, user.email, user.password)).accessToken;
    const res = await request(app.getHttpServer())
      .post('/api/routers')
      .set(auth())
      .send({ identity: `su-${Date.now()}`, mode: 'LOCAL' })
      .expect(201);
    routerId = res.body.data.id;
  });

  afterAll(async () => app.close());

  it('création sans sharedUsers : 400, rien n’est créé', async () => {
    const before = await prisma.plan.count({ where: { routerId } });
    const res = await post(base).expect(400);
    expect(JSON.stringify(res.body)).toContain('sharedUsers');
    expect(await prisma.plan.count({ where: { routerId } })).toBe(before);
  });

  it.each([0, -1, 1.5, '2', null, 1001])('création avec sharedUsers=%p : 400', async (v) => {
    await post({ ...base, sharedUsers: v }).expect(400);
  });

  it('création avec un entier >= 1 : 201, valeur renvoyée et stockée telle quelle', async () => {
    const res = await post({ ...base, name: 'Deux appareils', sharedUsers: 2 }).expect(201);
    expect(res.body.data.sharedUsers).toBe(2);
    const row = await prisma.plan.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.sharedUsers).toBe(2);
  });

  it('lecture : l’API expose sharedUsers pour chaque forfait', async () => {
    const res = await request(app.getHttpServer()).get(`/api/routers/${routerId}/plans`).set(auth()).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const p of res.body.data) expect(Number.isInteger(p.sharedUsers) && p.sharedUsers >= 1).toBe(true);
  });

  it('modification : champ absent accepté (valeur inchangée), 0 / négatif / décimal refusés, entier accepté', async () => {
    const created = await post({ ...base, name: 'A modifier', sharedUsers: 3 }).expect(201);
    const url = `/api/routers/${routerId}/plans/${created.body.data.id}`;
    await request(app.getHttpServer()).patch(url).set(auth()).send({ name: 'Renommé' }).expect(200);
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: created.body.data.id } })).sharedUsers).toBe(3);
    for (const v of [0, -2, 2.5]) {
      await request(app.getHttpServer()).patch(url).set(auth()).send({ sharedUsers: v }).expect(400);
    }
    await request(app.getHttpServer()).patch(url).set(auth()).send({ sharedUsers: 5 }).expect(200);
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: created.body.data.id } })).sharedUsers).toBe(5);
  });

  it('base : aucune valeur par défaut — une insertion sans sharedUsers est refusée', async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Plan" ("id","tenantId","routerId","name","slug","durationMinutes","priceXof","updatedAt")
         SELECT 'np-' || gen_random_uuid()::text, "tenantId", "routerId", 'X', 'x-' || gen_random_uuid()::text, 60, 100, now()
         FROM "Plan" WHERE "routerId" = '${routerId}' LIMIT 1`,
      ),
    ).rejects.toThrow();
  });
});
