import { UserRole, UserStatus } from '@prisma/client';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  tenantStore,
  type TenantContext,
} from '../../src/common/context/tenant-context';

/**
 * Isolation multi-tenant AU NIVEAU PRISMA via la Client Extension (remplace le
 * middleware $use). Vérifie que les opérations RÉÉCRITES (findUnique→findFirst,
 * update→updateMany, delete→deleteMany) — le point le plus sensible de la
 * migration — isolent bien les tenants, modèle par modèle.
 */
describe('Isolation tenant via Prisma Client Extension (e2e, DB réelle)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  let tenantA: string;
  let tenantB: string;
  let routerA: string;
  let routerB: string;
  let ticketB: string;

  // On garde le scope ALS ouvert pendant TOUTE l'exécution async (await interne),
  // exactement comme la prod qui enveloppe la requête entière dans tenantStore.run.
  const asTenant = <T>(tenantId: string, role: UserRole, fn: () => Promise<T>): Promise<T> => {
    const ctx: TenantContext = { tenantId, userId: `u-${tenantId}`, role };
    return tenantStore.run({ ctx }, async () => await fn());
  };

  const asBypassAdmin = <T>(fn: () => Promise<T>): Promise<T> => {
    const ctx: TenantContext = { tenantId: 'none', userId: 'admin', role: UserRole.SUPER_ADMIN };
    return tenantStore.run({ ctx, adminBypass: true }, async () => await fn());
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const stamp = Date.now();

    // Création hors contexte tenant (passthrough) → on fixe explicitement les tenantId.
    const tA = await prisma.tenant.create({ data: { name: `iso-A-${stamp}`, slug: `iso-a-${stamp}` } });
    const tB = await prisma.tenant.create({ data: { name: `iso-B-${stamp}`, slug: `iso-b-${stamp}` } });
    tenantA = tA.id;
    tenantB = tB.id;

    const userB = await prisma.user.create({
      data: {
        tenantId: tenantB,
        email: `iso-b-${stamp}@e2e.local`,
        passwordHash: 'x',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    const rA = await prisma.router.create({ data: { tenantId: tenantA, identity: `isoR-A-${stamp}` } });
    routerA = rA.id;
    const rB = await prisma.router.create({ data: { tenantId: tenantB, identity: `isoR-B-${stamp}` } });
    routerB = rB.id;
    const tkB = await prisma.supportTicket.create({
      data: { tenantId: tenantB, subject: 'secret-B', userId: userB.id },
    });
    ticketB = tkB.id;
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  describe('findUnique → findFirst (lookup direct par id ne franchit pas le tenant)', () => {
    it('tenant A ne trouve pas le routeur du tenant B (findUnique → null)', async () => {
      const found = await asTenant(tenantA, UserRole.ADMIN, () =>
        prisma.router.findUnique({ where: { id: routerB } }),
      );
      expect(found).toBeNull();
    });

    it('tenant A : findUniqueOrThrow sur une ligne de B lève (findFirstOrThrow)', async () => {
      await expect(
        asTenant(tenantA, UserRole.ADMIN, () =>
          prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketB } }),
        ),
      ).rejects.toThrow();
    });

    it('le propriétaire (tenant B) retrouve bien sa ligne', async () => {
      const found = await asTenant(tenantB, UserRole.ADMIN, () =>
        prisma.router.findUnique({ where: { id: routerB } }),
      );
      expect(found?.id).toBe(routerB);
    });
  });

  describe('update / delete cross-tenant (extendedWhereUnique → P2025, aucune mutation croisée)', () => {
    it('tenant A : update du routeur de B lève P2025 et ne modifie rien', async () => {
      await expect(
        asTenant(tenantA, UserRole.ADMIN, () =>
          prisma.router.update({ where: { id: routerB }, data: { identity: 'HACKED' } }),
        ),
      ).rejects.toThrow();
      const still = await asBypassAdmin(() => prisma.router.findUnique({ where: { id: routerB } }));
      expect(still?.identity).not.toBe('HACKED');
    });

    it('tenant A : updateMany du routeur de B affecte 0 ligne', async () => {
      const res = await asTenant(tenantA, UserRole.ADMIN, () =>
        prisma.router.updateMany({ where: { id: routerB }, data: { identity: 'HACKED2' } }),
      );
      expect(res.count).toBe(0);
      const still = await asBypassAdmin(() => prisma.router.findUnique({ where: { id: routerB } }));
      expect(still?.identity).not.toBe('HACKED2');
    });

    it('tenant A : delete du ticket de B lève et ne supprime rien', async () => {
      await expect(
        asTenant(tenantA, UserRole.ADMIN, () => prisma.supportTicket.delete({ where: { id: ticketB } })),
      ).rejects.toThrow();
      const still = await asBypassAdmin(() => prisma.supportTicket.findUnique({ where: { id: ticketB } }));
      expect(still?.id).toBe(ticketB);
    });
  });

  describe('create / findMany (injection tenantId + liste scopée)', () => {
    it('create sous A force tenantId=A même si B est fourni (anti-spoof)', async () => {
      const r = await asTenant(tenantA, UserRole.ADMIN, () =>
        prisma.router.create({ data: { tenantId: tenantB, identity: `spoof-${Date.now()}` } }),
      );
      expect(r.tenantId).toBe(tenantA);
    });

    it('findMany sous A ne renvoie aucune ligne de B', async () => {
      const rows = await asTenant(tenantA, UserRole.ADMIN, () =>
        prisma.router.findMany({ where: {} }),
      );
      expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
      expect(rows.some((r) => r.id === routerB)).toBe(false);
    });
  });

  describe('$transaction batch avec opération scopée (garde-fou anti-deadlock)', () => {
    it('update scopé dans un $transaction([...]) sur une ligne du tenant réussit sans blocage', async () => {
      // Motif exact de resetPassword : update (scopé → extendedWhereUnique) + updateMany
      // dans la forme batch. Doit s'exécuter atomiquement DANS la transaction, pas se
      // redispatcher hors pipeline (ce qui deadlockait).
      await asTenant(tenantA, UserRole.ADMIN, () =>
        prisma.$transaction([
          prisma.router.update({ where: { id: routerA }, data: { identity: 'batch-ok' } }),
          prisma.router.updateMany({ where: { id: routerA }, data: { alias: 'a' } }),
        ]),
      );
      const after = await asBypassAdmin(() => prisma.router.findUnique({ where: { id: routerA } }));
      expect(after?.identity).toBe('batch-ok');
    });
  });

  describe('SUPER_ADMIN bypass', () => {
    it('voit les lignes de tous les tenants (findUnique non réécrit)', async () => {
      const found = await asBypassAdmin(() => prisma.router.findUnique({ where: { id: routerB } }));
      expect(found?.id).toBe(routerB);
    });
  });
});
