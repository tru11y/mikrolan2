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
      .spyOn(storage, 'presignUpload')
      .mockImplementation(async (key, size) => `https://s3.test/put/${key}?len=${size}`);
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

  it('upload-url : 403 tenant, 409 doublon, 200 avec clé utilisable par POST', async () => {
    const up = (b: object, token = adminToken) =>
      request(app.getHttpServer())
        .post('/api/admin/releases/upload-url')
        .set('Authorization', `Bearer ${token}`)
        .send(b);

    await up({ versionCode: 30, fileSize: 5000 }, tenantToken).expect(403);
    await up({ versionCode: 10, fileSize: 5000 }).expect(409);
    await up({ versionCode: 30, fileSize: 0 }).expect(400);

    const res = (await up({ versionCode: 30, fileSize: 5000 }).expect(200)).body;
    const t = res.data ?? res;
    expect(t.storageKey).toMatch(/^releases\/android\/mikrolan-30-[0-9a-f]{12}\.apk$/);
    expect(t.uploadUrl).toContain('len=5000');
    expect(t.headers['Content-Type']).toBe('application/vnd.android.package-archive');

    await post(body(30, { storageKey: t.storageKey })).expect(201);
  });

  it('upload incomplet : taille S3 différente → 400 et rien en base', async () => {
    const storage = app.get(ReleaseStorageService);
    jest.spyOn(storage, 'headSize').mockResolvedValueOnce(1234);
    await post(body(31)).expect(400);
    expect(await prisma.appRelease.count({ where: { versionCode: 31 } })).toBe(0);
  });

  it('list expose l’e-mail de l’auteur', async () => {
    const res = (await get('').expect(200)).body;
    const items = (res.data ?? res).items as { createdByEmail: string | null }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => typeof i.createdByEmail === 'string')).toBe(true);
  });

  it('portail : HTML/JS/CSS publics, bruts (sans enveloppe), CSP stricte', async () => {
    const page = await request(app.getHttpServer()).get('/api/admin-portal/releases').expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('<title>Versions APK');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(page.headers['cache-control']).toBe('no-store');

    const js = await request(app.getHttpServer()).get('/api/admin-portal/releases.js').expect(200);
    expect(js.headers['content-type']).toContain('javascript');
    expect(js.text.startsWith('(function')).toBe(true);

    const css = await request(app.getHttpServer()).get('/api/admin-portal/releases.css').expect(200);
    expect(css.headers['content-type']).toContain('text/css');
  });

  it('id non-UUID : 400', async () => {
    await patch('not-a-uuid/activate').expect(400);
  });
});
