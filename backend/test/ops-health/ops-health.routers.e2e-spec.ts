/**
 * Validation réelle (PostgreSQL isolé) de la section `routers` de /admin/system-health :
 * LOCAL exclus des niveaux, deletedAt exclu, multi-tenant, droits HTTP, absence de secrets,
 * volume (500 routeurs) < 1 s. Données 100 % synthétiques.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ManagementMode, RouterHealth } from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OpsHealthService } from '../../src/modules/ops-health/ops-health.service';

const min = (n: number) => new Date(Date.now() - n * 60_000);
const SECRET = 'SECRET-CRED-DO-NOT-LEAK';
const LAN = '10.9.8.7:8728';

describe('ops-health routeurs — intégration réelle', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let health: OpsHealthService;
  let admin: { email: string; password: string };
  let tenantA: string;
  let tenantB: string;
  let seq = 0;

  const mk = (
    tenantId: string,
    o: {
      mode?: ManagementMode;
      health?: RouterHealth;
      hb?: Date | null;
      cred?: boolean;
      deleted?: boolean;
      createdAt?: Date;
      alias?: string;
    } = {},
  ) =>
    prisma.router.create({
      data: {
        tenantId,
        identity: `rt-${(seq += 1)}`,
        alias: o.alias ?? null,
        mode: o.mode ?? ManagementMode.REMOTE,
        health: o.health ?? RouterHealth.ONLINE,
        lastHeartbeat: o.hb === undefined ? min(1) : o.hb,
        credEncrypted: o.cred === false ? null : SECRET,
        localAddress: LAN,
        deletedAt: o.deleted ? new Date() : null,
        ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      },
    });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    health = app.get(OpsHealthService);
    admin = await signupUser(app, { tenantName: 'Routers A' });
    tenantA = (await prisma.user.findUniqueOrThrow({ where: { email: admin.email } })).tenantId;
    const b = await signupUser(app, { tenantName: 'Routers B' });
    tenantB = (await prisma.user.findUniqueOrThrow({ where: { email: b.email } })).tenantId;
  });

  // DB partagée entre suites (--runInBand) : on écarte les routeurs des autres suites.
  beforeEach(async () => {
    await prisma.router.updateMany({ where: { deletedAt: null }, data: { deletedAt: new Date() } });
  });

  afterAll(async () => app.close());

  it('aucun routeur → GREEN', async () => {
    expect(await health.getRoutersHealth()).toMatchObject({ level: 'GREEN', total: 0, remote: 0, local: 0, items: [] });
  });

  it('tous ONLINE → GREEN', async () => {
    await mk(tenantA);
    await mk(tenantB);
    expect(await health.getRoutersHealth()).toMatchObject({ level: 'GREEN', total: 2, remote: 2, online: 2 });
  });

  it('LOCAL OFFLINE jamais vu : compté local, aucun effet sur le niveau', async () => {
    await mk(tenantA, { mode: ManagementMode.LOCAL, health: RouterHealth.OFFLINE, hb: null, cred: false });
    await mk(tenantA);
    const r = await health.getRoutersHealth();
    expect(r).toMatchObject({ level: 'GREEN', total: 2, local: 1, remote: 1, offline: 0, neverSeen: 0, remoteWithoutCredentials: 0 });
    expect(r.items).toHaveLength(1);
  });

  it('OFFLINE récent → ORANGE ; OFFLINE ≥ 24 h → RED', async () => {
    await mk(tenantA, { health: RouterHealth.OFFLINE, hb: min(120) });
    expect((await health.getRoutersHealth()).level).toBe('ORANGE');
    await mk(tenantB, { health: RouterHealth.OFFLINE, hb: min(20_456) });
    const r = await health.getRoutersHealth();
    expect(r).toMatchObject({ level: 'RED', offline: 2, offlineOver24h: 1 });
    expect(r.oldestOfflineMinutes).toBeGreaterThanOrEqual(20_455);
  });

  it('DEGRADED, sans identifiants, jamais vu (grâce 24 h)', async () => {
    await mk(tenantA, { health: RouterHealth.DEGRADED });
    expect((await health.getRoutersHealth()).level).toBe('ORANGE');
    await prisma.router.updateMany({ where: { deletedAt: null }, data: { deletedAt: new Date() } });
    await mk(tenantA, { cred: false });
    expect(await health.getRoutersHealth()).toMatchObject({ level: 'ORANGE', remoteWithoutCredentials: 1 });
    await prisma.router.updateMany({ where: { deletedAt: null }, data: { deletedAt: new Date() } });
    await mk(tenantA, { health: RouterHealth.OFFLINE, hb: null, createdAt: min(60) });
    expect(await health.getRoutersHealth()).toMatchObject({ level: 'GREEN', neverSeen: 1 });
    await mk(tenantA, { health: RouterHealth.OFFLINE, hb: null, createdAt: min(2000) });
    expect(await health.getRoutersHealth()).toMatchObject({ level: 'ORANGE', neverSeen: 2, oldestOfflineMinutes: null });
  });

  it('routeur supprimé exclu', async () => {
    await mk(tenantA, { health: RouterHealth.OFFLINE, hb: min(50_000), deleted: true });
    await mk(tenantA);
    expect(await health.getRoutersHealth()).toMatchObject({ level: 'GREEN', total: 1, offline: 0 });
  });

  it('HTTP 401 / 403 / 200 et aucun champ sensible', async () => {
    await mk(tenantA, { alias: 'Mon routeur', health: RouterHealth.OFFLINE, hb: min(3000) });
    const http = app.getHttpServer();
    await request(http).get('/api/admin/system-health').expect(401);
    const other = await signupUser(app, { tenantName: 'Routers C' });
    await request(http).get('/api/admin/system-health').set('Authorization', `Bearer ${other.accessToken}`).expect(403);
    const { accessToken } = await promoteToSuperAdmin(app, admin.email, admin.password);
    const res = await request(http).get('/api/admin/system-health').set('Authorization', `Bearer ${accessToken}`).expect(200);
    const body = res.body.data ?? res.body;
    expect(body.expiry).toBeDefined();
    expect(body.routers).toMatchObject({ level: 'RED', total: 1, offlineOver24h: 1 });
    expect(body.routers.items[0]).toMatchObject({ name: 'Mon routeur', mode: 'REMOTE', credentialsConfigured: true });
    const raw = JSON.stringify(body);
    for (const forbidden of [SECRET, LAN, 'credEncrypted', 'localAddress', 'wgPublicKey', 'endpoint', 'password']) {
      expect(raw).not.toContain(forbidden);
    }
    expect(body.routers.items[0].id).toHaveLength(8);
  });

  it('500 routeurs : exact et < 1 s', async () => {
    await prisma.router.createMany({
      data: Array.from({ length: 500 }, (_, k) => ({
        tenantId: k % 2 ? tenantA : tenantB,
        identity: `bulk-${(seq += 1)}`,
        mode: k % 10 === 0 ? ManagementMode.LOCAL : ManagementMode.REMOTE,
        health: k % 7 === 0 ? RouterHealth.OFFLINE : RouterHealth.ONLINE,
        lastHeartbeat: min(k % 7 === 0 ? 2000 + k : 1),
        credEncrypted: SECRET,
      })),
    });
    const t0 = Date.now();
    const r = await health.getRoutersHealth();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.total).toBe(500);
    expect(r.local).toBe(50);
    expect(r.online + r.degraded + r.offline + r.unknown).toBe(r.remote);
    expect(r.items).toHaveLength(50);
    expect(r.level).toBe('RED');
  });
});
