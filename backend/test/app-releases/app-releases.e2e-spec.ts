/**
 * Intégration réelle (PostgreSQL isolé) du module APK releases : migration,
 * contraintes DB, fermeture par rôle et cycle create → activate → rollback.
 * S3 est remplacé par un stub (aucun appel réseau). Données synthétiques.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ReleaseStorageService } from '../../src/modules/app-releases/release-storage.service';

describe('APK releases — intégration réelle (PostgreSQL isolé)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let tenantToken: string;

  const body = (versionCode: number, over: Record<string, unknown> = {}) => ({
    versionName: `1.0.${versionCode}`,
    versionCode,
    minVersionCode: 1,
    releaseNotes: `notes ${versionCode}`,
    fileSize: 5000,
    storageKey: `releases/android/mikrolan-${versionCode}.apk`,
    ...over,
  });

  const post = (b: unknown, token = adminToken) =>
    request(app.getHttpServer())
      .post('/api/admin/releases')
      .set('Authorization', `Bearer ${token}`)
      .send(b as object);
  const patch = (path: string, b: object = {}, token = adminToken) =>
    request(app.getHttpServer())
      .patch(`/api/admin/releases/${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(b);
  const get = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .get(`/api/admin/releases${path}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const storage = app.get(ReleaseStorageService);
    jest.spyOn(storage, 'headSize').mockImplementation(async (key) =>
      key.includes('missing') ? null : 5000,
    );
    jest
      .spyOn(storage, 'presignDownload')
      .mockImplementation(async (key) => `https://s3.test/${key}?sig=x`);

    const admin = await signupUser(app, { tenantName: 'Platform' });
    adminToken = (await promoteToSuperAdmin(app, admin.email, admin.password)).accessToken;
    const tenant = await signupUser(app, { tenantName: 'Client' });
    tenantToken = tenant.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('un tenant non SUPER_ADMIN reçoit 403 sur chaque route', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    await post(body(1), tenantToken).expect(403);
    await get('', tenantToken).expect(403);
    await get('/latest', tenantToken).expect(403);
    await patch(`${id}/activate`, {}, tenantToken).expect(403);
    await patch(`${id}/require`, {}, tenantToken).expect(403);
    await patch(`${id}/archive`, {}, tenantToken).expect(403);
  });

  it('sans token : 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/releases').expect(401);
  });

  it('GET /latest : 404 tant qu’aucune release n’est active', async () => {
    const res = await get('/latest').expect(404);
    expect(res.body.errorCode ?? res.body.data?.errorCode).toBe('RELEASE_NOT_FOUND');
  });

  it('POST valide : crée inactive, trace createdBy', async () => {
    const res = await post(body(10)).expect(201);
    const r = res.body.data ?? res.body;
    expect(r).toMatchObject({ versionCode: 10, isActive: false, isRequired: false });
    const row = await prisma.appRelease.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.createdById).toBeTruthy();
  });

  it('POST : versionCode dupliqué = 409, fichier absent = 400, corps invalide = 400', async () => {
    await post(body(10)).expect(409);
    await post(body(11, { storageKey: 'releases/android/missing.apk' })).expect(400);
    await post(body(12, { fileSize: 4999 })).expect(400);
    await post(body(13, { storageKey: 'releases/android/../x.apk' })).expect(400);
    await post(body(14, { minVersionCode: 99 })).expect(400);
    await post(body(15, { isActive: true })).expect(400);
  });

  it('activate → une seule active ; rollback = réactiver l’ancienne', async () => {
    const a = (await post(body(20)).expect(201)).body;
    const b = (await post(body(21)).expect(201)).body;
    const idA = (a.data ?? a).id as string;
    const idB = (b.data ?? b).id as string;

    await patch(`${idA}/activate`).expect(200);
    await patch(`${idB}/activate`).expect(200);
    expect(await prisma.appRelease.count({ where: { isActive: true } })).toBe(1);
    let latest = (await get('/latest').expect(200)).body;
    latest = latest.data ?? latest;
    expect(latest.versionCode).toBe(21);
    expect(latest.downloadUrl).toContain('releases/android/mikrolan-21.apk');

    await patch(`${idA}/activate`).expect(200);
    latest = (await get('/latest').expect(200)).body;
    latest = latest.data ?? latest;
    expect(latest.versionCode).toBe(20);
    expect(await prisma.appRelease.count({ where: { isActive: true } })).toBe(1);
  });

  it('require : plancher effectif = versionCode, réversible', async () => {
    const latest = (await get('/latest').expect(200)).body;
    const id = (latest.data ?? latest).id as string;

    let r = (await patch(`${id}/require`).expect(200)).body;
    r = r.data ?? r;
    expect(r).toMatchObject({ isRequired: true, effectiveMinVersionCode: 20 });

    r = (await patch(`${id}/require`, { required: false }).expect(200)).body;
    r = r.data ?? r;
    expect(r).toMatchObject({ isRequired: false, effectiveMinVersionCode: 1 });
  });

  it('archive : refuse l’active (409), archive une inactive, puis activate refuse (409)', async () => {
    const active = (await get('/latest').expect(200)).body;
    const activeId = (active.data ?? active).id as string;
    await patch(`${activeId}/archive`).expect(409);

    const row = await prisma.appRelease.findUniqueOrThrow({ where: { versionCode: 21 } });
    await patch(`${row.id}/archive`).expect(200);
    expect(
      (await prisma.appRelease.findUniqueOrThrow({ where: { id: row.id } })).archivedAt,
    ).not.toBeNull();
    await patch(`${row.id}/activate`).expect(409);
    await patch(`${row.id}/require`).expect(409);
  });

  it('list : masque les archivées par défaut, les montre avec includeArchived', async () => {
    const codes = async (q: string) => {
      const res = (await get(q).expect(200)).body;
      return ((res.data ?? res).items as { versionCode: number }[]).map((i) => i.versionCode);
    };
    expect(await codes('')).not.toContain(21);
    expect(await codes('?includeArchived=true')).toContain(21);
  });

  it('écrit des lignes d’audit pour les actions admin', async () => {
    const count = await prisma.auditLog.count({ where: { entityType: 'AppRelease' } });
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it('id non-UUID : 400', async () => {
    await patch('not-a-uuid/activate').expect(400);
  });
});
