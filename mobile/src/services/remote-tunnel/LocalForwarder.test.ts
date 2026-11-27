import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOPBACK_HOST,
  startForwarder,
  type CreateServer,
  type StreamBridge,
  type TcpServerLike,
  type TcpSocketLike,
} from './LocalForwarder.ts';

const noopBridge: StreamBridge = {
  open: () => ({ sendData: () => {}, close: () => {} }),
};

type FakeOptions = { failFirstBindWith?: string };

/** Serveur TCP factice : enregistre chaque bind, simule EADDRINUSE au besoin. */
function makeFakeServer(opts: FakeOptions): {
  create: CreateServer;
  listenCalls: { port: number; host: string }[];
} {
  const listenCalls: { port: number; host: string }[] = [];
  let errorListener: ((err: { code?: string } & Error) => void) | null = null;
  let firstBind = true;

  const server: TcpServerLike = {
    listen(options, callback) {
      listenCalls.push(options);
      if (firstBind && opts.failFirstBindWith) {
        firstBind = false;
        const err = Object.assign(new Error('bind failed'), { code: opts.failFirstBindWith });
        queueMicrotask(() => errorListener?.(err));
        return;
      }
      firstBind = false;
      queueMicrotask(() => callback?.());
    },
    on(_event, listener) {
      errorListener = listener;
    },
    close() {},
    address() {
      const last = listenCalls[listenCalls.length - 1];
      // L'OS attribue un port concret pour un bind éphémère (port 0).
      return { port: last.port === 0 ? 49231 : last.port, host: last.host };
    },
  };

  return { create: () => server, listenCalls };
}

test('bind STRICTEMENT 127.0.0.1 (jamais 0.0.0.0)', async () => {
  const { create, listenCalls } = makeFakeServer({});
  const { result } = await startForwarder(create, 1, 8080, noopBridge);
  assert.equal(listenCalls.length, 1);
  assert.equal(listenCalls[0].host, LOOPBACK_HOST);
  assert.notEqual(listenCalls[0].host, '0.0.0.0');
  assert.equal(result.port, 8080);
  assert.equal(result.url, 'http://127.0.0.1:8080');
});

test('port occupé (EADDRINUSE) → repli sur un port éphémère, toujours sur 127.0.0.1', async () => {
  const { create, listenCalls } = makeFakeServer({ failFirstBindWith: 'EADDRINUSE' });
  const { result } = await startForwarder(create, 2, 2222, noopBridge);
  assert.equal(listenCalls.length, 2);
  assert.equal(listenCalls[0].port, 2222);
  assert.equal(listenCalls[1].port, 0); // repli éphémère
  for (const call of listenCalls) assert.equal(call.host, LOOPBACK_HOST);
  assert.equal(result.port, 49231);
});

test('une erreur non-EADDRINUSE est propagée (pas de repli silencieux)', async () => {
  const { create } = makeFakeServer({ failFirstBindWith: 'EACCES' });
  await assert.rejects(() => startForwarder(create, 1, 80, noopBridge), /bind failed/);
});

test('relais : données du socket local → stream, retour stream → socket.write', async () => {
  const written: Uint8Array[] = [];
  const sent: Uint8Array[] = [];
  let dataListener: ((d: Uint8Array | string) => void) | null = null;
  let toLocalCb: ((d: Uint8Array) => void) | null = null;

  const socket: TcpSocketLike = {
    on(event, listener) {
      if (event === 'data') dataListener = listener as (d: Uint8Array | string) => void;
    },
    write(d) {
      written.push(d);
    },
    destroy() {},
  };

  const bridge: StreamBridge = {
    open: (_serviceId, toLocal) => {
      toLocalCb = toLocal;
      return { sendData: (d) => sent.push(d), close: () => {} };
    },
  };

  let onConn: ((s: TcpSocketLike) => void) | null = null;
  const create: CreateServer = (onConnection) => {
    onConn = onConnection;
    return {
      listen: (_o, cb) => queueMicrotask(() => cb?.()),
      on: () => {},
      close: () => {},
      address: () => ({ port: 8080, host: LOOPBACK_HOST }),
    };
  };

  await startForwarder(create, 1, 8080, bridge);
  onConn?.(socket);
  dataListener?.(new Uint8Array([1, 2, 3]));
  toLocalCb?.(new Uint8Array([9, 9]));

  assert.deepEqual(Array.from(sent[0]), [1, 2, 3]);
  assert.deepEqual(Array.from(written[0]), [9, 9]);
});
