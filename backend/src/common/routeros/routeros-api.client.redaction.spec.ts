import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import {
  RouterOsApiClient,
  RouterOsApiError,
  RouterOsAuthError,
  RouterOsUnreachableError,
} from './routeros-api.client';

const FAKE_USER = 'FAKE_ROUTER_USER';
const FAKE_SECRET = 'FAKE_ROUTER_SECRET_123';
const VOUCHER_SECRET = 'FAKE_VOUCHER_SECRET_456';

const enc = (w: string): Buffer => {
  const b = Buffer.from(w);
  return Buffer.concat([Buffer.from([b.length]), b]);
};
const sentence = (ws: string[]): Buffer =>
  Buffer.concat([...ws.map(enc), Buffer.from([0])]);

function readSentences(buf: Buffer): { sentences: string[][]; rest: Buffer } {
  const sentences: string[][] = [];
  let i = 0;
  let words: string[] = [];
  let start = 0;
  while (i < buf.length) {
    const len = buf[i];
    if (len === 0) {
      sentences.push(words);
      words = [];
      i += 1;
      start = i;
      continue;
    }
    if (i + 1 + len > buf.length) break;
    words.push(buf.subarray(i + 1, i + 1 + len).toString());
    i += 1 + len;
  }
  return { sentences, rest: buf.subarray(start) };
}

type Mode = 'auth-trap' | 'login-ok' | 'silent';

/** Faux RouterOS : login accepté ou rejeté (!trap), commandes en !trap, ou silence (timeout). */
function startFakeRouterOs(mode: Mode): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      let buf: Buffer = Buffer.alloc(0);
      socket.on('data', (d) => {
        const parsed = readSentences(Buffer.concat([buf, d]));
        buf = parsed.rest;
        for (const words of parsed.sentences) {
          if (mode === 'silent') continue;
          if (words[0] === '/login') {
            socket.write(
              mode === 'auth-trap'
                ? sentence(['!trap', '=message=invalid user name or password (6)'])
                : sentence(['!done']),
            );
            continue;
          }
          socket.write(
            sentence([
              '!trap',
              '=category=3',
              '=message=failure: already have user with this name',
            ]),
          );
        }
      });
      socket.on('error', () => undefined);
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port }),
    );
  });
}

function dump(e: unknown): string {
  const err = e as Error & { cause?: unknown };
  return JSON.stringify({
    name: err.name,
    message: err.message,
    stack: err.stack,
    cause: err.cause === undefined ? null : String(err.cause),
    own: Object.getOwnPropertyNames(err).map((k) => String((err as never)[k])),
  });
}

describe('RouterOsApiClient — aucun credential dans logs ni exceptions', () => {
  let server: Server | null = null;
  let logs: string[];
  let spies: jest.SpyInstance[];

  beforeEach(() => {
    logs = [];
    const capture = (...a: unknown[]) => {
      logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    };
    spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(capture),
    );
  });

  afterEach(async () => {
    spies.forEach((s) => s.mockRestore());
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  async function client(mode: Mode, timeoutMs = 2000) {
    const fake = await startFakeRouterOs(mode);
    server = fake.server;
    return new RouterOsApiClient({
      host: '127.0.0.1',
      port: fake.port,
      username: FAKE_USER,
      password: FAKE_SECRET,
      timeoutMs,
    });
  }

  const allOutput = (e?: unknown) => [...logs, e === undefined ? '' : dump(e)].join('\n');

  it('A/B — login !trap : ni mot de passe ni username ni =password= dans logs/exception', async () => {
    const c = await client('auth-trap');
    await c.connect();
    const err = await c.login().catch((e: unknown) => e);
    c.destroy();

    expect(err).toBeInstanceOf(RouterOsAuthError);
    const out = allOutput(err);
    expect(out).not.toContain(FAKE_SECRET);
    expect(out).not.toContain(FAKE_USER);
    expect(out).not.toContain('=password=');
  });

  it('C — !trap sur commande normale : diagnostic utile conservé, secret absent', async () => {
    const c = await client('login-ok');
    await c.connect();
    await c.login();
    const err = await c
      .command([
        '/ip/hotspot/user/add',
        '=name=abc',
        `=password=${VOUCHER_SECRET}`,
      ])
      .catch((e: unknown) => e);
    c.destroy();

    expect(err).toBeInstanceOf(RouterOsApiError);
    const out = allOutput(err);
    expect(out).toContain('/ip/hotspot/user/add');
    expect(out).toContain('already have user');
    expect(out).not.toContain(VOUCHER_SECRET);
    expect(out).not.toContain(FAKE_SECRET);
    expect(out).not.toContain('=password=');
  });

  it('D — timeout : erreur d\'injoignabilité sans secret', async () => {
    const c = await client('silent', 150);
    await c.connect();
    const err = await c.login().catch((e: unknown) => e);
    c.destroy();

    expect(err).toBeInstanceOf(RouterOsUnreachableError);
    expect((err as Error).message).toContain('timeout');
    const out = allOutput(err);
    expect(out).not.toContain(FAKE_SECRET);
    expect(out).not.toContain(FAKE_USER);
  });

  it('E — auth valide : login inchangé, rien de journalisé', async () => {
    const c = await client('login-ok');
    await c.connect();
    await expect(c.login()).resolves.toBeUndefined();
    c.destroy();
    expect(logs).toHaveLength(0);
  });
});
