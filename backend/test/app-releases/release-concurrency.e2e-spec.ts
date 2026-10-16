/**
 * Concurrence réelle (PostgreSQL isolé) du cycle de vie des releases :
 * verrou consultatif + index unique partiel + contrainte CHECK.
 * S3 est remplacé par un stub. Données synthétiques.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ReleaseStorageService } from '../../src/modules/app-releases/release-storage.service';

describe('Releases — concurrence (PostgreSQL isolé)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let token: string;
  let seq = 300;

  const unwrap = <T>(b: { data?: T } & T): T => (b as { data?: T }).data ?? (b as T);
  const create = async (): Promise<string> => {
    const c = ++seq;
    const res = await request(app.getHttpServer())
      .post('/api/admin/releases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        versionName: `3.0.${c}`,
        versionCode: c,
        minVersionCode: 1,
        releaseNotes: 'n',
        fileSize: 5000,
        storageKey: `releases/android/conc-${c}.apk`,
      })
      .expect(201);
    return unwrap<{ id: string }>(res.body).id;
  };
  const act = (id: string, what: 'activate' | 'archive') =>
    request(app.getHttpServer())
      .patch(`/api/admin/releases/${id}/${what}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort();
  const activeCount = () => prisma.appRelease.count({ where: { isActive: true } });
  const brokenCount = () =>
    prisma.appRelease.count({ where: { isActive: true, archivedAt: { not: null } } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const storage = app.get(ReleaseStorageService);
    jest.spyOn(storage, 'headSize').mockResolvedValue(5000);
    jest.spyOn(storage, 'presignDownload').mockImplementation(async (k) => `https://s3.test/${k}`);
    const admin = await signupUser(app, { tenantName: 'Platform' });
    token = (await promoteToSuperAdmin(app, admin.email, admin.password)).accessToken;
  });

  beforeEach(async () => {
    await prisma.appRelease.updateMany({ data: { isActive: false } });
  });

  afterAll(async () => {
    // DB partagée entre suites : retirer nos releases (codes >= 100) pour ne pas fausser les autres listes.
    await prisma.releaseDownload.deleteMany({ where: { release: { versionCode: { gte: 100 } } } });
    await prisma.appRelease.deleteMany({ where: { versionCode: { gte: 100 } } });
    await app.close();
  });

  it('activate vs activate (10 releases en parallèle) : exactement une active', async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, create));
    const rs = await Promise.all(ids.map((id) => act(id, 'activate')));
    expect(statuses(rs)).toEqual(Array(10).fill(200));
    expect(await activeCount()).toBe(1);
  });

  it('activate vs activate répété sur 2 releases (20 tours) : jamais 2 actives', async () => {
    const [a, b] = await Promise.all([create(), create()]);
    for (let i = 0; i < 20; i++) {
      await Promise.all([act(a, 'activate'), act(b, 'activate')]);
      expect(await activeCount()).toBe(1);
    }
  });

  it('activate vs archive sur la même release (15 tours) : jamais active ET archivée', async () => {
    for (let i = 0; i < 15; i++) {
      const id = await create();
      const [r1, r2] = await Promise.all([act(id, 'activate'), act(id, 'archive')]);
      expect(await brokenCount()).toBe(0);
      expect(await activeCount()).toBeLessThanOrEqual(1);
      // Sérialisés : soit activate puis archive refusé (409), soit archive puis activate refusé (409).
      expect(statuses([r1, r2])).toEqual([200, 409]);
      await prisma.appRelease.update({ where: { id }, data: { isActive: false } });
    }
  });

  it('activate d’une autre release vs archive de l’ancienne active : une seule active, aucune archivée active', async () => {
    const old = await create();
    await act(old, 'activate').expect(200);
    const next = await create();
    await Promise.all([act(next, 'activate'), act(old, 'archive')]);
    expect(await brokenCount()).toBe(0);
    expect(await activeCount()).toBe(1);
    const row = await prisma.appRelease.findUniqueOrThrow({ where: { id: next } });
    expect(row.isActive).toBe(true);
  });

  it('archive vs archive : une seule réussit, l’autre est refusée (409)', async () => {
    const id = await create();
    const rs = await Promise.all([act(id, 'archive'), act(id, 'archive'), act(id, 'archive')]);
    expect(statuses(rs)).toEqual([200, 409, 409]);
    expect((await prisma.appRelease.findUniqueOrThrow({ where: { id } })).archivedAt).not.toBeNull();
  });

  it('DB : un second active direct est rejeté (index unique partiel)', async () => {
    const [a, b] = await Promise.all([create(), create()]);
    await prisma.appRelease.update({ where: { id: a }, data: { isActive: true } });
    await expect(
      prisma.appRelease.update({ where: { id: b }, data: { isActive: true } }),
    ).rejects.toThrow();
    expect(await activeCount()).toBe(1);
  });

  it('DB : archiver une release active directement est rejeté (CHECK)', async () => {
    const id = await create();
    await prisma.appRelease.update({ where: { id }, data: { isActive: true } });
    await expect(
      prisma.appRelease.update({ where: { id }, data: { archivedAt: new Date() } }),
    ).rejects.toThrow();
  });

  it('latest déterministe : stable sur 20 appels, = la release activée en dernier', async () => {
    const [a, b] = await Promise.all([create(), create()]);
    await act(a, 'activate').expect(200);
    await act(b, 'activate').expect(200);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const res = await request(app.getHttpServer())
        .get('/api/admin/releases/latest')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      seen.add(unwrap<{ id: string }>(res.body).id);
    }
    expect([...seen]).toEqual([b]);
  });
});
