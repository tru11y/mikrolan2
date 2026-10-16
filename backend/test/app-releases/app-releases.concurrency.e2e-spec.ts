/**
 * Concurrence réelle (PostgreSQL isolé) : plusieurs requêtes HTTP simultanées
 * sur les transitions d'état des releases. Invariants :
 *   - au plus une release active à tout instant (et exactement une après activation) ;
 *   - une release active n'est jamais archivée ;
 *   - `latest` répond toujours quand une release est active.
 */
import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { promoteToSuperAdmin, signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ReleaseStorageService } from '../../src/modules/app-releases/release-storage.service';

describe('APK releases — concurrence (PostgreSQL isolé)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let token: string;
  let adminId: string;
  let nextCode = 1000;

  const make = async (over: Record<string, unknown> = {}) => {
    const code = nextCode++;
    return prisma.appRelease.create({
      data: {
        versionName: `2.0.${code}`,
        versionCode: code,
        minVersionCode: 1,
        releaseNotes: 'n',
        fileSize: 10,
        storageKey: `releases/android/c-${code}.apk`,
        createdById: adminId,
        ...over,
      },
    });
  };
  const patch = (id: string, action: string, body: object = {}) =>
    request(app.getHttpServer())
      .patch(`/api/admin/releases/${id}/${action}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const activeCount = () => prisma.appRelease.count({ where: { isActive: true } });
  const reset = () => prisma.appRelease.deleteMany({});

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const storage = app.get(ReleaseStorageService);
    jest.spyOn(storage, 'presignDownload').mockResolvedValue('https://s3.test/x');

    const admin = await signupUser(app, { tenantName: 'Concurrency' });
    token = (await promoteToSuperAdmin(app, admin.email, admin.password)).accessToken;
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: admin.email } })).id;
  });

  beforeEach(reset);
  afterAll(async () => {
    // La base e2e est partagée entre fichiers : ne rien laisser derrière soi.
    await reset();
    await app.close();
  });

  it('activations simultanées de N releases : exactement une active, aucune erreur', async () => {
    for (let round = 0; round < 6; round++) {
      await reset();
      const rels = await Promise.all(Array.from({ length: 8 }, () => make()));
      const res = await Promise.all(rels.map((r) => patch(r.id, 'activate')));

      expect(res.map((r) => r.status)).toEqual(rels.map(() => 200));
      expect(await activeCount()).toBe(1);
    }
  });

  it('rollback concurrent (ancienne vs nouvelle) : une seule active, latest répond', async () => {
    for (let round = 0; round < 6; round++) {
      await reset();
      const oldR = await make({ isActive: true });
      const [a, b] = await Promise.all([make(), make()]);
      await Promise.all([patch(a.id, 'activate'), patch(b.id, 'activate'), patch(oldR.id, 'activate')]);

      expect(await activeCount()).toBe(1);
      await request(app.getHttpServer())
        .get('/api/admin/releases/latest')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  });

  it('activer et archiver la même release : jamais archivée ET active', async () => {
    for (let round = 0; round < 10; round++) {
      await reset();
      const r = await make();
      const [act, arc] = await Promise.all([patch(r.id, 'activate'), patch(r.id, 'archive')]);

      const row = await prisma.appRelease.findUniqueOrThrow({ where: { id: r.id } });
      expect(row.isActive && row.archivedAt !== null).toBe(false);
      expect([act.status, arc.status].sort()).toEqual([200, 409]);
    }
  });

  it('archiver l’active pendant qu’une autre est activée : une active, latest répond', async () => {
    for (let round = 0; round < 10; round++) {
      await reset();
      const a = await make({ isActive: true });
      const b = await make();
      await Promise.all([patch(b.id, 'activate'), patch(a.id, 'archive')]);

      expect(await activeCount()).toBe(1);
      const active = await prisma.appRelease.findFirstOrThrow({ where: { isActive: true } });
      expect(active.archivedAt).toBeNull();
      expect(active.id).toBe(b.id);
      await request(app.getHttpServer())
        .get('/api/admin/releases/latest')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  });

  it('double archivage simultané : un 200, un 409', async () => {
    for (let round = 0; round < 6; round++) {
      await reset();
      const r = await make();
      const res = await Promise.all([patch(r.id, 'archive'), patch(r.id, 'archive')]);
      expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
    }
  });

  it('archiver pendant require : état cohérent, pas d’erreur 5xx', async () => {
    for (let round = 0; round < 6; round++) {
      await reset();
      const r = await make();
      const res = await Promise.all([
        patch(r.id, 'archive'),
        patch(r.id, 'require', { required: true }),
      ]);
      expect(res.every((x) => x.status === 200 || x.status === 409)).toBe(true);
    }
  });

  it('échec en cours de transaction : l’ancienne release reste active (rollback)', async () => {
    const oldR = await make({ isActive: true });
    const target = await make();

    const realTx = prisma.$transaction.bind(prisma);
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(((fn: (tx: any) => Promise<unknown>) =>
        realTx(async (tx: any) =>
          fn(
            new Proxy(tx, {
              get(t, p) {
                if (p === 'appRelease') {
                  return new Proxy(t.appRelease, {
                    get(m, k) {
                      return k === 'update'
                        ? () => Promise.reject(new Error('boom'))
                        : m[k as string].bind(m);
                    },
                  });
                }
                const v = t[p as string];
                return typeof v === 'function' ? v.bind(t) : v;
              },
            }),
          ),
        )) as never);

    await patch(target.id, 'activate').expect(500);
    spy.mockRestore();

    const rows = await prisma.appRelease.findMany({ where: { isActive: true } });
    expect(rows.map((r) => r.id)).toEqual([oldR.id]);
  });

  it('contrainte DB : impossible d’avoir deux actives même hors du service', async () => {
    await make({ isActive: true });
    await expect(make({ isActive: true })).rejects.toThrow();
  });
});
