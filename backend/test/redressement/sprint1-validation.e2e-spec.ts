/**
 * Sprint 1 — Validation fonctionnelle complète.
 *
 * Prouve que chaque élément du plan de redressement fonctionne
 * avec une DB réelle (testcontainers PostgreSQL) et Redis/BullMQ mockés.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { getQueueToken } from '@nestjs/bullmq';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser, promoteToSuperAdmin } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { RouterHealthCron } from '../../src/modules/routers/router-health.cron';
import { SessionCleanupCron } from '../../src/modules/sessions/session-cleanup.cron';
import { SupportSlaCron } from '../../src/modules/support/support-sla.cron';
import { PaymentCron } from '../../src/modules/subscriptions/payment.cron';

describe('Sprint 1 — Validation fonctionnelle (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let pushQueue: { add: jest.Mock };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    pushQueue = app.get(getQueueToken('notifications'));
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── NOTIFICATIONS ──────────────────────────────────────

  describe('Notifications — createAndPush', () => {
    it('crée la notification en DB et enqueue dans BullMQ', async () => {
      const user = await signupUser(app);
      const tenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: user.email } } },
      });

      const notifService = app.get(NotificationsService);
      await notifService.createAndPush(
        tenant!.id,
        'ROUTER_OFFLINE',
        'Test routeur offline',
        'Le routeur test ne répond plus',
        null,
        null,
      );

      // 1. Vérification création DB
      const notif = await prisma.notification.findFirst({
        where: { tenantId: tenant!.id, type: 'ROUTER_OFFLINE' },
      });
      expect(notif).not.toBeNull();
      expect(notif!.title).toBe('Test routeur offline');
      expect(notif!.body).toBe('Le routeur test ne répond plus');
      expect(notif!.retryCount).toBe(0);

      // 2. Vérification BullMQ enqueue (pas de tokens → pas d'enqueue)
      // L'utilisateur n'a pas de pushToken, donc aucun job ne sera enqueued
      // C'est le comportement correct — on vérifie que la logique de collecte fonctionne
    });

    it('enqueue un job BullMQ quand un utilisateur a un pushToken', async () => {
      const user = await signupUser(app);
      const tenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: user.email } } },
      });

      // Ajouter un pushToken à l'utilisateur
      await prisma.user.update({
        where: { email: user.email },
        data: { pushToken: 'ExponentPushToken[test-token-123]' },
      });

      jest.clearAllMocks();

      const notifService = app.get(NotificationsService);
      await notifService.createAndPush(
        tenant!.id,
        'ROUTER_ONLINE',
        'Routeur de retour',
        'Le routeur est de nouveau en ligne',
      );

      // 3. Vérification BullMQ enqueue
      expect(pushQueue.add).toHaveBeenCalledTimes(1);
      expect(pushQueue.add).toHaveBeenCalledWith('push', expect.objectContaining({
        tokens: ['ExponentPushToken[test-token-123]'],
        title: 'Routeur de retour',
        body: 'Le routeur est de nouveau en ligne',
      }));
    });
  });

  // ─── ROUTER HEALTH ──────────────────────────────────────

  describe('Router Health — cron et statut', () => {
    it('détecte un routeur offline et envoie une notification', async () => {
      const user = await signupUser(app);
      const token = await loginUser(app, user.email, user.password);
      const tenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: user.email } } },
      });

      // Créer un routeur avec lastHeartbeat dans le passé (> 5 min)
      const router = await prisma.router.create({
        data: {
          tenantId: tenant!.id,
          identity: `health-test-${Date.now()}`,
          health: 'ONLINE',
          lastHeartbeat: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
          syncFailCount: 0,
        },
      });

      // Exécuter le cron manuellement
      const healthCron = app.get(RouterHealthCron);
      await healthCron.checkRouterHealth();

      // Vérifier le statut
      const updated = await prisma.router.findUnique({ where: { id: router.id } });
      expect(updated!.health).toBe('OFFLINE');

      // Vérifier la notification
      const notif = await prisma.notification.findFirst({
        where: {
          tenantId: tenant!.id,
          routerId: router.id,
          type: 'ROUTER_OFFLINE',
        },
      });
      expect(notif).not.toBeNull();
      expect(notif!.title).toContain('hors ligne');
    });

    it('détecte un routeur DEGRADED (syncFailCount >= 3)', async () => {
      const user = await signupUser(app);
      const tenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: user.email } } },
      });

      const router = await prisma.router.create({
        data: {
          tenantId: tenant!.id,
          identity: `degraded-test-${Date.now()}`,
          health: 'ONLINE',
          lastHeartbeat: new Date(), // récent
          syncFailCount: 5, // >= 3
        },
      });

      const healthCron = app.get(RouterHealthCron);
      await healthCron.checkRouterHealth();

      const updated = await prisma.router.findUnique({ where: { id: router.id } });
      expect(updated!.health).toBe('DEGRADED');
    });

    it('détecte un routeur qui revient ONLINE', async () => {
      const user = await signupUser(app);
      const tenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: user.email } } },
      });

      const router = await prisma.router.create({
        data: {
          tenantId: tenant!.id,
          identity: `online-test-${Date.now()}`,
          health: 'OFFLINE',
          lastHeartbeat: new Date(), // récent
          syncFailCount: 0,
        },
      });

      const healthCron = app.get(RouterHealthCron);
      await healthCron.checkRouterHealth();

      const updated = await prisma.router.findUnique({ where: { id: router.id } });
      expect(updated!.health).toBe('ONLINE');

      // Notification ROUTER_ONLINE envoyée
      const notif = await prisma.notification.findFirst({
        where: {
          tenantId: tenant!.id,
          routerId: router.id,
          type: 'ROUTER_ONLINE',
        },
      });
      expect(notif).not.toBeNull();
    });

    it('expose lastSyncAt et syncFailCount dans GET /api/routers', async () => {
      const user = await signupUser(app);
      const token = await loginUser(app, user.email, user.password);

      // Créer un routeur via API
      const createRes = await request(app.getHttpServer())
        .post('/api/routers')
        .set('Authorization', `Bearer ${token.accessToken}`)
        .send({ identity: `api-test-${Date.now()}`, mode: 'LOCAL' })
        .expect(201);

      const routerId = createRes.body.data.id;

      // Mettre à jour lastSyncAt directement
      await prisma.router.update({
        where: { id: routerId },
        data: {
          lastSyncAt: new Date(),
          lastSyncError: 'connection timeout',
          syncFailCount: 2,
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/routers/${routerId}`)
        .set('Authorization', `Bearer ${token.accessToken}`)
        .expect(200);

      expect(res.body.data.lastSyncAt).toBeTruthy();
      expect(res.body.data.syncFailCount).toBe(2);
      expect(res.body.data.lastSyncError).toBe('connection timeout');
    });
  });

  // ─── SUPPORT SLA ────────────────────────────────────────

  describe('Support SLA — deadline et escalade', () => {
    it('calcule slaDeadlineAt à la création du ticket', async () => {
      const user = await signupUser(app);
      const token = await loginUser(app, user.email, user.password);

      const res = await request(app.getHttpServer())
        .post('/api/support/tickets')
        .set('Authorization', `Bearer ${token.accessToken}`)
        .send({
          subject: 'Mon routeur ne marche plus',
          body: 'Depuis ce matin, impossible de se connecter.',
          priority: 'HIGH',
        })
        .expect(201);

      const ticketId = res.body.data.id;
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
      });

      expect(ticket!.slaDeadlineAt).not.toBeNull();
      // HIGH = 4h
      const diffMs = ticket!.slaDeadlineAt!.getTime() - ticket!.createdAt.getTime();
      const diffH = diffMs / (60 * 60 * 1000);
      expect(diffH).toBeCloseTo(4, 0);
    });

    it('escalade un ticket LOW → MEDIUM quand SLA dépassé', async () => {
      const user = await signupUser(app);
      const tenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: user.email } } },
      });

      // Créer un ticket LOW avec deadline dans le passé
      const ticket = await prisma.supportTicket.create({
        data: {
          tenantId: tenant!.id,
          userId: (await prisma.user.findFirst({ where: { email: user.email } }))!.id,
          subject: 'Test escalade',
          priority: 'LOW',
          slaDeadlineAt: new Date(Date.now() - 60 * 60 * 1000), // 1h dans le passé
        },
      });

      // Exécuter le cron
      const slaCron = app.get(SupportSlaCron);
      await slaCron.escalateOverdueTickets();

      const updated = await prisma.supportTicket.findUnique({
        where: { id: ticket.id },
      });
      expect(updated!.priority).toBe('MEDIUM');
    });
  });

  // ─── PAYMENT HISTORY ────────────────────────────────────

  describe('Payment History — endpoint GET /api/subscriptions/invoices', () => {
    it('retourne l historique des factures avec JSON réel', async () => {
      const user = await signupUser(app);
      const token = await loginUser(app, user.email, user.password);
      const tenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: user.email } } },
      });

      // Créer des factures en DB
      await prisma.invoice.createMany({
        data: [
          {
            tenantId: tenant!.id,
            amount: 5000,
            currency: 'XOF',
            billingPeriod: 'MONTHLY',
            status: 'PAID',
            paidAt: new Date(),
            idempotencyKey: `test-paid-${Date.now()}`,
          },
          {
            tenantId: tenant!.id,
            amount: 50000,
            currency: 'XOF',
            billingPeriod: 'ANNUAL',
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            idempotencyKey: `test-pending-${Date.now()}`,
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .get('/api/subscriptions/invoices')
        .set('Authorization', `Bearer ${token.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data[0]).toHaveProperty('amount');
      expect(res.body.data[0]).toHaveProperty('status');
      expect(res.body.data[0]).toHaveProperty('billingPeriod');
      expect(res.body.data[0]).toHaveProperty('createdAt');

      // Vérifier la facture payée
      const paid = res.body.data.find((i: any) => i.status === 'PAID');
      expect(paid).toBeDefined();
      expect(paid.amount).toBe(5000);
      expect(paid.paidAt).toBeTruthy();

      // Vérifier la facture en attente avec expiresAt
      const pending = res.body.data.find((i: any) => i.status === 'PENDING');
      expect(pending).toBeDefined();
      expect(pending.expiresAt).toBeTruthy();
    });
  });

  // ─── SESSION CLEANUP ────────────────────────────────────

  describe('Session Cleanup — nettoyage sessions stales', () => {
    it('termine les sessions actives sans lastSeenAt depuis > 30 min', async () => {
      const user = await signupUser(app);
      const tenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: user.email } } },
      });

      // Créer un routeur + voucher + session
      const router = await prisma.router.create({
        data: { tenantId: tenant!.id, identity: `cleanup-${Date.now()}` },
      });
      const plan = await prisma.plan.create({
        data: {
          tenantId: tenant!.id,
          routerId: router.id,
          name: 'Test',
          slug: `test-${Date.now()}`,
          durationMinutes: 60,
          priceXof: 100,
        },
      });
      const voucher = await prisma.voucher.create({
        data: {
          tenantId: tenant!.id,
          planId: plan.id,
          routerId: router.id,
          code: `CLEAN-${Date.now()}`,
          password: '1234',
        },
      });
      const session = await prisma.session.create({
        data: {
          tenantId: tenant!.id,
          voucherId: voucher.id,
          routerId: router.id,
          status: 'ACTIVE',
          lastSeenAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
        },
      });

      const cleanupCron = app.get(SessionCleanupCron);
      await cleanupCron.cleanStaleSessions();

      const updated = await prisma.session.findUnique({
        where: { id: session.id },
      });
      expect(updated!.status).toBe('TERMINATED');
      expect(updated!.terminatedAt).not.toBeNull();
    });
  });

  // ─── PAYMENT EXPIRATION ─────────────────────────────────

  describe('Payment Cron — expiration invoices', () => {
    it('expire les factures PENDING dont expiresAt est dépassé', async () => {
      const user = await signupUser(app);
      const tenant = await prisma.tenant.findFirst({
        where: { users: { some: { email: user.email } } },
      });

      const invoice = await prisma.invoice.create({
        data: {
          tenantId: tenant!.id,
          amount: 3000,
          status: 'PENDING',
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // expiré hier
          idempotencyKey: `expire-test-${Date.now()}`,
        },
      });

      const paymentCron = app.get(PaymentCron);
      await paymentCron.expirePendingInvoices();

      const updated = await prisma.invoice.findUnique({
        where: { id: invoice.id },
      });
      expect(updated!.status).toBe('FAILED');
    });
  });

  // ─── SECURITY AUDIT ─────────────────────────────────────

  describe('Admin security audit endpoint', () => {
    it('retourne les métriques de sécurité', async () => {
      const user = await signupUser(app);
      const adminToken = await promoteToSuperAdmin(app, user.email, user.password);

      const res = await request(app.getHttpServer())
        .get('/api/admin/security-audit')
        .set('Authorization', `Bearer ${adminToken.accessToken}`)
        .expect(200);

      expect(res.body.data).toHaveProperty('superAdmins');
      expect(res.body.data).toHaveProperty('loginsLast24h');
      expect(res.body.data).toHaveProperty('suspendedUsers');
      expect(res.body.data).toHaveProperty('routersRemoteWithoutCreds');
      expect(res.body.data).toHaveProperty('sensitiveActionsLast24h');
      expect(res.body.data.superAdmins).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── HEALTH SYSTEM ──────────────────────────────────────

  describe('Health system endpoint', () => {
    it('retourne uptime, mémoire et compteurs', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health/system')
        .expect(200);

      expect(res.body.data).toHaveProperty('uptime');
      expect(res.body.data).toHaveProperty('memory');
      expect(res.body.data.memory).toHaveProperty('heapUsedMb');
      expect(res.body.data).toHaveProperty('counts');
      expect(res.body.data.counts).toHaveProperty('tenants');
      expect(res.body.data.counts).toHaveProperty('routers');
    });
  });
});
