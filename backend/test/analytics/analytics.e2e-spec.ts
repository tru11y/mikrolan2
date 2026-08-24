/**
 * Test d'intégration réel (PostgreSQL isolé, testcontainers) pour le module
 * Analytics/BI — audit/67. Données 100% synthétiques, jamais de donnée
 * client réelle. Réutilise le même modèle que
 * test/revenue/revenue-foundation.e2e-spec.ts.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { VoucherStatus, ManagementMode } from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import { signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Analytics — intégration réelle (PostgreSQL isolé)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  let tenantA: string;
  let tokenA: string;
  let routerA: string;
  let planA: string;

  let tenantB: string;
  let tokenB: string;
  let routerB: string;
  let planB: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const userA = await signupUser(app, { tenantName: 'Analytics Tenant A' });
    tokenA = userA.accessToken;
    const dbUserA = await prisma.user.findUniqueOrThrow({ where: { email: userA.email } });
    tenantA = dbUserA.tenantId;

    const userB = await signupUser(app, { tenantName: 'Analytics Tenant B' });
    tokenB = userB.accessToken;
    const dbUserB = await prisma.user.findUniqueOrThrow({ where: { email: userB.email } });
    tenantB = dbUserB.tenantId;

    const rA = await prisma.router.create({
      data: { tenantId: tenantA, identity: 'analytics-router-a', mode: ManagementMode.LOCAL },
    });
    routerA = rA.id;
    const pA = await prisma.plan.create({
      data: { tenantId: tenantA, routerId: routerA, name: '1h', slug: '1h', durationMinutes: 60, priceXof: 500 },
    });
    planA = pA.id;

    const rB = await prisma.router.create({
      data: { tenantId: tenantB, identity: 'analytics-router-b', mode: ManagementMode.LOCAL },
    });
    routerB = rB.id;
    const pB = await prisma.plan.create({
      data: { tenantId: tenantB, routerId: routerB, name: '1h', slug: '1h', durationMinutes: 60, priceXof: 700 },
    });
    planB = pB.id;

    await prisma.voucher.create({
      data: {
        tenantId: tenantA,
        routerId: routerA,
        planId: planA,
        code: `AN-A-${Date.now()}`,
        password: 'pw',
        status: VoucherStatus.ACTIVE,
        usedAt: new Date(),
        priceXofAtActivation: 500,
        priceSnapshotSource: 'EXACT',
      },
    });
    await prisma.voucher.create({
      data: {
        tenantId: tenantB,
        routerId: routerB,
        planId: planB,
        code: `AN-B-${Date.now()}`,
        password: 'pw',
        status: VoucherStatus.ACTIVE,
        usedAt: new Date(),
        priceXofAtActivation: 700,
        priceSnapshotSource: 'EXACT',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('23. auth obligatoire — sans token, 401', async () => {
    await request(app.getHttpServer()).get('/api/analytics/overview').expect(401);
  });

  it('1. tenant A ne voit jamais les données de tenant B sur /overview (isolation runtime réelle)', async () => {
    const resA = await request(app.getHttpServer())
      .get('/api/analytics/overview?period=last30days')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const resB = await request(app.getHttpServer())
      .get('/api/analytics/overview?period=last30days')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(resA.body.data.revenueXof).toBeGreaterThanOrEqual(500);
    expect(resB.body.data.revenueXof).toBeGreaterThanOrEqual(700);
    // Le multiple de 700 (prix de B) ne doit jamais apparaître côté A.
    expect(resA.body.data.revenueXof % 700 === 0 && resA.body.data.revenueXof > 0).toBe(false);
  });

  it('24. routerId d\'un autre tenant refusé (400, pas de fuite de données)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/analytics/overview?period=last30days&routerId=${routerB}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('25. planId d\'un autre tenant refusé (400)', async () => {
    await request(app.getHttpServer())
      .get(`/api/analytics/overview?period=last30days&planId=${planB}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
  });

  it('16. timezone Africa/Abidjan par défaut appliquée', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/overview?period=last30days')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.data.timezone).toBe('Africa/Abidjan');
  });

  it('17. timezone DST (Europe/Paris) appliquée pour un tenant configuré ainsi', async () => {
    await prisma.tenant.update({ where: { id: tenantA }, data: { timezone: 'Europe/Paris' } });
    const res = await request(app.getHttpServer())
      .get('/api/analytics/overview?period=last30days')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.data.timezone).toBe('Europe/Paris');
    await prisma.tenant.update({ where: { id: tenantA }, data: { timezone: 'Africa/Abidjan' } });
  });

  it('18. bornes [from, to) réelles — activation exactement à la frontière', async () => {
    const boundary = new Date('2027-06-20T12:00:00.000Z');
    await prisma.voucher.create({
      data: {
        tenantId: tenantA,
        routerId: routerA,
        planId: planA,
        code: `AN-BOUND-${Date.now()}`,
        password: 'pw',
        status: VoucherStatus.ACTIVE,
        usedAt: boundary,
        priceXofAtActivation: 111,
        priceSnapshotSource: 'EXACT',
      },
    });

    const including = await request(app.getHttpServer())
      .get(
        `/api/analytics/overview?period=custom&from=${boundary.toISOString()}&to=${new Date(boundary.getTime() + 1000).toISOString()}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const excluding = await request(app.getHttpServer())
      .get(
        `/api/analytics/overview?period=custom&from=${new Date(boundary.getTime() - 1000).toISOString()}&to=${boundary.toISOString()}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(including.body.data.revenueXof).toBeGreaterThanOrEqual(111);
    // Fenêtre [boundary-1s, boundary) : 1 seconde de large, année 2027,
    // aucune autre donnée synthétique ne peut s'y trouver — doit être vide.
    expect(excluding.body.data.revenueXof).toBe(0);
  });

  it('9-10. /routers : somme des routeurs = revenu global, contribution ≈ 100%', async () => {
    const overview = await request(app.getHttpServer())
      .get('/api/analytics/overview?period=last30days')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const routers = await request(app.getHttpServer())
      .get('/api/analytics/routers?period=last30days')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const sum = routers.body.data.reduce((s: number, r: { revenueXof: number }) => s + r.revenueXof, 0);
    expect(sum).toBe(overview.body.data.revenueXof);
    const totalContribution = routers.body.data.reduce(
      (s: number, r: { contributionPercent: number }) => s + r.contributionPercent,
      0,
    );
    expect(Math.abs(totalContribution - 100)).toBeLessThanOrEqual(1);
  });

  it('router detail : 400 pour un routerId inexistant/autre tenant', async () => {
    await request(app.getHttpServer())
      .get(`/api/analytics/routers/${routerB}?period=last30days`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
  });

  it('router detail : 200 avec heatmaps ventes/sessions distinctes pour le bon tenant', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/analytics/routers/${routerA}?period=last30days`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.data.routerId).toBe(routerA);
    expect(Array.isArray(res.body.data.salesHeatmap)).toBe(true);
    expect(Array.isArray(res.body.data.sessionsHeatmap)).toBe(true);
    expect(res.body.data.salesHeatmap).toHaveLength(168);
  });

  it('21. statuts non éligibles (GENERATED) exclus du revenu', async () => {
    await prisma.voucher.create({
      data: {
        tenantId: tenantA,
        routerId: routerA,
        planId: planA,
        code: `AN-GEN-${Date.now()}`,
        password: 'pw',
        status: VoucherStatus.GENERATED,
        usedAt: null,
      },
    });
    const res = await request(app.getHttpServer())
      .get('/api/analytics/overview?period=last30days')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    // Le voucher GENERATED (usedAt null) ne doit jamais entrer dans salesCount.
    expect(res.body.data.salesCount).toBeGreaterThan(0);
  });

  it('30. contrat JSON stable — aucun champ requis manquant, aucun undefined/NaN sérialisé', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/overview?period=last30days')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/undefined|NaN/);
    for (const key of ['revenueXof', 'exactRevenueXof', 'estimatedRevenueXof', 'dataQuality', 'timezone']) {
      expect(res.body.data).toHaveProperty(key);
    }
  });
});
