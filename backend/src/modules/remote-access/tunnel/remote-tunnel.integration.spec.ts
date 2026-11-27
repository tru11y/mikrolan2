import * as http from 'node:http';
import * as net from 'node:net';
import { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { AccessMode, RemotePeerStatus, RemoteTunnelCloseReason } from '@prisma/client';
import { RemoteTunnelGateway } from './remote-tunnel.gateway';
import { RemoteTunnelService } from './remote-tunnel.service';
import { TunnelSessionRegistry } from './tunnel-session.registry';
import {
  CloseCode,
  DecodedFrame,
  FrameType,
  decode,
  encodeClose,
  encodeData,
  encodeHello,
  encodeOpen,
  encodeWindow,
} from './tunnel-protocol';

// ─── Fake Prisma en mémoire (sessions + un peer configurable) ──────────────
function makeFakePrisma(peer: Record<string, unknown>) {
  const sessions = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const match = (r: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'connectedAt' || k === 'closedAt') return r[k] === v;
      if (k === 'NOT') return !match(r, v as Record<string, unknown>);
      if (v && typeof v === 'object' && 'gt' in v) return (r[k] as Date).getTime() > (v as { gt: Date }).gt.getTime();
      if (v && typeof v === 'object' && 'lte' in v) return (r[k] as Date).getTime() <= (v as { lte: Date }).lte.getTime();
      return r[k] === v;
    });
  return {
    __sessions: sessions,
    remoteTunnelSession: {
      count: jest.fn(async ({ where }: any) => [...sessions.values()].filter((r) => match(r, where)).length),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `s${seq++}`, connectedAt: null, closedAt: null, closeReason: null, createdAt: new Date(), ...data };
        sessions.set(row.id, row);
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const r = [...sessions.values()].find((s) => s.ticketHash === where.ticketHash);
        return r ? { ...r } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of sessions.values()) if (match(r, where)) { Object.assign(r, data); count++; }
        return { count };
      }),
    },
    remotePeer: {
      findUnique: jest.fn(async ({ where }: any) => (where.id === peer.id ? { ...peer } : null)),
    },
  };
}

class TestClient {
  private readonly queue: DecodedFrame[] = [];
  private waiter: ((f: DecodedFrame) => void) | null = null;
  closeCode: number | null = null;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (data: Buffer) => {
      const f = decode(data);
      if (this.waiter) { const w = this.waiter; this.waiter = null; w(f); }
      else this.queue.push(f);
    });
    ws.on('close', (code) => { this.closeCode = code; });
  }
  next(timeoutMs = 2000): Promise<DecodedFrame> {
    const q = this.queue.shift();
    if (q) return Promise.resolve(q);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('frame timeout')), timeoutMs);
      this.waiter = (f) => { clearTimeout(t); resolve(f); };
    });
  }
  send(buf: Buffer): void { this.ws.send(buf, { binary: true }); }
  async waitClose(timeoutMs = 2000): Promise<number> {
    if (this.closeCode !== null) return this.closeCode;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('close timeout')), timeoutMs);
      this.ws.once('close', (code) => { clearTimeout(t); resolve(code); });
    });
  }
}

