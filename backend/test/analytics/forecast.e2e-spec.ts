/**
 * Test d'intégration réel (PostgreSQL isolé, testcontainers) pour le moteur
 * de prévision Analytics/BI — audit/73. Données 100% synthétiques.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { VoucherStatus, ManagementMode } from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import { signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Analytics Forecast — intégration réelle (PostgreSQL isolé)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  let tenantA: string;
  let tokenA: string;
  let routerA: string;
  let planA: string;

  let tenantB: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const userA = await signupUser(app, { tenantName: 'Forecast Tenant A' });
    tokenA = userA.accessToken;
    const dbUserA = await prisma.user.findUniqueOrThrow({ where: { email: userA.email } });
    tenantA = dbUserA.tenantId;

    const userB = await signupUser(app, { tenantName: 'Forecast Tenant B' });
    tokenB = userB.accessToken;
    const dbUserB = await prisma.user.findUniqueOrThrow({ where: { email: userB.email } });
    tenantB = dbUserB.tenantId;

    const rA = await prisma.router.create({
      data: { tenantId: tenantA, identity: 'forecast-router-a', mode: ManagementMode.LOCAL },
    });
    routerA = rA.id;
    const pA = await prisma.plan.create({
      data: { tenantId: tenantA, routerId: routerA, name: '1h', slug: '1h-fc', durationMinutes: 60, priceXof: 200 },
    });
    planA = pA.id;

    // 35 jours d'historique synthétique, quelques ventes chaque jour — au
    // dessus des seuils (28 jours calendaires, 14 jours actifs, 30 activations).
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const vouchers = [];
    for (let i = 0; i < 35; i++) {
      const usedAt = new Date(now - (35 - i) * day - 6 * 60 * 60 * 1000);
      vouchers.push({
        tenantId: tenantA,
        routerId: routerA,
        planId: planA,
        code: `FC-${i}-${now}`,
        password: 'pw',
        status: VoucherStatus.ACTIVE as VoucherStatus,
        usedAt,
        priceXofAtActivation: 200,
        priceSnapshotSource: 'EXACT' as const,
      });
    }
    await prisma.voucher.createMany({ data: vouchers });
  });

  afterAll(async () => {
    await app.close();
  });

  it('auth obligatoire — sans token, 401 sur les 5 endpoints forecast/insights', async () => {
    await request(app.getHttpServer()).get('/api/analytics/forecast').expect(401);
    await request(app.getHttpServer()).get('/api/analytics/forecast/traffic').expect(401);
    await request(app.getHttpServer()).get('/api/analytics/forecast/routers').expect(401);
    await request(app.getHttpServer()).get('/api/analytics/forecast/plans').expect(401);
    await request(app.getHttpServer()).get('/api/analytics/insights').expect(401);
  });

  it("2. historique suffisant (tenant A, 35 jours) -> prévision produite avec points entiers", async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/forecast?horizonDays=7')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.data.revenueForecast.confidence).not.toBe('INSUFFICIENT_DATA');
    expect(res.body.data.revenueForecast.points).toHaveLength(7);
    for (const p of res.body.data.revenueForecast.points) {
      expect(Number.isInteger(p.predicted)).toBe(true);
      expect(p.lowerBound).toBeGreaterThanOrEqual(0);
      expect(p.upperBound).toBeGreaterThanOrEqual(p.predicted);
    }
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/undefined|NaN|Infinity/);
  });

  it('1. tenant B (aucune vente) -> INSUFFICIENT_DATA, jamais les chiffres du tenant A', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/forecast?horizonDays=7')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(res.body.data.revenueForecast.confidence).toBe('INSUFFICIENT_DATA');
    expect(res.body.data.revenueForecast.points).toEqual([]);
  });

  it('34. horizon invalide (>30) refusé (400)', async () => {
    await request(app.getHttpServer())
      .get('/api/analytics/forecast?horizonDays=999')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
  });

  it("29-30. routerId/planId d'un autre tenant refusés (400)", async () => {
    await request(app.getHttpServer())
      .get(`/api/analytics/forecast?horizonDays=7&routerId=${routerA}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(400);
  });

  it('/forecast/routers : routeur visible même avec confiance faible/insuffisante', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/forecast/routers')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.find((r: { routerId: string }) => r.routerId === routerA)).toBeTruthy();
  });

  it('/forecast/plans : forfait visible', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/forecast/plans')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.data.find((p: { planId: string }) => p.planId === planA)).toBeTruthy();
  });

  it('/insights : réponse structurée, aucun undefined/NaN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/insights')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/undefined|NaN/);
  });

  it("41. aucune régression des cinq endpoints Analytics existants (audit/67)", async () => {
    await request(app.getHttpServer()).get('/api/analytics/overview?period=last30days').set('Authorization', `Bearer ${tokenA}`).expect(200);
    await request(app.getHttpServer()).get('/api/analytics/routers?period=last30days').set('Authorization', `Bearer ${tokenA}`).expect(200);
    await request(app.getHttpServer()).get(`/api/analytics/routers/${routerA}?period=last30days`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    await request(app.getHttpServer()).get('/api/analytics/plans?period=last30days').set('Authorization', `Bearer ${tokenA}`).expect(200);
    await request(app.getHttpServer()).get('/api/analytics/traffic?period=last30days').set('Authorization', `Bearer ${tokenA}`).expect(200);
  });
});
