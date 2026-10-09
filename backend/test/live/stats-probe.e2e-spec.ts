/**
 * E2E Phase 1B : vraie application Nest + PostgreSQL isolé (testcontainers) + FAUX ROUTEROS (serveur TCP qui parle le
 * protocole API binaire) sur 127.0.0.1:8728. Le vrai `RemoteRouterService` / `RouterOsApiClient` / `SessionsService.syncRouter`
 * / `RouterGatewayService` / `RouterStatsProbe` sont exercés ; seule la porte d'abonnement PRO est forcée.
 *
 * Preuves : (1) le CA fonctionne à l'identique avec la sonde active ; (2) la sonde n'émet QUE `/login` +
 * `/system/resource/print` (jamais `/ip/hotspot/active/print`) ; (3) 1 lecture stats par fenêtre de 120 s ;
 * (4) 10 consommateurs du snapshot = 0 connexion supplémentaire.
 */
import * as net from 'node:net';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ManagementMode, RemotePeerStatus, VoucherStatus } from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import { signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { RouterGatewayService } from '../../src/modules/router-gateway/router-gateway.service';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';

// ── faux RouterOS (protocole API binaire) ───────────────────────────────────
function encWord(w: string): Buffer {
  const b = Buffer.from(w, 'utf8');
  const len = b.length;
  const head = len < 0x80 ? Buffer.from([len]) : Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  return Buffer.concat([head, b]);
}
const encSentence = (words: string[]): Buffer => Buffer.concat([...words.map(encWord), Buffer.from([0])]);

function tryParse(buf: Buffer): { words: string[]; used: number } | null {
  const words: string[] = [];
  let i = 0;
  for (;;) {
    if (i >= buf.length) return null;
    const first = buf[i];
    let len: number;
    if (first === 0) return { words, used: i + 1 };
    if (first < 0x80) {
      len = first;
      i += 1;
    } else {
      if (i + 1 >= buf.length) return null;
      len = ((first & 0x3f) << 8) | buf[i + 1];
      i += 2;
    }
    if (i + len > buf.length) return null;
    words.push(buf.subarray(i, i + len).toString('utf8'));
    i += len;
  }
}

function startFakeRouterOs(port: number) {
  const log: { conn: number; cmd: string }[] = [];
  let conns = 0;
  const server = net.createServer((sock) => {
    const id = ++conns;
    let buf = Buffer.alloc(0);
    const reply = (w: string[]) => sock.write(encSentence(w));
    sock.on('error', () => undefined);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const r = tryParse(buf);
        if (!r) break;
        buf = buf.subarray(r.used);
        const cmd = r.words[0] ?? '';
        log.push({ conn: id, cmd });
        if (cmd === '/login') reply(['!done']);
        else if (cmd === '/system/resource/print') {
          reply(['!re', '=cpu-load=29', '=total-memory=134217728', '=free-memory=50331648', '=uptime=12d', '=version=7.15', '=board-name=RB951']);
          reply(['!done']);
        } else if (cmd === '/ip/hotspot/active/print') {
          reply(['!re', '=.id=*1', '=user=E2ECODE', '=address=10.0.0.2', '=mac-address=AA:BB:CC:DD:EE:01', '=bytes-in=1', '=bytes-out=2', '=uptime=1m']);
          reply(['!done']);
        } else reply(['!trap', '=message=no such command']);
      }
    });
  });
  return {
    log,
    connections: () => conns,
    listen: () => new Promise<void>((res, rej) => server.once('error', rej).listen(port, '127.0.0.1', res)),
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}

