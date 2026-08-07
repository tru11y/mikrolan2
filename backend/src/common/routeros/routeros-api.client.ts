import { Socket } from 'node:net';

/**
 * RouterOS binary API (TCP 8728) client for the backend — the server-side twin
 * of the mobile `MikroTikApiClient`. Speaks the length-prefixed sentence
 * protocol and v7 plaintext login (RouterOS >= 6.43). No REST/`www` service is
 * required on the router; the API service (8728) is enabled by default, which is
 * how MikroTicket drives routers too.
 */

export interface RouterOsParams {
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutMs?: number;
}

export type ApiRow = Record<string, string>;

export class RouterOsAuthError extends Error {
  constructor(message = 'Identifiants RouterOS incorrects') {
    super(message);
    this.name = 'RouterOsAuthError';
  }
}
export class RouterOsUnreachableError extends Error {
  constructor(message = 'Routeur injoignable') {
    super(message);
    this.name = 'RouterOsUnreachableError';
  }
}
export class RouterOsApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouterOsApiError';
  }
}

// ── length-prefixed word encoding ───────────────────────────
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
    const word = this.buf.subarray(header, header + len).toString('utf8');
    this.buf = this.buf.subarray(header + len);
    return word;
  }
}

/** Builds RouterOS `=key=value` attribute words, skipping undefined values. */
export function attrs(
  data: Record<string, string | number | undefined>,
): string[] {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `=${k}=${v}`);
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

export class RouterOsApiClient {
  private socket: Socket | null = null;
  private parser = new SentenceParser();
  private pending:
    | {
        resolve: (rows: ApiRow[]) => void;
        reject: (e: Error) => void;
        rows: ApiRow[];
        words: string[];
      }
    | null = null;
  private readonly timeout: number;

  constructor(private readonly params: RouterOsParams) {
    this.timeout = params.timeoutMs ?? 8000;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new Socket();
      this.socket = socket;
      socket.setTimeout(this.timeout);

      const fail = (e: Error) => {
        if (!settled) {
          settled = true;
          this.destroy();
          reject(new RouterOsUnreachableError(e.message));
        }
        this.failPending(new RouterOsUnreachableError(e.message));
      };

      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        socket.setTimeout(0);
        resolve();
      });
      socket.on('data', (d: Buffer) => {
        this.onSentences(this.parser.push(d));
      });
      socket.on('error', fail);
      socket.once('timeout', () =>
        fail(new Error('Routeur injoignable (timeout)')),
      );
      socket.on('close', () => {
        this.failPending(new RouterOsUnreachableError('Connexion fermée'));
      });

      socket.connect({ host: this.params.host, port: this.params.port });
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
        // Diagnostic: full sentence + full trap words, so a future RouterOS
        // rejection is readable straight from `docker logs` instead of
        // guessing from just row.message (see mikrolan2 TTL anti-tether bug).
        console.error(
          '[RouterOsApiClient] trap',
          JSON.stringify({ sent: p.words, trap: words }),
        );
        this.pending = null;
        p.reject(new RouterOsApiError(row.message ?? 'Erreur RouterOS'));
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
      const socket = this.socket;
      if (!socket) {
        reject(new RouterOsUnreachableError('Non connecté'));
        return;
      }
      const timer = setTimeout(() => {
        this.failPending(
          new RouterOsUnreachableError('Routeur injoignable (timeout)'),
        );
      }, this.timeout);
      this.pending = {
        rows: [],
        words,
        resolve: (rows) => {
          clearTimeout(timer);
          resolve(rows);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      socket.write(encodeSentence(words));
    });
  }

  async login(): Promise<void> {
    const rows = await this.talk([
      '/login',
      `=name=${this.params.username}`,
      `=password=${this.params.password}`,
    ]).catch((e) => {
      if (e instanceof RouterOsApiError) throw new RouterOsAuthError();
      throw e;
    });
    // Legacy (<6.43) challenge login is unsupported — product targets v7.
    if (rows.some((r) => 'ret' in r)) {
      throw new RouterOsApiError('RouterOS trop ancien (login par défi non supporté)');
    }
  }

  /** Runs a full RouterOS command word list (e.g. `['/system/resource/print']`). */
  command(words: string[]): Promise<ApiRow[]> {
    return this.talk(words);
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
export async function withRouterOsApi<T>(
  params: RouterOsParams,
  fn: (c: RouterOsApiClient) => Promise<T>,
): Promise<T> {
  const client = new RouterOsApiClient(params);
  try {
    await client.connect();
    await client.login();
    return await fn(client);
  } finally {
    client.destroy();
  }
}
