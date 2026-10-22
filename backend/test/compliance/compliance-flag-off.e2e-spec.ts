/**
 * COMPLIANCE_ENFORCED=false (valeur par défaut en production tant que l'APK à jour n'est pas diffusée).
 * Les e2e du dossier tournent avec le drapeau ON (test/setup/env-setup.ts) ; ici on le bascule à OFF
 * à l'exécution en interceptant ConfigService, puis on le remet ON pour comparer sur la même base.
 */
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ManagementMode, RemotePeerStatus, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import { signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ComplianceCron } from '../../src/modules/compliance/compliance.cron';
import { LEGAL_VERSIONS } from '../../src/modules/legal/legal.versions';

const DAY_MS = 86_400_000;

describe('Compliance — drapeau COMPLIANCE_ENFORCED (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let cron: ComplianceCron;
  let enforced = false;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    cron = app.get(ComplianceCron);
    const config = app.get(ConfigService);
    const original = config.get.bind(config);
    jest.spyOn(config, 'get').mockImplementation(((key: string, ...rest: unknown[]) =>
      key === 'COMPLIANCE_ENFORCED' ? enforced : (original as (k: string, ...r: unknown[]) => unknown)(key, ...rest)) as never);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('drapeau OFF', () => {
    beforeAll(() => {
      enforced = false;
    });

    it('un ancien client sans versions légales peut créer un compte (aucun consentement enregistré)', async () => {
      const email = `oldapk-${Date.now()}@example.com`;

      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({ tenantName: 'Old APK', email, password: 'SecurePass123!' })
        .expect(201);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.termsVersion).toBeNull();
      expect(user.termsAcceptedAt).toBeNull();
    });

    it('un nouveau client qui envoie les versions les voit enregistrées', async () => {
      const u = await signupUser(app);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      expect(user.termsVersion).toBe(LEGAL_VERSIONS.terms);
    });

    it('une version périmée reste refusée (409)', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({
          tenantName: 'Stale',
          email: `stale-off-${Date.now()}@example.com`,
          password: 'SecurePass123!',
          termsVersion: '1999-01-01',
          privacyVersion: LEGAL_VERSIONS.privacy,
        })
        .expect(409);
    });

    it('le provisioning est autorisé sans autorisation d’accès distant', async () => {
      const u = await signupUser(app);
      const { tenantId } = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      await prisma.subscription.update({
        where: { tenantId },
        data: { plan: SubscriptionPlan.PRO, status: SubscriptionStatus.ACTIVE, currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS) },
      });
      const router = await prisma.router.create({ data: { tenantId, identity: `flag-off-${Date.now()}`, mode: ManagementMode.LOCAL } });

      await request(app.getHttpServer())
        .post(`/api/routers/${router.id}/remote/provision`)
        .set(bearer(u.accessToken))
        .send({})
        .expect(200);

      expect((await prisma.remotePeer.findUniqueOrThrow({ where: { routerId: router.id } })).status).toBe(RemotePeerStatus.ACTIVE);
    });
  });

  describe('purges planifiées', () => {
    it('OFF : une ligne d’audit de 400 jours n’est pas supprimée ; ON : elle l’est', async () => {
      const u = await signupUser(app);
      const { tenantId } = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      const old = await prisma.auditLog.create({
        data: { tenantId, action: 'CREATE', entityType: 'Old', createdAt: new Date(Date.now() - 400 * DAY_MS) },
      });

      enforced = false;
      await cron.dailyRetention();
      expect(await prisma.auditLog.findUnique({ where: { id: old.id } })).not.toBeNull();

      enforced = true;
      await cron.dailyRetention();
      expect(await prisma.auditLog.findUnique({ where: { id: old.id } })).toBeNull();
    });
  });

  describe('drapeau ON (comparaison sur la même base)', () => {
    beforeAll(() => {
      enforced = true;
    });

    it('un ancien client sans versions légales est refusé (400), aucun compte créé', async () => {
      const email = `oldapk-on-${Date.now()}@example.com`;

      await request(app.getHttpServer())
        .post('/api/auth/signup')
        .send({ tenantName: 'Old APK', email, password: 'SecurePass123!' })
        .expect(400);

      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    });

    it('le provisioning est refusé (403) sans autorisation d’accès distant', async () => {
      const u = await signupUser(app);
      const { tenantId } = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      await prisma.subscription.update({
        where: { tenantId },
        data: { plan: SubscriptionPlan.PRO, status: SubscriptionStatus.ACTIVE, currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS) },
      });
      const router = await prisma.router.create({ data: { tenantId, identity: `flag-on-${Date.now()}`, mode: ManagementMode.LOCAL } });

      const res = await request(app.getHttpServer())
        .post(`/api/routers/${router.id}/remote/provision`)
        .set(bearer(u.accessToken))
        .send({})
        .expect(403);

      expect(JSON.stringify(res.body)).toContain('REMOTE_ACCESS_AUTH_REQUIRED');
      expect(await prisma.remotePeer.count({ where: { routerId: router.id } })).toBe(0);
    });
  });
});
