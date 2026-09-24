import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { RouterOsApiClient } from './routeros-api.client';

// Faux RouterOS : répond dans l'ordre reçu, sans tag ; chaque commande => !re + !done.
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

describe('RouterOsApiClient — une commande à la fois par connexion', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((socket: Socket) => {
      let buf: Buffer = Buffer.alloc(0);
      socket.on('data', (d) => {
        const parsed = readSentences(Buffer.concat([buf, d]));
        buf = parsed.rest;
        for (const words of parsed.sentences) {
          const cmd = words[0];
          if (cmd === '/login') {
            socket.write(sentence(['!done']));
            continue;
          }
          setTimeout(() => {
            socket.write(sentence(['!re', `=name=${cmd}`]));
            socket.write(sentence(['!done']));
          }, 20);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const open = async (timeoutMs: number) => {
    const c = new RouterOsApiClient({
      host: '127.0.0.1',
      port,
      username: 'u',
      password: 'p',
      timeoutMs,
    });
    await c.connect();
    await c.login();
    return c;
  };

  it('commandes séquentielles : chacune reçoit sa propre réponse', async () => {
    const c = await open(2000);
    try {
      const a = await c.command(['/a']);
      const b = await c.command(['/b']);
      const d = await c.command(['/c']);
      expect([a[0]?.name, b[0]?.name, d[0]?.name]).toEqual(['/a', '/b', '/c']);
    } finally {
      c.destroy();
    }
  });

  it('limite connue : en parallèle sur une même connexion, une commande ne reçoit jamais sa réponse (cause du blocage de la télémétrie)', async () => {
    const c = await open(600);
    try {
      const settled = await Promise.race([
        Promise.all([c.command(['/a']), c.command(['/b']), c.command(['/c'])]).then(
          () => 'all-resolved',
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve('still-pending'), 1500)),
      ]);
      expect(settled).toBe('still-pending');
    } finally {
      c.destroy();
    }
  });
});
