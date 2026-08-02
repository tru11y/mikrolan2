import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';

// RouterOS API binary protocol (8728) is unencrypted by design — no TLS
// variant available to a plain TCP socket without a custom cert on every
// router (RouterOS also exposes 8729/API-SSL, but that requires per-router
// cert provisioning we don't do today). Traffic stays LAN-local between the
// phone and the router it's managing, never crosses the internet, so the
// exposure is limited to someone already on that WiFi network. Accepted
// risk — revisit only if API-SSL provisioning becomes part of onboarding.
export interface ApiConnectionParams {
  host: string;
  port: number; // RouterOS API, default 8728 (plaintext)
  username: string;
  password: string;
  timeoutMs?: number;
}

export interface SystemResource {
  uptime: string;
  version: string;
  'cpu-load': string;
  'free-memory': string;
  'total-memory': string;
  'board-name': string;
  [key: string]: string;
}

export type ApiRow = Record<string, string>;

export class LanAuthFailedError extends Error {
  constructor(message = 'Identifiants RouterOS incorrects') {
    super(message);
    this.name = 'LanAuthFailedError';
  }
}
export class LanUnreachableError extends Error {
  constructor(message = 'Routeur injoignable') {
    super(message);
    this.name = 'LanUnreachableError';
  }
}
export class LanApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LanApiError';
  }
}