describe('Remote tunnel — integration (real HTTP + ws + TCP echo)', () => {
  let server: http.Server;
  let echo: net.Server;
  let gateway: RemoteTunnelGateway;
  let service: RemoteTunnelService;
  let registry: TunnelSessionRegistry;
  let prisma: ReturnType<typeof makeFakePrisma>;
  let peer: Record<string, unknown>;
  let baseUrl: string;
  let echoPort: number;

  beforeEach(async () => {
    echo = net.createServer((sock) => sock.pipe(sock));
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
    echoPort = (echo.address() as AddressInfo).port;

    peer = {
      id: 'peer-1',
      status: RemotePeerStatus.ACTIVE,
      accessMode: AccessMode.TUNNEL,
      accessOpenUntil: new Date(Date.now() + 60_000),
      wgIp: '127.0.0.1',
      webfigPort: echoPort,
      sshPort: echoPort,
      winboxPort: echoPort,
    };
    prisma = makeFakePrisma(peer);
    service = new RemoteTunnelService(prisma as never);
    registry = new TunnelSessionRegistry();
    const eventLog = { success: jest.fn().mockResolvedValue(undefined) };
    gateway = new RemoteTunnelGateway(service, registry, eventLog as never);

    server = http.createServer();
    gateway.attach(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/remote-tunnel`;
  });

  afterEach(async () => {
    gateway.detach();
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => echo.close(() => r()));
  });

  async function issue(expiresAt = new Date(Date.now() + 60_000)): Promise<string> {
    const { ticket } = await service.issueTicket({
      tenantId: 't1', routerId: 'r1', peerId: 'peer-1', userId: 'u1',
      sourceIp: '127.0.0.1', expiresAt,
    });
    return ticket;
  }

  function connect(headers?: Record<string, string>): Promise<TestClient> {
    const ws = new WebSocket(baseUrl, { headers });
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(new TestClient(ws)));
      ws.once('error', reject);
    });
  }

  it('HELLO→READY then OPEN→OPEN_OK and echoes DATA round-trip', async () => {
    const ticket = await issue();
    const c = await connect();
    c.send(encodeHello(ticket));
    const ready = await c.next();
    expect(ready.type).toBe(FrameType.READY);

    c.send(encodeOpen(1, 1));
    const ok = await c.next();
    expect(ok.type).toBe(FrameType.OPEN_OK);

    c.send(encodeData(1, Buffer.from('hello-router')));
    // Draine jusqu'à recevoir le DATA d'écho (peut être précédé d'un WINDOW).
    let got: DecodedFrame | null = null;
    for (let i = 0; i < 5 && !got; i++) {
      const f = await c.next();
      if (f.type === FrameType.DATA) got = f;
    }
    expect(got && got.type === FrameType.DATA && got.data.toString()).toBe('hello-router');
    c.ws.close();
  });

  it('supports multiple concurrent streams', async () => {
    const ticket = await issue();
    const c = await connect();
    c.send(encodeHello(ticket));
    await c.next();
    for (const sid of [1, 3]) {
      c.send(encodeOpen(sid, 2));
      const ok = await c.next();
      expect(ok.type).toBe(FrameType.OPEN_OK);
    }
    c.send(encodeData(1, Buffer.from('A')));
    c.send(encodeData(3, Buffer.from('B')));
    const seen = new Map<number, string>();
    for (let i = 0; i < 8 && seen.size < 2; i++) {
      const f = await c.next();
      if (f.type === FrameType.DATA) seen.set(f.streamId, f.data.toString());
    }
    expect(seen.get(1)).toBe('A');
    expect(seen.get(3)).toBe('B');
    c.ws.close();
  });

  it('transfers a large payload intact under credit flow-control (no loss)', async () => {
    const ticket = await issue();
    const c = await connect();
    c.send(encodeHello(ticket));
    await c.next();
    c.send(encodeOpen(1, 1));
    await c.next();

    const total = 2 * 1024 * 1024; // 2 Mio
    const chunk = Buffer.alloc(16384, 0x61);
    let sent = 0;
    // Émetteur : respecte le crédit en renvoyant du WINDOW au fil de la réception.
    let received = 0;
    c.ws.on('message', (data: Buffer) => {
      const f = decode(data);
      if (f.type === FrameType.DATA) {
        received += f.data.length;
        c.send(encodeWindow(1, f.data.length)); // réapprovisionne le serveur
      }
    });
    // Le client envoie 2 Mio ; il doit aussi recevoir le crédit (WINDOW) du serveur.
    // On envoie par rafales bornées et on laisse l'écho revenir.
    while (sent < total) {
      c.send(encodeData(1, chunk));
      sent += chunk.length;
      if (sent % (256 * 1024) === 0) await new Promise((r) => setTimeout(r, 5));
    }
    const deadline = Date.now() + 8000;
    while (received < total && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(received).toBe(total);
    c.ws.close();
  }, 15000);

  it('rejects a replayed ticket with close code 4401', async () => {
    const ticket = await issue();
    const c1 = await connect();
    c1.send(encodeHello(ticket));
    await c1.next(); // READY

    const c2 = await connect();
    c2.send(encodeHello(ticket));
    const code = await c2.waitClose();
    expect(code).toBe(CloseCode.TICKET_INVALID);
    c1.ws.close();
  });

  it('rejects an upgrade carrying an Origin header (CSWSH)', async () => {
    await expect(connect({ Origin: 'https://evil.example' })).rejects.toBeDefined();
  });

  it('returns OPEN_ERR for an invalid serviceId', async () => {
    const ticket = await issue();
    const c = await connect();
    c.send(encodeHello(ticket));
    await c.next();
    c.send(encodeOpen(1, 9));
    const err = await c.next();
    expect(err.type).toBe(FrameType.OPEN_ERR);
    c.ws.close();
  });

  it('refuses the 17th stream (quota) with OPEN_ERR 4429', async () => {
    const ticket = await issue();
    const c = await connect();
    c.send(encodeHello(ticket));
    await c.next();
    // Ouvre 16 streams espacés (>100 ms) pour ne pas déclencher le throttle 10/s.
    for (let i = 0; i < 16; i++) {
      c.send(encodeOpen(2 * i + 1, 1));
      const r = await c.next();
      expect(r.type).toBe(FrameType.OPEN_OK);
      await new Promise((res) => setTimeout(res, 120));
    }
    c.send(encodeOpen(999, 1));
    const err = await c.next();
    expect(err.type).toBe(FrameType.OPEN_ERR);
    if (err.type === FrameType.OPEN_ERR) expect(err.code).toBe(CloseCode.QUOTA);
    c.ws.close();
  }, 15000);

  it('close-access (registry.closeByPeer) sends GOAWAY and closes with 4409/REPLACED', async () => {
    const ticket = await issue();
    const c = await connect();
    c.send(encodeHello(ticket));
    await c.next(); // READY
    registry.closeByPeer('peer-1', RemoteTunnelCloseReason.REPLACED);
    const code = await c.waitClose();
    expect(code).toBe(CloseCode.REPLACED);
  });

  it('cuts the session when the access window (expiresAt) elapses', async () => {
    const ticket = await issue(new Date(Date.now() + 400));
    const c = await connect();
    c.send(encodeHello(ticket));
    await c.next(); // READY
    const code = await c.waitClose(3000);
    expect(code).toBe(CloseCode.WINDOW_EXPIRED);
  });

  it('closing a stream from the client tears down its router socket', async () => {
    const ticket = await issue();
    const c = await connect();
    c.send(encodeHello(ticket));
    await c.next();
    c.send(encodeOpen(1, 1));
    await c.next();
    c.send(encodeClose(1));
    // Pas d'assertion de frame : on vérifie juste l'absence de crash (echo socket fermée).
    await new Promise((r) => setTimeout(r, 50));
    c.ws.close();
  });
});
