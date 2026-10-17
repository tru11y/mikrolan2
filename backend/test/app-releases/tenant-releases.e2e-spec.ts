/**
 * Intégration réelle (PostgreSQL isolé) du portail de téléchargement APK côté tenant.
 * S3 est remplacé par un stub. Données synthétiques.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ReleaseStorageService } from '../../src/modules/app-releases/release-storage.service';

describe('Portail APK tenant — intégration réelle (PostgreSQL isolé)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let tenantToken: string;
  let otherTenantToken: string;
  const ids: Record<number, string> = {};

  const unwrap = <T>(b: { data?: T } & T): T => (b as { data?: T }).data ?? (b as T);
  const adminPost = (b: object) =>
    request(app.getHttpServer()).post('/api/admin/releases').set('Authorization', `Bearer ${adminToken}`).send(b);
  const adminPatch = (path: string) =>
    request(app.getHttpServer()).patch(`/api/admin/releases/${path}`).set('Authorization', `Bearer ${adminToken}`).send({});
  const tGet = (path: string, token = tenantToken) =>
    request(app.getHttpServer()).get(`/api/releases${path}`).set('Authorization', `Bearer ${token}`);
  const tLog = (id: string, token = tenantToken) =>
    request(app.getHttpServer()).post(`/api/releases/${id}/download-log`).set('Authorization', `Bearer ${token}`);

  const body = (versionCode: number) => ({
    versionName: `2.0.${versionCode}`,
    versionCode,
    minVersionCode: 1,
    releaseNotes: `notes ${versionCode}`,
    fileSize: 5000,
    storageKey: `releases/android/portal-${versionCode}.apk`,
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    // DB partagée entre suites : on repart sans release active.
    await prisma.appRelease.updateMany({ data: { isActive: false } });
    const storage = app.get(ReleaseStorageService);
    jest.spyOn(storage, 'headSize').mockResolvedValue(5000);
    jest.spyOn(storage, 'presignDownload').mockImplementation(async (k) => `https://s3.test/${k}?sig=x`);

    const admin = await signupUser(app, { tenantName: 'Platform' });
    adminToken = (await promoteToSuperAdmin(app, admin.email, admin.password)).accessToken;
    tenantToken = (await signupUser(app, { tenantName: 'Client A' })).accessToken;
    otherTenantToken = (await signupUser(app, { tenantName: 'Client B' })).accessToken;
  });

  afterAll(async () => {
    // DB partagée : ne pas laisser de release active aux autres suites.
    await prisma.appRelease.updateMany({ data: { isActive: false } });
    // Les ReleaseDownload (FK RESTRICT) bloqueraient le deleteMany({}) des autres suites.
    await prisma.releaseDownload.deleteMany({ where: { release: { versionCode: { gte: 100 } } } });
    await prisma.appRelease.deleteMany({ where: { versionCode: { gte: 100 } } });
    await app.close();
  });

  it('sans token : 401 ; id non-UUID : 400', async () => {
    await request(app.getHttpServer()).get('/api/releases/latest').expect(401);
    await request(app.getHttpServer()).get('/api/releases/history').expect(401);
    await tLog('not-a-uuid').expect(400);
  });

  it('latest : 404 RELEASE_NOT_FOUND tant qu’aucune release n’est active', async () => {
    const res = await tGet('/latest').expect(404);
    expect(res.body.errorCode ?? res.body.data?.errorCode).toBe('RELEASE_NOT_FOUND');
  });

  it('seed : 7 releases, la 7e active', async () => {
    for (let c = 101; c <= 107; c++) {
      ids[c] = unwrap<{ id: string }>((await adminPost(body(c)).expect(201)).body).id;
    }
    await adminPatch(`${ids[107]}/activate`).expect(200);
  });

  it('latest (tenant) : métadonnées + URL signée, sans storageKey', async () => {
    const r = unwrap<Record<string, unknown>>((await tGet('/latest').expect(200)).body);
    expect(r).toMatchObject({ versionCode: 107, fileSize: 5000, isActive: true });
    expect(r.downloadUrl).toContain('portal-107.apk');
    expect(r).not.toHaveProperty('storageKey');
    expect(r).not.toHaveProperty('createdById');
  });

  it('latest : fichier disparu du stockage → 404 RELEASE_FILE_MISSING', async () => {
    const storage = app.get(ReleaseStorageService);
    const spy = jest.spyOn(storage, 'headSize').mockResolvedValue(null);
    const res = await tGet('/latest').expect(404);
    expect(res.body.errorCode ?? res.body.data?.errorCode).toBe('RELEASE_FILE_MISSING');
    spy.mockResolvedValue(5000);
  });

  it('history : 5 dernières, ordre décroissant, active/required exposés', async () => {
    await adminPatch(`${ids[107]}/require`).expect(200);
    const list = unwrap<{ versionCode: number; isActive: boolean; isRequired: boolean }[]>(
      (await tGet('/history').expect(200)).body,
    );
    expect(list.map((r) => r.versionCode)).toEqual([107, 106, 105, 104, 103]);
    expect(list[0]).toMatchObject({ isActive: true, isRequired: true });
    expect(list[1]).toMatchObject({ isActive: false, isRequired: false });
  });

  it('download-log : trace tenant + user + release', async () => {
    const res = await tLog(ids[107]).expect(201);
    const { id } = unwrap<{ id: string }>(res.body);
    const dl = await prisma.releaseDownload.findUniqueOrThrow({ where: { id } });
    expect(dl.releaseId).toBe(ids[107]);
    expect(dl.tenantId).toBeTruthy();
    expect(dl.userId).toBeTruthy();
    expect(dl.downloadedAt).toBeInstanceOf(Date);

    await tLog(ids[107], otherTenantToken).expect(201);
    const tenants = new Set(
      (await prisma.releaseDownload.findMany({ where: { releaseId: ids[107] } })).map((d) => d.tenantId),
    );
    expect(tenants.size).toBe(2);
  });

  it('download-log : release inactive 409, archivée/inconnue 404', async () => {
    const inactive = await tLog(ids[106]).expect(409);
    expect(inactive.body.errorCode ?? inactive.body.data?.errorCode).toBe('RELEASE_INACTIVE');
    await adminPatch(`${ids[101]}/archive`).expect(200);
    await tLog(ids[101]).expect(404);
    await tLog('00000000-0000-4000-8000-000000000000').expect(404);
    expect(await prisma.releaseDownload.count({ where: { releaseId: ids[106] } })).toBe(0);
  });

  it('les routes /admin/releases restent fermées aux tenants', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/releases/latest')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(403);
  });
});