// ── RouterOS API length-prefixed word encoding ──────────────
function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) {
    const v = len | 0x8000;
    return Buffer.from([(v >> 8) & 0xff, v & 0xff]);
  }
  if (len < 0x200000) {
    const v = len | 0xc00000;
    return Buffer.from([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
  if (len < 0x10000000) {
    const v = len | 0xe0000000;
    return Buffer.from([
      (v >>> 24) & 0xff,
      (v >> 16) & 0xff,
      (v >> 8) & 0xff,
      v & 0xff,
    ]);
  }
  return Buffer.from([
    0xf0,
    (len >>> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
  ]);
}

function encodeSentence(words: string[]): Buffer {
  const parts = words.map((w) => {
    const b = Buffer.from(w, 'utf8');
    return Buffer.concat([encodeLength(b.length), b]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

// Incremental decoder: bytes → sentences (arrays of words).
class SentenceParser {
  private buf = Buffer.alloc(0);
  private words: string[] = [];

  push(chunk: Buffer): string[][] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: string[][] = [];
    for (;;) {
      const parsed = this.readWord();
      if (parsed === null) break;
      if (parsed === '') {
        out.push(this.words);
        this.words = [];
      } else {
        this.words.push(parsed);
      }
    }
    return out;
  }

  private readWord(): string | null {
    if (this.buf.length === 0) return null;
    const c = this.buf[0];
    let len: number;
    let header: number;
    if (c < 0x80) {
      len = c;
      header = 1;
    } else if (c < 0xc0) {
      if (this.buf.length < 2) return null;
      len = ((c & 0x3f) << 8) | this.buf[1];
      header = 2;
    } else if (c < 0xe0) {
      if (this.buf.length < 3) return null;
      len = ((c & 0x1f) << 16) | (this.buf[1] << 8) | this.buf[2];
      header = 3;
    } else if (c < 0xf0) {
      if (this.buf.length < 4) return null;
      len =
        ((c & 0x0f) << 24) |
        (this.buf[1] << 16) |
        (this.buf[2] << 8) |
        this.buf[3];
      header = 4;
    } else {
      if (this.buf.length < 5) return null;
      len =
        (this.buf[1] << 24) |
        (this.buf[2] << 16) |
        (this.buf[3] << 8) |
        this.buf[4];
      header = 5;
    }
    if (this.buf.length < header + len) return null;
    const word = this.buf.slice(header, header + len).toString('utf8');
    this.buf = this.buf.slice(header + len);
    return word;
  }
}

function toAttrs(data: Record<string, string>): string[] {
  return Object.entries(data).map(([k, v]) => `=${k}=${v}`);
}

function parseRow(words: string[]): ApiRow {
  const row: ApiRow = {};
  for (const w of words) {
    if (w.startsWith('=')) {
      const idx = w.indexOf('=', 1);
      if (idx > 0) row[w.slice(1, idx)] = w.slice(idx + 1);
    }
  }
  return row;
}

export class MikroTikApiClient {
  private socket: ReturnType<typeof TcpSocket.createConnection> | null = null;
  private parser = new SentenceParser();
  private queue: string[][] = [];
  private pending:
    | { resolve: (rows: ApiRow[]) => void; reject: (e: Error) => void; rows: ApiRow[] }
    | null = null;
  private readonly timeout: number;

  constructor(private readonly params: ApiConnectionParams) {
    this.timeout = params.timeoutMs ?? 8000;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.destroy();
          reject(new LanUnreachableError('Routeur injoignable (timeout)'));
        }
      }, this.timeout);

      const socket = TcpSocket.createConnection(
        // `interface: 'wifi'` pins this socket to the Wi-Fi network so the
        // router is reachable even when its Wi-Fi has no internet (Android would
        // otherwise use cellular). Per-socket → no process-wide bind races.
        { host: this.params.host, port: this.params.port, interface: 'wifi' },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        },
      );
      this.socket = socket;
      socket.on('data', (d: Buffer | string) => {
        const chunk = typeof d === 'string' ? Buffer.from(d, 'binary') : Buffer.from(d);
        this.onSentences(this.parser.push(chunk));
      });
      socket.on('error', (e: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new LanUnreachableError(`Routeur injoignable (${e.message})`));
        }
        this.failPending(new LanUnreachableError(e.message));
      });
      socket.on('close', () => {
        this.failPending(new LanUnreachableError('Connexion fermée'));
      });
    });
  }

  private onSentences(sentences: string[][]): void {
    for (const words of sentences) {
      const reply = words[0] ?? '';
      const p = this.pending;
      if (!p) continue;
      if (reply === '!re') {
        p.rows.push(parseRow(words.slice(1)));
      } else if (reply === '!done') {
        const doneRow = parseRow(words.slice(1));
        if (Object.keys(doneRow).length) p.rows.push(doneRow);
        this.pending = null;
        p.resolve(p.rows);
      } else if (reply === '!trap' || reply === '!fatal') {
        const row = parseRow(words.slice(1));
        this.pending = null;
        // Le texte protocole RouterOS (row.message) est technique et parfois en
        // anglais — pas une phrase pour un opérateur. Gardé en console pour le
        // diagnostic dev, jamais affiché tel quel côté client.
        if (row.message) console.warn('[RouterOS]', row.message);
        p.reject(new LanApiError('Le routeur a refusé cette action.'));
      }
    }
  }

  private failPending(e: Error): void {
    if (this.pending) {
      this.pending.reject(e);
      this.pending = null;
    }
  }

  private talk(words: string[]): Promise<ApiRow[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new LanUnreachableError('Non connecté'));
        return;
      }
      this.pending = { resolve, reject, rows: [] };
      const timer = setTimeout(() => {
        this.failPending(new LanUnreachableError('Routeur injoignable (timeout)'));
      }, this.timeout);
      const done = (fn: (v: ApiRow[]) => void) => (rows: ApiRow[]) => {
        clearTimeout(timer);
        fn(rows);
      };
      const wrapped = this.pending;
      wrapped.resolve = done(resolve);
      wrapped.reject = ((orig) => (e: Error) => {
        clearTimeout(timer);
        orig(e);
      })(reject);
      this.socket.write(encodeSentence(words) as unknown as Uint8Array);
    });
  }

  async login(): Promise<void> {
    const rows = await this.talk([
      '/login',
      `=name=${this.params.username}`,
      `=password=${this.params.password}`,
    ]).catch((e) => {
      if (e instanceof LanApiError) throw new LanAuthFailedError();
      throw e;
    });
    // Old (<6.43) challenge login is unsupported — product targets RouterOS v7.
    if (rows.some((r) => 'ret' in r)) {
      throw new LanApiError('RouterOS trop ancien (login par défi non supporté)');
    }
  }

  systemIdentity(): Promise<{ name: string }> {
    return this.talk(['/system/identity/print']).then((rows) => ({
      name: rows[0]?.name ?? '',
    }));
  }

  systemResource(): Promise<SystemResource> {
    return this.talk(['/system/resource/print']).then(
      (rows) => (rows[0] ?? {}) as SystemResource,
    );
  }

  reboot(): Promise<void> {
    return this.talk(['/system/reboot']).then(() => undefined);
  }

  print(path: string, extra: string[] = []): Promise<ApiRow[]> {
    return this.talk([`${path}/print`, ...extra]);
  }

  add(path: string, data: Record<string, string>): Promise<string> {
    return this.talk([`${path}/add`, ...toAttrs(data)]).then(
      (rows) => rows.find((r) => 'ret' in r)?.ret ?? '',
    );
  }

  set(path: string, id: string, data: Record<string, string>): Promise<void> {
    return this.talk([`${path}/set`, `=.id=${id}`, ...toAttrs(data)]).then(
      () => undefined,
    );
  }

  remove(path: string, id: string): Promise<void> {
    return this.talk([`${path}/remove`, `=.id=${id}`]).then(() => undefined);
  }

  destroy(): void {
    try {
      this.socket?.destroy();
    } catch {
      // ignore
    }
    this.socket = null;
  }
}

/** Opens, logs in, runs `fn`, always closes. */
export async function withApi<T>(
  params: ApiConnectionParams,
  fn: (c: MikroTikApiClient) => Promise<T>,
): Promise<T> {
  const client = new MikroTikApiClient(params);
  try {
    await client.connect();
    await client.login();
    return await fn(client);
  } finally {
    client.destroy();
  }
}
