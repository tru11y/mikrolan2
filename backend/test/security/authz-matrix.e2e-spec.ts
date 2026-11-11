import request from 'supertest';
import * as argon2 from 'argon2';
import { UserRole, UserStatus } from '@prisma/client';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

const ARGON = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 } as const;

/**
 * Matrice d'autorisation (Phase 6) : pour chaque route de lecture, qui passe la garde ?
 * Le code 403 = refusé par RolesGuard ; tout autre code (200, 404, 502…) = la garde a laissé passer.
 */
describe('Matrice d’autorisation par rôle (e2e)', () => {
  let app: NestFastifyApplication;
  const tokens: Record<string, string> = {};
  let routerA: string;
  let batchA: string;

  beforeAll(async () => {
    app = await createTestApp();
    const prisma = app.get(PrismaService);
    const stamp = Date.now();
    const ownerA = await signupUser(app, { tenantName: 'Authz A', email: `az-a-${stamp}@e2e.local` });
    const ownerB = await signupUser(app, { tenantName: 'Authz B', email: `az-b-${stamp}@e2e.local` });
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: ownerA.email } });
    tokens.owner = (await loginUser(app, ownerA.email, ownerA.password)).accessToken;
    tokens.otherTenant = (await loginUser(app, ownerB.email, ownerB.password)).accessToken;
    const mk = async (role: UserRole, tag: string) => {
      const email = `${tag}-${stamp}@e2e.local`;
      await prisma.user.create({
        data: { tenantId: userA.tenantId, email, passwordHash: await argon2.hash('Passw0rd!123', ARGON), role, status: UserStatus.ACTIVE },
      });
      return (await loginUser(app, email, 'Passw0rd!123')).accessToken;
    };
    tokens.member = await mk(UserRole.MEMBER, 'mem');
    tokens.verifier = await mk(UserRole.TICKET_VERIFIER, 'ver');
    const router = await prisma.router.create({ data: { tenantId: userA.tenantId, identity: `az-${stamp}` } });
    routerA = router.id;
    const plan = await prisma.plan.create({
      data: { tenantId: userA.tenantId, routerId: routerA, name: '1H', slug: '1h', durationMinutes: 60, sharedUsers: 1, priceXof: 500 },
    });
    const verifierUser = await prisma.user.findFirstOrThrow({ where: { email: { startsWith: `ver-${stamp}` } } });
    await prisma.ticketVerifierAssignment.create({
      data: { userId: verifierUser.id, tenantId: userA.tenantId, routerId: routerA, assignedById: userA.id },
    });
    await prisma.voucher.create({ data: { tenantId: userA.tenantId, planId: plan.id, routerId: routerA, code: 'MINE1', password: 'x', mikrotikId: '*1' } });
    const router2 = await prisma.router.create({ data: { tenantId: userA.tenantId, identity: `az2-${stamp}` } });
    const plan2 = await prisma.plan.create({
      data: { tenantId: userA.tenantId, routerId: router2.id, name: '1H', slug: '1h', durationMinutes: 60, sharedUsers: 1, priceXof: 500 },
    });
    await prisma.voucher.create({ data: { tenantId: userA.tenantId, planId: plan2.id, routerId: router2.id, code: 'OTHER1', password: 'x', mikrotikId: '*2' } });
    const batch = await prisma.voucherBatch.create({ data: { tenantId: userA.tenantId, planId: plan.id, routerId: routerA, quantity: 1 } });
    batchA = batch.id;
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  const paths = () => [
    '/api/routers',
    `/api/routers/${routerA}`,
    `/api/routers/${routerA}/plans`,
    `/api/routers/${routerA}/sessions`,
    `/api/routers/${routerA}/hotspot/user-profiles`,
    `/api/routers/${routerA}/hotspot/servers`,
    `/api/routers/${routerA}/hotspot/ip-bindings`,
    `/api/routers/${routerA}/hotspot/internet-sharing`,
    `/api/routers/${routerA}/hotspot/settings`,
    `/api/routers/${routerA}/remote`,
    `/api/routers/${routerA}/remote/system-resource`,
    `/api/routers/${routerA}/vouchers/batches/${batchA}/vault`,
    '/api/subscriptions/me',
    '/api/subscriptions/invoices',
    '/api/subscriptions/payment-info',
    '/api/analytics/overview',
    '/api/accounting/revenue/by-period',
    '/api/support/tickets',
  ];

  const status = async (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(path);
    const res = await (token ? req.set('Authorization', `Bearer ${token}`) : req);
    return res.status;
  };

  it('anonyme : 401 partout', async () => {
    for (const p of paths()) expect([p, await status(p)]).toEqual([p, 401]);
  });

  it('TICKET_VERIFIER est bien refusé (403) sur les revenus et l’état système du routeur', async () => {
    for (const p of ['/api/analytics/overview', '/api/accounting/revenue/by-period', `/api/routers/${routerA}/remote/system-resource`]) {
      expect([p, await status(p, tokens.verifier)]).toEqual([p, 403]);
    }
  });

  it('un tenant étranger ne voit ni les routeurs, ni les forfaits, ni le coffre de l’autre tenant', async () => {
    const list = await request(app.getHttpServer()).get('/api/routers').set('Authorization', `Bearer ${tokens.otherTenant}`);
    expect(list.body.data).toEqual([]);
    for (const p of [`/api/routers/${routerA}`, `/api/routers/${routerA}/plans/00000000-0000-4000-8000-000000000000`]) {
      expect([p, await status(p, tokens.otherTenant)]).toEqual([p, 404]);
    }
  });

  it('IDOR /vouchers/lookup : un code d’un autre tenant n’est jamais trouvé, ni sur son routeur ni sur le nôtre', async () => {
    const prisma = app.get(PrismaService);
    const userB = await prisma.user.findFirstOrThrow({ where: { email: { startsWith: 'az-b-' } } });
    const routerB = await prisma.router.create({ data: { tenantId: userB.tenantId, identity: `azb-${Date.now()}` } });
    const planB = await prisma.plan.create({
      data: { tenantId: userB.tenantId, routerId: routerB.id, name: '1H', slug: '1h', durationMinutes: 60, sharedUsers: 1, priceXof: 500 },
    });
    await prisma.voucher.create({ data: { tenantId: userB.tenantId, planId: planB.id, routerId: routerB.id, code: 'IDORB1', password: 'x', mikrotikId: '*1' } });
    const ask = (router: string, token: string) =>
      request(app.getHttpServer()).get(`/api/routers/${router}/vouchers/lookup?code=IDORB1`).set('Authorization', `Bearer ${token}`);
    expect((await ask(routerB.id, tokens.otherTenant)).status).toBe(200); // contrôle : le propriétaire le trouve
    expect((await ask(routerB.id, tokens.owner)).status).toBe(404);
    expect((await ask(routerA, tokens.owner)).status).toBe(404);
  });

  const EX_GAP = [
    '/api/routers', // liste
    '/api/subscriptions/me', '/api/subscriptions/invoices', '/api/subscriptions/payment-info',
    '/api/support/tickets',
  ];

  it('ÉCART CORRIGÉ : le vendeur reçoit 403 sur routeurs, forfaits, sessions, hotspot, remote, coffre PDF, facturation, support, analytics', async () => {
    const leaks: string[] = [];
    for (const p of [...paths(), ...EX_GAP]) {
      const code = await status(p, tokens.verifier);
      if (code !== 403) leaks.push(`${p} → ${code}`);
    }
    expect(leaks).toEqual([]);
  });

  it('le vendeur n’écrit rien non plus : POST/PATCH/DELETE hors allowlist → 403', async () => {
    const calls: [string, string][] = [
      ['post', `/api/routers/${routerA}/vouchers/generate`],
      ['post', `/api/routers/${routerA}/plans`],
      ['patch', `/api/auth/me`],
      ['delete', `/api/auth/me`],
      ['post', `/api/auth/mfa/setup`],
      ['post', '/api/support/tickets'],
      ['post', '/api/subscriptions/request-upgrade'],
    ];
    for (const [m, p] of calls) {
      const res = await (request(app.getHttpServer()) as never as Record<string, (u: string) => request.Test>)[m](p).set('Authorization', `Bearer ${tokens.verifier}`).send({});
      expect([`${m} ${p}`, res.status]).toEqual([`${m} ${p}`, 403]);
    }
  });

  it('allowlist : le vendeur vérifie un ticket de SON routeur (200) et garde son compte (me, releases/latest)', async () => {
    const ok = await request(app.getHttpServer()).post('/api/ticket-verification/verify').set('Authorization', `Bearer ${tokens.verifier}`).send({ ticketCode: 'MINE1' });
    expect(ok.status).toBe(200);
    expect(await status('/api/auth/me', tokens.verifier)).toBe(200);
    expect(await status('/api/releases/latest', tokens.verifier)).not.toBe(403);
  });

  it('croisé : un ticket d’un routeur NON attribué n’est pas révélé au vendeur', async () => {
    const res = await request(app.getHttpServer()).post('/api/ticket-verification/verify').set('Authorization', `Bearer ${tokens.verifier}`).send({ ticketCode: 'OTHER1' });
    expect(res.body.data).toMatchObject({ status: 'NOT_FOUND', message: 'Ticket inexistant' });
  });

  it('pas de régression : OWNER et MEMBER gardent leurs accès de lecture', async () => {
    for (const p of ['/api/routers', `/api/routers/${routerA}/plans`, '/api/subscriptions/me']) {
      expect([p, await status(p, tokens.owner)]).toEqual([p, 200]);
      expect([p, await status(p, tokens.member)]).toEqual([p, 200]);
    }
  });
});
