import request from 'supertest';
import * as argon2 from 'argon2';
import { AuditAction, UserRole, UserStatus, VoucherStatus } from '@prisma/client';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';

const ARGON = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 } as const;

describe('Recherche et réimpression par ticket (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let routerA: string;
  let routerB: string;
  let ownerToken: string;
  let adminToken: string;
  let verifierToken: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const stamp = Date.now();

    const ownerA = await signupUser(app, { tenantName: 'Search A', email: `own-a-${stamp}@e2e.local` });
    const ownerB = await signupUser(app, { tenantName: 'Search B', email: `own-b-${stamp}@e2e.local` });
    const userA = await prisma.user.findUniqueOrThrow({ where: { email: ownerA.email } });
    const userB = await prisma.user.findUniqueOrThrow({ where: { email: ownerB.email } });

    const mkUser = async (role: UserRole, email: string, password: string) => {
      await prisma.user.create({
        data: { tenantId: userA.tenantId, email, passwordHash: await argon2.hash(password, ARGON), role, status: UserStatus.ACTIVE },
      });
      return (await loginUser(app, email, password)).accessToken;
    };
    ownerToken = (await loginUser(app, ownerA.email, ownerA.password)).accessToken;
    adminToken = await mkUser(UserRole.ADMIN, `adm-${stamp}@e2e.local`, 'AdminPass123!');
    verifierToken = await mkUser(UserRole.TICKET_VERIFIER, `ver-${stamp}@e2e.local`, 'VerifPass123!');

    const rA = await prisma.router.create({ data: { tenantId: userA.tenantId, identity: `sra-${stamp}` } });
    const rB = await prisma.router.create({ data: { tenantId: userB.tenantId, identity: `srb-${stamp}` } });
    routerA = rA.id;
    routerB = rB.id;
    const planFor = (tenantId: string, routerId: string) =>
      prisma.plan.create({ data: { tenantId, routerId, name: '1H', slug: '1h', durationMinutes: 60, sharedUsers: 1, priceXof: 500 } });
    const [planA, planB] = await Promise.all([planFor(userA.tenantId, rA.id), planFor(userB.tenantId, rB.id)]);

    let n = 0;
    const mk = async (key: string, tenantId: string, planId: string, routerId: string, code: string, status: VoucherStatus) => {
      const v = await prisma.voucher.create({
        data: {
          tenantId, planId, routerId, code, password: 'pw-DO-NOT-LEAK', status, mikrotikId: `mk-${stamp}-${++n}`,
          createdAt: new Date(stamp - n * 1000),
        },
      });
      ids[key] = v.id;
    };
    for (let i = 1; i <= 5; i++) await mk(`g${i}`, userA.tenantId, planA.id, routerA, `TSA0${i}`, VoucherStatus.GENERATED);
    await mk('used', userA.tenantId, planA.id, routerA, 'TSUSED', VoucherStatus.USED);
    await mk('rev', userA.tenantId, planA.id, routerA, 'TSREV', VoucherStatus.REVOKED);
    await mk('foreign', userB.tenantId, planB.id, routerB, 'TSB01', VoucherStatus.GENERATED);
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (token: string, router: string, qs = '') =>
    request(app.getHttpServer()).get(`/api/routers/${router}/vouchers/search${qs}`).set('Authorization', `Bearer ${token}`);
  const reprint = (token: string, router: string, voucherId: string) =>
    request(app.getHttpServer()).post(`/api/routers/${router}/vouchers/${voucherId}/reprint`).set('Authorization', `Bearer ${token}`);

  describe('search', () => {
    it('recherche par préfixe (insensible à la casse), sans jamais renvoyer le mot de passe', async () => {
      const res = await get(ownerToken, routerA, '?q=tsa0').expect(200);
      const items = res.body.data.items as { code: string }[];
      expect(items.map((i) => i.code).sort()).toEqual(['TSA01', 'TSA02', 'TSA03', 'TSA04', 'TSA05']);
      expect(JSON.stringify(res.body)).not.toContain('pw-DO-NOT-LEAK');
    });

    it('pagination curseur : 2 + 2 + 1, sans doublon ni trou', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 3; page++) {
        const qs: string = `?q=TSA0&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const res: request.Response = await get(ownerToken, routerA, qs).expect(200);
        seen.push(...res.body.data.items.map((i: { code: string }) => i.code));
        cursor = res.body.data.nextCursor as string | null;
      }
      expect(cursor).toBeNull();
      expect(new Set(seen).size).toBe(5);
    });

    it('curseur falsifié → 400', async () => {
      await get(ownerToken, routerA, '?cursor=bm9wZQ').expect(400);
    });

    it('IDOR : le routeur d’un autre tenant ne renvoie aucun ticket', async () => {
      const res = await get(ownerToken, routerB, '?q=TSB').expect(200);
      expect(res.body.data.items).toEqual([]);
    });

    it('TICKET_VERIFIER refusé (403)', async () => {
      await get(verifierToken, routerA, '?q=TSA0').expect(403);
    });
  });

  describe('reprint', () => {
    it('ADMIN réimprime un ticket jamais utilisé et l’audit ne contient pas le code', async () => {
      const res = await reprint(adminToken, routerA, ids.g1).expect(200);
      expect(res.body.data).toMatchObject({ code: 'TSA01', password: 'pw-DO-NOT-LEAK' });
      const row = await prisma.auditLog.findFirst({ where: { action: AuditAction.EXPORT, entityType: 'Voucher', entityId: ids.g1 } });
      expect(row).not.toBeNull();
      expect(JSON.stringify(row!.metadata)).not.toContain('TSA01');
    });

    it('ticket utilisé : ADMIN refusé (409), OWNER accepté', async () => {
      await reprint(adminToken, routerA, ids.used).expect(409);
      await reprint(ownerToken, routerA, ids.used).expect(200);
    });

    it('ticket révoqué : 409 même pour OWNER', async () => {
      await reprint(ownerToken, routerA, ids.rev).expect(409);
    });

    it('IDOR : ticket d’un autre tenant → 404', async () => {
      await reprint(ownerToken, routerB, ids.foreign).expect(404);
      await reprint(ownerToken, routerA, ids.foreign).expect(404);
    });

    it('TICKET_VERIFIER refusé (403)', async () => {
      await reprint(verifierToken, routerA, ids.g2).expect(403);
    });
  });
});
