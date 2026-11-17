import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { VoucherBatchStatus } from '@prisma/client';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';
import { signupUser, loginUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  canonicalFingerprint,
  IDEMPOTENCY_UNIQUE_INDEX_NAME,
} from '../../src/modules/vouchers/voucher-idempotency';

/**
 * E2E idempotence B-01 — PostgreSQL réel (testcontainers), HTTP réel, routeur
 * LOCAL (pas de peer actif) → pas de push RouterOS à mocker. On vérifie :
 *  - migration appliquée (colonnes + index présents),
 *  - header absent → chemin legacy,
 *  - clé + payload identique → replay strict,
 *  - clé + payload différent → 409,
 *  - UUID identique sur deux tenants → deux lots distincts,
 *  - headers invalides / dupliqués → 400,
 *  - concurrence : deux POST simultanés → un seul batch,
 *  - replay GENERATING → 202 + Retry-After,
 *  - P2002 sans rapport avec l'index d'idempotence → remontée telle quelle.
 */
describe('Vouchers idempotency (e2e, B-01)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  // Deux tenants isolés pour tester l'isolation multi-tenant de la clé.
  async function setupTenant(label: string) {
    const owner = await signupUser(app, { tenantName: label, email: `${label}-${Date.now()}@e2e.local` });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.email } });
    const { accessToken } = await loginUser(app, owner.email, owner.password);
    const identity = `${label}-${Date.now()}`;
    const router = await prisma.router.create({ data: { tenantId: user.tenantId, identity } });
    const plan = await prisma.plan.create({
      data: {
        tenantId: user.tenantId,
        routerId: router.id,
        name: '1h',
        slug: `${label}-1h`,
        durationMinutes: 60,
        sharedUsers: 1,
        priceXof: 500,
      },
    });
    const planAlt = await prisma.plan.create({
      data: {
        tenantId: user.tenantId,
        routerId: router.id,
        name: '2h',
        slug: `${label}-2h`,
        durationMinutes: 120,
        sharedUsers: 1,
        priceXof: 800,
      },
    });
    return { tenantId: user.tenantId, token: accessToken, routerId: router.id, planId: plan.id, planAltId: planAlt.id };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('migration applied: VoucherBatch has clientRequestId, requestFingerprint, pushedByServer, pushParamsSnapshot and the unique index', async () => {
    const cols = (await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'VoucherBatch'`,
    ));
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]));
    expect(byName).toMatchObject({
      clientRequestId: 'text',
      requestFingerprint: 'text',
      pushedByServer: 'boolean',
      pushParamsSnapshot: 'jsonb',
    });
    const indexes = (await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'VoucherBatch'`,
    )).map((r) => r.indexname);
    expect(indexes).toContain(IDEMPOTENCY_UNIQUE_INDEX_NAME);
  });

  it('no header → legacy path, idempotency columns NULL but LAN snapshot persisted', async () => {
    const t = await setupTenant('legacy');
    const res = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .send({ planId: t.planId, quantity: 2 })
      .expect(200);
    const batchId = (res.body.data as { batchId: string }).batchId;
    const row = await prisma.voucherBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(row.clientRequestId).toBeNull();
    expect(row.requestFingerprint).toBeNull();
    // LOCAL router + no peer → pushedByServer = false, snapshot LAN persisté
    expect(row.pushedByServer).toBe(false);
    expect(row.pushParamsSnapshot).toMatchObject({
      userProfile: expect.any(String),
      limitUptime: '60m',
      comment: `mikrolan:${batchId}`,
    });
    // Aucune donnée sensible dans le snapshot.
    const serialized = JSON.stringify(row.pushParamsSnapshot);
    expect(serialized).not.toMatch(/password|token|credential|apiKey/i);
  });

  it('REMOTE batch without active peer still writes LAN snapshot (no peer → not server-pushed)', async () => {
    // Un routeur en mode REMOTE sans peer actif tombe sur le chemin LAN côté
    // serveur (pas de push tunnel). Le snapshot est donc présent.
    const t = await setupTenant('remote-nopeer');
    await prisma.router.update({ where: { id: t.routerId }, data: { mode: 'REMOTE' } });
    const res = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .send({ planId: t.planId, quantity: 1 })
      .expect(200);
    const batchId = (res.body.data as { batchId: string }).batchId;
    const row = await prisma.voucherBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(row.pushedByServer).toBe(false);
    expect(row.pushParamsSnapshot).not.toBeNull();
  });

  it('with Idempotency-Key, stores UUID and fingerprint, and a second call replays the same batch', async () => {
    const t = await setupTenant('key');
    const key = randomUUID();

    const first = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 3 })
      .expect(200);
    const firstBatch = (first.body.data as { batchId: string }).batchId;
    const row = await prisma.voucherBatch.findUniqueOrThrow({ where: { id: firstBatch } });
    expect(row.clientRequestId).toBe(key);
    const expectedFp = canonicalFingerprint({ tenantId: t.tenantId, routerId: t.routerId, planId: t.planId, quantity: 3 });
    expect(row.requestFingerprint).toBe(expectedFp);

    const second = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 3 });

    expect([200, 202]).toContain(second.status);
    const secondBatch = (second.body.data as { batchId: string }).batchId;
    expect(secondBatch).toBe(firstBatch);

    // Un seul lot et un seul set de vouchers côté DB.
    const batches = await prisma.voucherBatch.count({ where: { tenantId: t.tenantId, clientRequestId: key } });
    expect(batches).toBe(1);
    const vouchers = await prisma.voucher.count({ where: { batchId: firstBatch } });
    expect(vouchers).toBe(3);
  });

  it('same key with different payload → 409 and no new batch', async () => {
    const t = await setupTenant('mismatch');
    const key = randomUUID();
    await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 2 })
      .expect(200);

    const conflict = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planAltId, quantity: 2 })
      .expect(409);
    expect(conflict.body.error?.errorCode ?? conflict.body.errorCode).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    const batches = await prisma.voucherBatch.count({ where: { tenantId: t.tenantId, clientRequestId: key } });
    expect(batches).toBe(1);
  });

  it('same UUID across two tenants → two distinct batches', async () => {
    const [a, b] = [await setupTenant('ten-a'), await setupTenant('ten-b')];
    const key = randomUUID();
    const r1 = await request(app.getHttpServer())
      .post(`/api/routers/${a.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${a.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: a.planId, quantity: 1 })
      .expect(200);
    const r2 = await request(app.getHttpServer())
      .post(`/api/routers/${b.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${b.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: b.planId, quantity: 1 })
      .expect(200);
    expect((r1.body.data as any).batchId).not.toBe((r2.body.data as any).batchId);
  });

  it('invalid Idempotency-Key header → 400 and no batch created', async () => {
    const t = await setupTenant('invalid');
    const before = await prisma.voucherBatch.count({ where: { tenantId: t.tenantId } });
    const res = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ planId: t.planId, quantity: 1 })
      .expect(400);
    expect(res.body.error?.errorCode ?? res.body.errorCode).toBe('IDEMPOTENCY_KEY_INVALID');
    const after = await prisma.voucherBatch.count({ where: { tenantId: t.tenantId } });
    expect(after).toBe(before);
  });

  it('empty Idempotency-Key header is treated as absent (legacy path)', async () => {
    const t = await setupTenant('empty');
    const res = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', '   ')
      .send({ planId: t.planId, quantity: 1 })
      .expect(200);
    const batchId = (res.body.data as any).batchId;
    const row = await prisma.voucherBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(row.clientRequestId).toBeNull();
  });

  it('duplicated Idempotency-Key header (comma-joined) → 400', async () => {
    const t = await setupTenant('dup');
    const k1 = randomUUID();
    const k2 = randomUUID();
    const res = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', `${k1}, ${k2}`)
      .send({ planId: t.planId, quantity: 1 })
      .expect(400);
    expect(res.body.error?.errorCode ?? res.body.errorCode).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('two concurrent POSTs with the same key and payload → a single batch persists', async () => {
    const t = await setupTenant('conc');
    const key = randomUUID();
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/routers/${t.routerId}/vouchers/generate`)
        .set('Authorization', `Bearer ${t.token}`)
        .set('Idempotency-Key', key)
        .send({ planId: t.planId, quantity: 2 }),
      request(app.getHttpServer())
        .post(`/api/routers/${t.routerId}/vouchers/generate`)
        .set('Authorization', `Bearer ${t.token}`)
        .set('Idempotency-Key', key)
        .send({ planId: t.planId, quantity: 2 }),
    ]);
    for (const r of [r1, r2]) expect([200, 202]).toContain(r.status);
    const batches = await prisma.voucherBatch.findMany({ where: { tenantId: t.tenantId, clientRequestId: key } });
    expect(batches).toHaveLength(1);
    // Un seul set de vouchers créé (pas de doublon).
    const vouchers = await prisma.voucher.count({ where: { batchId: batches[0].id } });
    expect(vouchers).toBe(2);
    // Au moins une réponse réfère au batch gagnant.
    const ids = [r1, r2].map((r) => (r.body?.data as any)?.batchId).filter(Boolean);
    expect(ids).toContain(batches[0].id);
  });

  it('replay of a GENERATING batch → 202 + Retry-After', async () => {
    const t = await setupTenant('gen');
    const key = randomUUID();
    const first = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 1 })
      .expect(200);
    const batchId = (first.body.data as any).batchId;
    // Forcer GENERATING en DB (le chemin LAN laisse déjà le batch en
    // GENERATING jusqu'à confirmPush — mais on s'assure explicitement).
    await prisma.voucherBatch.update({
      where: { id: batchId },
      data: { status: VoucherBatchStatus.GENERATING, completedAt: null },
    });
    const replay = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 1 })
      .expect(202);
    expect(replay.headers['retry-after']).toBeDefined();
    expect(Number(replay.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('replay of a terminal LAN batch → same batchId, no new vouchers, push from PERSISTED snapshot (not current plan)', async () => {
    const t = await setupTenant('term');
    const key = randomUUID();
    const first = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 2 })
      .expect(200);
    const batchId = (first.body.data as any).batchId;
    // Forcer un état terminal LAN.
    await prisma.voucherBatch.update({
      where: { id: batchId },
      data: { status: VoucherBatchStatus.COMPLETED, generated: 2, completedAt: new Date() },
    });
    // Modifier le Plan APRÈS la génération : le replay ne doit PAS refléter
    // ces nouvelles valeurs.
    await prisma.plan.update({
      where: { id: t.planId },
      data: { durationMinutes: 9999, sharedUsers: 42 },
    });
    const beforeVouchers = await prisma.voucher.count({ where: { batchId } });

    const replay = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 2 })
      .expect(200);
    const replayBody = replay.body.data as { batchId: string; batchStatus: string; push?: Record<string, unknown>; pushedByServer: boolean };
    expect(replayBody.batchId).toBe(batchId);
    expect(replayBody.batchStatus).toBe('COMPLETED');
    expect(replayBody.pushedByServer).toBe(false);
    // Push params = snapshot persisté à la création (60m, 1 user), pas le Plan courant (9999m, 42).
    expect(replayBody.push).toBeDefined();
    expect(replayBody.push!.limitUptime).toBe('60m');
    expect(replayBody.push!.sharedUsers).toBe(1);
    const afterVouchers = await prisma.voucher.count({ where: { batchId } });
    expect(afterVouchers).toBe(beforeVouchers);
  });

  it('replay refusé (409) sur un batch LAN avec snapshot invalide (fail-closed)', async () => {
    const t = await setupTenant('corrupt');
    const key = randomUUID();
    const first = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 1 })
      .expect(200);
    const batchId = (first.body.data as any).batchId;
    // Corrompre le snapshot (clé interdite) et forcer COMPLETED.
    await prisma.voucherBatch.update({
      where: { id: batchId },
      data: {
        status: VoucherBatchStatus.COMPLETED,
        generated: 1,
        completedAt: new Date(),
        pushParamsSnapshot: { userProfile: 'p', limitUptime: '60m', comment: 'x', password: 'LEAK' } as any,
      },
    });
    const res = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 1 })
      .expect(409);
    expect(res.body.error?.errorCode ?? res.body.errorCode).toBe('VOUCHER_REPLAY_SNAPSHOT_MISSING');
  });

  it('replay refusé (409) sur un batch legacy (pushedByServer=null) même si la clé est fournie', async () => {
    const t = await setupTenant('legacy-origin');
    const key = randomUUID();
    const first = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 1 })
      .expect(200);
    const batchId = (first.body.data as any).batchId;
    // Simuler l'état legacy : pushedByServer=null (comme avant B-01).
    await prisma.voucherBatch.update({
      where: { id: batchId },
      data: {
        status: VoucherBatchStatus.COMPLETED,
        generated: 1,
        completedAt: new Date(),
        pushedByServer: null,
      },
    });
    const res = await request(app.getHttpServer())
      .post(`/api/routers/${t.routerId}/vouchers/generate`)
      .set('Authorization', `Bearer ${t.token}`)
      .set('Idempotency-Key', key)
      .send({ planId: t.planId, quantity: 1 })
      .expect(409);
    expect(res.body.error?.errorCode ?? res.body.errorCode).toBe('VOUCHER_REPLAY_SNAPSHOT_MISSING');
  });

  it('P2002 unrelated to the idempotency index is NOT masked (e.g. duplicated voucher code)', async () => {
    // Pré-insère un voucher avec un code connu puis force le générateur à le
    // produire : impossible à faire via HTTP de façon déterministe car les codes
    // sont aléatoires. On vérifie plutôt que l'index Voucher @@unique(tenantId,
    // code) est bien distinct de notre index d'idempotence, et que le service
    // ne masque pas ces collisions (couvert par le test unitaire dédié
    // "P2002 unrelated to the idempotency index is rethrown" dans le spec unit).
    const voucherIdx = (await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Voucher'`,
    ));
    const tenantIdCodeIdx = voucherIdx.filter(
      (i) => /\(["]?tenantId["]?,\s*["]?code["]?\)/i.test(i.indexdef),
    );
    expect(tenantIdCodeIdx.length).toBeGreaterThan(0);
    expect(tenantIdCodeIdx.map((i) => i.indexname)).not.toContain(IDEMPOTENCY_UNIQUE_INDEX_NAME);
  });
});
