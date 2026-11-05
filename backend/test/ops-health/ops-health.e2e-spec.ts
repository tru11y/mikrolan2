/**
 * Validation réelle (PostgreSQL isolé) du module ops-health : SQL de comptage,
 * niveaux, absence de faux positif, throttling email 6 h, ALERT_EMAIL absent,
 * émission Sentry. Données 100 % synthétiques.
 */
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ManagementMode, VoucherStatus } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { createTestApp } from '../helpers/app.helper';
import request from 'supertest';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OpsHealthService } from '../../src/modules/ops-health/ops-health.service';
import { OpsHealthAlertCron } from '../../src/modules/ops-health/ops-health.alert.cron';

jest.mock('@sentry/node', () => ({
  ...jest.requireActual('@sentry/node'),
  captureMessage: jest.fn(),
}));
const captureMessage = Sentry.captureMessage as jest.Mock;

const min = (n: number) => new Date(Date.now() - n * 60_000);

describe('ops-health — intégration réelle', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let health: OpsHealthService;
  let tenantId: string;
  let admin: { email: string; password: string };
  let routerId: string;
  let planId: string;
  let seq = 0;

  const sendAlert = jest.fn().mockResolvedValue(undefined);
  const makeCron = (email: string) =>
    new OpsHealthAlertCron(
      health,
      { sendAlert } as never,
      { get: () => email } as never,
    );

  // La base e2e est partagée entre suites : les compteurs sont globaux, on repart de zéro.
  const clearVouchers = async () => {
    await prisma.session.deleteMany({});
    await prisma.voucher.deleteMany({});
  };

  const voucher = (o: {
    status: VoucherStatus;
    usedAt?: Date | null;
    expiresAt?: Date | null;
  }) =>
    prisma.voucher.create({
      data: {
        tenantId,
        routerId,
        planId,
        code: `v${(seq += 1)}`,
        password: 'x',
        status: o.status,
        usedAt: o.usedAt ?? null,
        expiresAt: o.expiresAt ?? null,
      },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    health = app.get(OpsHealthService);
    const u = await signupUser(app, { tenantName: 'Ops T' });
    admin = u;
    tenantId = (await prisma.user.findUniqueOrThrow({ where: { email: u.email } })).tenantId;
    routerId = (
      await prisma.router.create({
        data: { tenantId, identity: 'r-ops', mode: ManagementMode.LOCAL },
      })
    ).id;
    planId = (
      await prisma.plan.create({
        data: { tenantId, routerId, name: '1h', slug: '1h', durationMinutes: 60, priceXof: 500 },
      })
    ).id;
  });

  beforeEach(async () => {
    await clearVouchers();
    sendAlert.mockClear();
    captureMessage.mockClear();
    jest.restoreAllMocks();
  });

  afterAll(async () => app.close());

  it('GREEN sans faux positif : base vide, ticket valide, GENERATED, USED', async () => {
    expect((await health.getExpiryHealth()).level).toBe('GREEN');
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(30) }); // encore valide
    await voucher({ status: VoucherStatus.GENERATED });
    await voucher({ status: VoucherStatus.USED, usedAt: min(500) });
    await voucher({ status: VoucherStatus.REVOKED, usedAt: min(500) });
    const h = await health.getExpiryHealth();
    expect(h).toMatchObject({ level: 'GREEN', pendingOnline: 0, oldestPendingMinutes: null });
    const spy = captureMessage;
    await makeCron('a@b.c').checkExpiry();
    expect(spy).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('valeurs exactes + ORANGE sous 30 min sans alerte', async () => {
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(70) }); // expiré il y a 10 min
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(30) }); // valide
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(180), expiresAt: min(120) }); // appliqué <24h
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(1900), expiresAt: min(1800) }); // appliqué >24h
    const h = await health.getExpiryHealth();
    expect(h.pendingOnline).toBe(1);
    expect(h.oldestPendingMinutes).toBeGreaterThanOrEqual(9);
    expect(h.oldestPendingMinutes).toBeLessThanOrEqual(11);
    expect(h.appliedLast24h).toBe(1);
    expect(h.lastExpiredAt?.getTime()).toBeGreaterThan(min(121).getTime());
    expect(h.lastExpiredAt?.getTime()).toBeLessThan(min(119).getTime());
    expect(h.level).toBe('ORANGE');
    const spy = captureMessage;
    await makeCron('a@b.c').checkExpiry();
    expect(spy).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('RED à >= 30 min : Sentry fatal + email, throttling 6 h, reset quand résolu', async () => {
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(100) }); // expiré il y a 40 min
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(70) });
    const h = await health.getExpiryHealth();
    expect(h.pendingOnline).toBe(2);
    expect(h.oldestPendingMinutes).toBeGreaterThanOrEqual(39);
    expect(h.oldestPendingMinutes).toBeLessThanOrEqual(41);
    expect(h.level).toBe('RED');

    const spy = captureMessage;
    const cron = makeCron('solqueflo.balley@epitech.eu');
    await cron.checkExpiry();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('EXPIRY_PENDING_STUCK'),
      expect.objectContaining({
        level: 'fatal',
        tags: expect.objectContaining({ errorCode: 'EXPIRY_PENDING_STUCK' }),
        extra: expect.objectContaining({ pendingOnline: 2 }),
      }),
    );
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith(
      'solqueflo.balley@epitech.eu',
      expect.any(String),
      expect.stringContaining('2 tickets'),
    );

    await cron.checkExpiry(); // immédiatement : throttlé
    expect(sendAlert).toHaveBeenCalledTimes(1);

    const real = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(real + 5 * 3_600_000);
    await cron.checkExpiry(); // +5 h : toujours throttlé
    expect(sendAlert).toHaveBeenCalledTimes(1);
    nowSpy.mockReturnValue(real + 6 * 3_600_000 + 1000);
    await cron.checkExpiry(); // +6 h : renvoie
    expect(sendAlert).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();

    await clearVouchers(); // résolu → reset du throttle
    await cron.checkExpiry();
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(100) });
    await cron.checkExpiry();
    expect(sendAlert).toHaveBeenCalledTimes(3);
  });

  it('routeur REMOTE hors ligne : compté en pendingOffline, jamais rouge', async () => {
    const off = await prisma.router.create({
      data: { tenantId, identity: 'r-off', mode: ManagementMode.REMOTE, health: 'OFFLINE', credEncrypted: 'x' },
    });
    const v = await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(30000) });
    await prisma.voucher.update({ where: { id: v.id }, data: { routerId: off.id } });
    const h = await health.getExpiryHealth();
    expect(h).toMatchObject({ level: 'GREEN', pendingOnline: 0, pendingOffline: 1, oldestPendingMinutes: null });
    await makeCron('a@b.c').checkExpiry();
    expect(captureMessage).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
    await clearVouchers();
    await prisma.router.delete({ where: { id: off.id } });
  });

  it('ALERT_EMAIL vide : aucun email, Sentry émis quand même', async () => {
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(100) });
    const spy = captureMessage;
    await makeCron('').checkExpiry();
    expect(sendAlert).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('backlog : 3000 tickets expirés comptés exactement, requête rapide', async () => {
    await prisma.voucher.createMany({
      data: Array.from({ length: 3000 }, (_, k) => ({
        tenantId, routerId, planId, code: `bk${k}`, password: 'x',
        status: VoucherStatus.ACTIVE, usedAt: min(90 + (k % 600)),
      })),
    });
    const t0 = Date.now();
    const h = await health.getExpiryHealth();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(h.pendingOnline).toBe(3000);
    expect(h.level).toBe('RED');
    expect(h.oldestPendingMinutes).toBeGreaterThanOrEqual(628);
  });

  it('HTTP GET /api/admin/system-health : 401 anonyme, 403 non-admin, 200 SUPER_ADMIN', async () => {
    await voucher({ status: VoucherStatus.ACTIVE, usedAt: min(100) });
    const http = app.getHttpServer();
    await request(http).get('/api/admin/system-health').expect(401);
    const other = await signupUser(app, { tenantName: 'Other' });
    await request(http)
      .get('/api/admin/system-health')
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(403);
    const { accessToken } = await promoteToSuperAdmin(app, admin.email, admin.password);
    const res = await request(http)
      .get('/api/admin/system-health')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const body = res.body.data ?? res.body;
    expect(body.expiry).toMatchObject({ level: 'RED', pendingOnline: 1, pendingOffline: 0 });
  });
});