describe('Phase 1B — sonde stats (E2E avec faux RouterOS)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let sessions: SessionsService;
  let gateway: RouterGatewayService;
  const fake = startFakeRouterOs(8728);
  let routerId: string;
  let tenantId: string;

  const count = (cmd: string) => fake.log.filter((l) => l.cmd === cmd).length;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(cond: () => boolean, ms: number) {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await sleep(100);
  }

  beforeAll(async () => {
    await fake.listen();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionsService);
    gateway = app.get(RouterGatewayService);
    // Les @Interval de l'application (ordonnanceur de synchro CA…) fausseraient le décompte des lectures : on pilote les cycles à la main.
    const registry = app.get(SchedulerRegistry);
    for (const name of registry.getIntervals()) clearInterval(registry.getInterval(name));
    jest.spyOn(app.get(SubscriptionsService), 'isRemoteAllowed').mockResolvedValue(true);

    const user = await signupUser(app, { tenantName: 'Stats Probe Tenant' });
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: user.email } });
    tenantId = dbUser.tenantId;
    const creds = app.get(CryptoService).encrypt(JSON.stringify({ username: 'admin', password: 'e2e-pass' }));
    const router = await prisma.router.create({
      data: { tenantId, identity: 'E2E_ROUTER', mode: ManagementMode.REMOTE, credEncrypted: creds },
    });
    routerId = router.id;
    await prisma.remotePeer.create({
      data: {
        routerId,
        tenantId,
        wgPublicKey: 'pk-e2e',
        wgIp: '127.0.0.1',
        allocatedPort: 59999,
        serverPublicKey: 'spk-e2e',
        endpoint: '127.0.0.1:51820',
        status: RemotePeerStatus.ACTIVE,
      },
    });
    const plan = await prisma.plan.create({
      data: { tenantId, routerId, name: '1h', slug: '1h-e2e', durationMinutes: 60, priceXof: 500 },
    });
    await prisma.voucher.create({
      data: { tenantId, routerId, planId: plan.id, code: 'E2ECODE', password: 'pw', status: VoucherStatus.GENERATED },
    });

    process.env['ROUTER_LIVE_SYNC_PUBLISH_ENABLED'] = 'true';
    process.env['ROUTER_LIVE_ROUTER_IDS'] = routerId;
    process.env['ROUTER_LIVE_STATS_PROBE_ENABLED'] = 'true';
    process.env['ROUTER_LIVE_STATS_ROUTER_IDS'] = routerId;
  }, 120_000);

  afterAll(async () => {
    for (const k of ['ROUTER_LIVE_SYNC_PUBLISH_ENABLED', 'ROUTER_LIVE_ROUTER_IDS', 'ROUTER_LIVE_STATS_PROBE_ENABLED', 'ROUTER_LIVE_STATS_ROUTER_IDS']) delete process.env[k];
    await app.close();
    await fake.close();
  });

  const syncOnce = () => (sessions as unknown as { syncRouter(r: { id: string; tenantId: string }): Promise<string> }).syncRouter({ id: routerId, tenantId });

  it('CA inchangé avec la sonde active ; la sonde ne lit QUE /system/resource (1 connexion, 1 login, 1 commande)', async () => {
    expect(await syncOnce()).toBe('ok');

    // CA : le ticket vu par la synchro est activé exactement comme avant (prix figé, Session créée)
    const voucher = await prisma.voucher.findFirstOrThrow({ where: { routerId, code: 'E2ECODE' } });
    expect(voucher.status).toBe(VoucherStatus.ACTIVE);
    expect(voucher.priceXofAtActivation).toBe(500);
    expect(await prisma.session.count({ where: { routerId } })).toBe(1);

    // La sonde part 4 s après la synchro
    await waitFor(() => count('/system/resource/print') >= 1, 9_000);
    expect(count('/system/resource/print')).toBe(1);
    expect(count('/ip/hotspot/active/print')).toBe(1); // la SEULE lecture des sessions = celle de la synchro CA

    const byConn = new Map<number, string[]>();
    for (const l of fake.log) byConn.set(l.conn, [...(byConn.get(l.conn) ?? []), l.cmd]);
    expect([...byConn.values()]).toEqual([
      ['/login', '/ip/hotspot/active/print'], // synchro CA (inchangée)
      ['/login', '/system/resource/print'], // sonde : 1 connexion, 1 login, 1 commande
    ]);

    const snap = gateway.peek(routerId);
    expect(snap?.sessionCount).toBe(1);
    expect(snap?.cpuPercent).toBe(29);
    expect(snap?.memoryTotalMb).toBe(128);
    expect(snap?.uptime).toBe('12d');
    expect(snap?.sessionsSource).toBe('SYNC_ACTIVATIONS');
    expect(gateway.kpis(routerId).statsProbeCount).toBe(1);
  }, 40_000);

  it('2ᵉ synchro dans la fenêtre de 120 s : aucune 2ᵉ sonde ; 10 consommateurs = 0 connexion supplémentaire', async () => {
    expect(await syncOnce()).toBe('ok');
    await sleep(6_000); // > délai de 4 s : une sonde aurait déjà dû partir si la cadence n'était pas respectée
    expect(count('/system/resource/print')).toBe(1);
    expect(count('/ip/hotspot/active/print')).toBe(2); // 2 synchros = 2 lectures, point

    const before = fake.connections();
    const results = await Promise.all(Array.from({ length: 10 }, () => gateway.getLiveSnapshot(routerId, 'both')));
    expect(results.every((r) => r.cpuPercent === 29 && r.sessionCount === 1)).toBe(true);
    expect(fake.connections()).toBe(before);
  }, 40_000);
});
