/**
 * Conformité — consentement, suppression de compte, accès distant, rétention.
 * DB PostgreSQL réelle (testcontainers), injection Nest réelle.
 */
import request from 'supertest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import appleSignin from 'apple-signin-auth';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ManagementMode,
  PaymentMethod,
  RemotePeerStatus,
  SubscriptionPlan,
  SubscriptionStatus,
  TenantStatus,
  UserStatus,
} from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import { signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { ComplianceRetentionService } from '../../src/modules/compliance/compliance-retention.service';
import { LEGAL_VERSIONS } from '../../src/modules/legal/legal.versions';

const DAY_MS = 86_400_000;
const PROOFS_DIR = join(process.cwd(), 'private-uploads', 'proofs');

describe('Compliance (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let retention: ComplianceRetentionService;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const me = async (token: string) =>
    (await request(app.getHttpServer()).get('/api/auth/me').set(bearer(token)).expect(200)).body.data;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    retention = app.get(ComplianceRetentionService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('consentement', () => {
    it('nouveau compte : versions courantes enregistrées, aucun consentement à redemander', async () => {
      const u = await signupUser(app);
      const data = await me(u.accessToken);

      expect(data.legal).toEqual(LEGAL_VERSIONS);
      expect(data.user.termsVersion).toBe(LEGAL_VERSIONS.terms);
      expect(data.user.privacyVersion).toBe(LEGAL_VERSIONS.privacy);
    });

    it('ancien compte (sans consentement) : /auth/me expose l’écart, legal-consent le comble', async () => {
      const u = await signupUser(app);
      await prisma.user.update({
        where: { email: u.email.toLowerCase() },
        data: { termsVersion: null, termsAcceptedAt: null, privacyVersion: null, privacyAcceptedAt: null },
      });

      const before = await me(u.accessToken);
      expect(before.user.termsVersion).toBeNull();
      expect(before.user.termsVersion).not.toBe(before.legal.terms);

      await request(app.getHttpServer())
        .post('/api/auth/legal-consent')
        .set(bearer(u.accessToken))
        .send({ termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy })
        .expect(200);

      const after = await me(u.accessToken);
      expect(after.user.termsVersion).toBe(after.legal.terms);
      expect(after.user.privacyVersion).toBe(after.legal.privacy);
    });

    it('Google : le compte créé n’a aucun consentement enregistré → demandé après connexion', async () => {
      const email = `google-${Date.now()}@example.com`;
      const auth = app.get(AuthService) as unknown as { googleClient: unknown; googleAudiences: string[] };
      auth.googleClient = {
        verifyIdToken: async () => ({
          getPayload: () => ({ sub: `g-${Date.now()}`, email, email_verified: true, name: 'Goo Gle' }),
        }),
      };

      const res = await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({ idToken: 'x'.repeat(40) })
        .expect(200);

      const data = await me(res.body.data.accessToken);
      expect(data.user.termsVersion).toBeNull();
      expect(data.user.privacyVersion).toBeNull();
      expect(data.legal.terms).toBe(LEGAL_VERSIONS.terms);
    });

    it('Apple : le compte créé n’a aucun consentement enregistré → demandé après connexion', async () => {
      process.env.APPLE_CLIENT_ID = 'net.mikrolan.test';
      const email = `apple-${Date.now()}@example.com`;
      const spy = jest.spyOn(appleSignin, 'verifyIdToken').mockResolvedValue({
        sub: `a-${Date.now()}`,
        email,
        email_verified: 'true',
      } as never);

      const res = await request(app.getHttpServer())
        .post('/api/auth/apple')
        .send({ identityToken: 'y'.repeat(40), fullName: 'App Le' })
        .expect(200);
      spy.mockRestore();

      const data = await me(res.body.data.accessToken);
      expect(data.user.termsVersion).toBeNull();
      expect(data.user.privacyVersion).toBeNull();
    });
  });

  describe('suppression de compte', () => {
    it('deleteAccount : compte et tenant marqués supprimés, connexion impossible', async () => {
      const u = await signupUser(app);

      await request(app.getHttpServer())
        .delete('/api/auth/me')
        .set(bearer(u.accessToken))
        .send({ password: u.password })
        .expect(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      expect(user.status).toBe(UserStatus.DELETED);
      expect(user.deletedAt).toBeInstanceOf(Date);
      expect(user.anonymizedAt).toBeNull();
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
      expect(tenant.status).toBe(TenantStatus.DELETED);
      expect(tenant.deletedAt).toBeInstanceOf(Date);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: u.email, password: u.password })
        .expect(401);
    });

    it('avant J+30 : rien n’est anonymisé ; à J+31 : données personnelles, tokens et secrets routeur effacés', async () => {
      const u = await signupUser(app);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      await prisma.router.create({
        data: { tenantId: user.tenantId, identity: `del-${Date.now()}`, alias: 'Boutique', credEncrypted: 'enc', localAddress: '192.168.88.1:80' },
      });
      await prisma.passwordResetCode.create({
        data: { email: user.email, codeHash: 'h', expiresAt: new Date(Date.now() + 600_000) },
      });

      await request(app.getHttpServer())
        .delete('/api/auth/me')
        .set(bearer(u.accessToken))
        .send({ password: u.password })
        .expect(200);
      expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBeGreaterThan(0);

      expect(await retention.anonymizeDeletedUsers(new Date(Date.now() + 29 * DAY_MS))).toBe(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).anonymizedAt).toBeNull();

      expect(await retention.anonymizeDeletedUsers(new Date(Date.now() + 31 * DAY_MS))).toBeGreaterThanOrEqual(1);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.email).toBe(`deleted-${user.id}@anonymized.invalid`);
      expect(after).toMatchObject({ name: null, country: null, googleId: null, appleId: null, pushToken: null });
      expect(after.anonymizedAt).toBeInstanceOf(Date);
      expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.passwordResetCode.count({ where: { email: user.email } })).toBe(0);

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
      expect(tenant.name).toBe('Compte supprimé');
      const routers = await prisma.router.findMany({ where: { tenantId: user.tenantId } });
      expect(routers).toHaveLength(1);
      expect(routers[0]).toMatchObject({ credEncrypted: null, alias: null, localAddress: null });
    });
  });

  describe('accès distant', () => {
    let token: string;
    let tenantId: string;
    let routerId: string;
    const provision = () =>
      request(app.getHttpServer()).post(`/api/routers/${routerId}/remote/provision`).set(bearer(token)).send({});

    beforeAll(async () => {
      const u = await signupUser(app);
      token = u.accessToken;
      const user = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      tenantId = user.tenantId;
      await prisma.subscription.update({
        where: { tenantId },
        data: {
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
        },
      });
      routerId = (
        await prisma.router.create({ data: { tenantId, identity: `remote-${Date.now()}`, mode: ManagementMode.LOCAL } })
      ).id;
    });

    it('tenant sans autorisation : provisionnement refusé (403 REMOTE_ACCESS_AUTH_REQUIRED), aucun pair créé', async () => {
      const res = await provision().expect(403);

      expect(JSON.stringify(res.body)).toContain('REMOTE_ACCESS_AUTH_REQUIRED');
      expect(await prisma.remotePeer.count({ where: { routerId } })).toBe(0);
      const status = await request(app.getHttpServer())
        .get('/api/remote-access/authorization')
        .set(bearer(token))
        .expect(200);
      expect(status.body.data.accepted).toBe(false);
    });

    it('version périmée refusée ; version courante enregistrée avec acteur et horodatage', async () => {
      await request(app.getHttpServer())
        .post('/api/remote-access/authorization/accept')
        .set(bearer(token))
        .send({ version: '1999-01-01' })
        .expect(409);

      await request(app.getHttpServer())
        .post('/api/remote-access/authorization/accept')
        .set(bearer(token))
        .send({ version: LEGAL_VERSIONS.remoteAccess })
        .expect(200);

      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant.remoteAccessVersion).toBe(LEGAL_VERSIONS.remoteAccess);
      expect(tenant.remoteAccessAcceptedAt).toBeInstanceOf(Date);
      expect(tenant.remoteAccessAcceptedById).not.toBeNull();
    });

    it('tenant avec autorisation : provisionnement autorisé', async () => {
      await provision().expect(200);

      const peer = await prisma.remotePeer.findUniqueOrThrow({ where: { routerId } });
      expect(peer.status).toBe(RemotePeerStatus.ACTIVE);
    });

    it('révocation : pairs coupés, routeur repassé en LOCAL, autorisation effacée, nouveau provisionnement refusé', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/remote-access/authorization/revoke')
        .set(bearer(token))
        .expect(200);
      expect(res.body.data).toMatchObject({ revoked: true, revokedPeers: 1 });

      const peer = await prisma.remotePeer.findUniqueOrThrow({ where: { routerId } });
      expect(peer.status).toBe(RemotePeerStatus.REVOKED);
      expect(peer.revokedAt).toBeInstanceOf(Date);
      expect((await prisma.router.findUniqueOrThrow({ where: { id: routerId } })).mode).toBe(ManagementMode.LOCAL);
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      expect(tenant.remoteAccessVersion).toBeNull();
      expect(tenant.remoteAccessAcceptedAt).toBeNull();

      await provision().expect(403);
    });

    it('identifiants routeur effacés 7 jours après la révocation, pas avant', async () => {
      await prisma.router.update({ where: { id: routerId }, data: { credEncrypted: 'enc' } });

      expect(await retention.wipeRevokedRouterCredentials(new Date(Date.now() + 6 * DAY_MS))).toBe(0);
      expect((await prisma.router.findUniqueOrThrow({ where: { id: routerId } })).credEncrypted).toBe('enc');

      expect(await retention.wipeRevokedRouterCredentials(new Date(Date.now() + 8 * DAY_MS))).toBeGreaterThanOrEqual(1);
      expect((await prisma.router.findUniqueOrThrow({ where: { id: routerId } })).credEncrypted).toBeNull();
    });

    it('tenant supprimé : ses pairs actifs sont coupés par le cron', async () => {
      const u = await signupUser(app);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      const router = await prisma.router.create({
        data: { tenantId: user.tenantId, identity: `gone-${Date.now()}`, mode: ManagementMode.REMOTE },
      });
      const suffix = Math.floor(Math.random() * 200) + 20;
      await prisma.remotePeer.create({
        data: {
          routerId: router.id,
          tenantId: user.tenantId,
          wgPublicKey: `pk-${Date.now()}`,
          wgIp: `10.99.${suffix}.2`,
          allocatedPort: 30000 + suffix,
          serverPublicKey: 'srv',
          endpoint: 'vps:51820',
          status: RemotePeerStatus.ACTIVE,
        },
      });

      await request(app.getHttpServer())
        .delete('/api/auth/me')
        .set(bearer(u.accessToken))
        .send({ password: u.password })
        .expect(200);

      const { PeerRevocationService } = await import('../../src/modules/compliance/peer-revocation.service');
      expect(await app.get(PeerRevocationService).revokeAllForDeletedTenants()).toBeGreaterThanOrEqual(1);
      const peer = await prisma.remotePeer.findUniqueOrThrow({ where: { routerId: router.id } });
      expect(peer.status).toBe(RemotePeerStatus.REVOKED);
    });
  });

  describe('rétention', () => {
    it('AuditLog : > 12 mois supprimé, récent conservé', async () => {
      const u = await signupUser(app);
      const { tenantId } = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      const old = await prisma.auditLog.create({
        data: { tenantId, action: 'CREATE', entityType: 'Old', createdAt: new Date(Date.now() - 400 * DAY_MS) },
      });
      const recent = await prisma.auditLog.create({
        data: { tenantId, action: 'CREATE', entityType: 'Recent', createdAt: new Date(Date.now() - 100 * DAY_MS) },
      });

      expect(await retention.purgeAuditLogs()).toBeGreaterThanOrEqual(1);

      expect(await prisma.auditLog.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await prisma.auditLog.findUnique({ where: { id: recent.id } })).not.toBeNull();
    });

    it('PaymentProof : > 24 mois supprimé (ligne + fichier), récent conservé', async () => {
      const u = await signupUser(app);
      const { tenantId } = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
      const invoice = await prisma.invoice.create({
        data: { tenantId, amount: 5000, idempotencyKey: `inv-${Date.now()}` },
      });
      await fs.mkdir(PROOFS_DIR, { recursive: true });
      const oldFile = `old-${Date.now()}.jpg`;
      const recentFile = `recent-${Date.now()}.jpg`;
      await fs.writeFile(join(PROOFS_DIR, oldFile), 'x');
      await fs.writeFile(join(PROOFS_DIR, recentFile), 'x');
      const old = await prisma.paymentProof.create({
        data: {
          invoiceId: invoice.id,
          method: PaymentMethod.WAVE,
          imageUrl: `/private-uploads/proofs/${oldFile}`,
          createdAt: new Date(Date.now() - 800 * DAY_MS),
        },
      });
      const recent = await prisma.paymentProof.create({
        data: {
          invoiceId: invoice.id,
          method: PaymentMethod.WAVE,
          imageUrl: `/private-uploads/proofs/${recentFile}`,
          createdAt: new Date(Date.now() - 100 * DAY_MS),
        },
      });

      expect(await retention.purgePaymentProofs()).toBeGreaterThanOrEqual(1);

      expect(await prisma.paymentProof.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await prisma.paymentProof.findUnique({ where: { id: recent.id } })).not.toBeNull();
      await expect(fs.access(join(PROOFS_DIR, oldFile))).rejects.toThrow();
      await expect(fs.access(join(PROOFS_DIR, recentFile))).resolves.toBeUndefined();
      expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();

      await fs.rm(join(PROOFS_DIR, recentFile), { force: true });
    });
  });
});
