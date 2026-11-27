import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCAL_PORTS,
  LOOPBACK_HOST,
  startForwarder,
  type CreateServer,
  type StreamBridge,
  type TcpServerLike,
} from './LocalForwarder.ts';
import {
  initialSessionState,
  reduce,
  type LocalEndpoint,
  type SessionState,
} from './tunnelSession.ts';

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
      return { port: last.port === 0 ? 50291 : last.port, host: last.host };
    },
  };

  return { create: () => server, listenCalls };
}

test('port Winbox canonique = 8291', () => {
  assert.equal(DEFAULT_LOCAL_PORTS.winbox, 8291);
});

test('Winbox : bind STRICTEMENT 127.0.0.1 (jamais 0.0.0.0)', async () => {
  const { create, listenCalls } = makeFakeServer({});
  const { result } = await startForwarder(create, 3, DEFAULT_LOCAL_PORTS.winbox, noopBridge);
  assert.equal(listenCalls.length, 1);
  assert.equal(listenCalls[0].host, LOOPBACK_HOST);
  assert.notEqual(listenCalls[0].host, '0.0.0.0');
  assert.equal(result.port, 8291);
});

test('Winbox : port occupé (EADDRINUSE) → repli éphémère, toujours 127.0.0.1', async () => {
  const { create, listenCalls } = makeFakeServer({ failFirstBindWith: 'EADDRINUSE' });
  const { result } = await startForwarder(create, 3, DEFAULT_LOCAL_PORTS.winbox, noopBridge);
  assert.equal(listenCalls.length, 2);
  assert.equal(listenCalls[0].port, 8291);
  assert.equal(listenCalls[1].port, 0);
  for (const call of listenCalls) assert.equal(call.host, LOOPBACK_HOST);
  assert.equal(result.port, 50291);
});

test('machine d états : endpoint Winbox intégré au state ready', () => {
  const winbox: LocalEndpoint = {
    serviceId: 3,
    name: 'winbox',
    host: '127.0.0.1',
    port: 8291,
    url: 'http://127.0.0.1:8291',
  };
  const s: SessionState = [
    { type: 'OPEN_REQUESTED' } as const,
    { type: 'GRANT_RECEIVED', expiresAtEpochMs: 1_000 } as const,
    { type: 'CONNECTING' } as const,
    { type: 'READY', expiresAtEpochMs: 2_000 } as const,
    { type: 'FORWARDER_BOUND', endpoint: winbox } as const,
  ].reduce(reduce, initialSessionState);

  assert.equal(s.phase, 'ready');
  const ep = s.endpoints.find((e) => e.name === 'winbox');
  assert.ok(ep);
  assert.equal(ep?.host, '127.0.0.1');
  assert.equal(ep?.port, 8291);
  assert.equal(ep?.serviceId, 3);
});
