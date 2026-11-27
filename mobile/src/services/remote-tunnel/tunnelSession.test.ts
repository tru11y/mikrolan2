import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialSessionState,
  isActive,
  minutesRemaining,
  reduce,
  type LocalEndpoint,
  type SessionState,
} from './tunnelSession.ts';

const webfig: LocalEndpoint = {
  serviceId: 1,
  name: 'webfig',
  host: '127.0.0.1',
  port: 8080,
  url: 'http://127.0.0.1:8080',
};
const ssh: LocalEndpoint = {
  serviceId: 2,
  name: 'ssh',
  host: '127.0.0.1',
  port: 2222,
  url: 'http://127.0.0.1:2222',
};

function run(events: Parameters<typeof reduce>[1][]): SessionState {
  return events.reduce(reduce, initialSessionState);
}

test('chemin nominal : idle → ready avec endpoints et expiration', () => {
  const s = run([
    { type: 'OPEN_REQUESTED' },
    { type: 'GRANT_RECEIVED', expiresAtEpochMs: 1_000 },
    { type: 'CONNECTING' },
    { type: 'READY', expiresAtEpochMs: 2_000 },
    { type: 'FORWARDER_BOUND', endpoint: webfig },
    { type: 'FORWARDER_BOUND', endpoint: ssh },
  ]);
  assert.equal(s.phase, 'ready');
  assert.equal(s.expiresAtEpochMs, 2_000);
  assert.equal(s.endpoints.length, 2);
});

test('FORWARDER_BOUND remplace l endpoint du même service (repli de port)', () => {
  const s = run([
    { type: 'OPEN_REQUESTED' },
    { type: 'GRANT_RECEIVED', expiresAtEpochMs: 1_000 },
    { type: 'CONNECTING' },
    { type: 'READY', expiresAtEpochMs: 2_000 },
    { type: 'FORWARDER_BOUND', endpoint: webfig },
    { type: 'FORWARDER_BOUND', endpoint: { ...webfig, port: 49152, url: 'http://127.0.0.1:49152' } },
  ]);
  assert.equal(s.endpoints.length, 1);
  assert.equal(s.endpoints[0].port, 49152);
});

test('échec de grant → error', () => {
  const s = run([{ type: 'OPEN_REQUESTED' }, { type: 'GRANT_FAILED', error: '429' }]);
  assert.equal(s.phase, 'error');
  assert.equal(s.error, '429');
});

test('erreur de connexion depuis connecting → error, endpoints vidés', () => {
  const s = run([
    { type: 'OPEN_REQUESTED' },
    { type: 'GRANT_RECEIVED', expiresAtEpochMs: 1_000 },
    { type: 'CONNECTING' },
    { type: 'CONNECTION_ERROR', error: 'ws' },
  ]);
  assert.equal(s.phase, 'error');
  assert.deepEqual(s.endpoints, []);
});

test('EXPIRED depuis ready est terminal et vide les endpoints', () => {
  const s = run([
    { type: 'OPEN_REQUESTED' },
    { type: 'GRANT_RECEIVED', expiresAtEpochMs: 1_000 },
    { type: 'CONNECTING' },
    { type: 'READY', expiresAtEpochMs: 2_000 },
    { type: 'FORWARDER_BOUND', endpoint: webfig },
    { type: 'EXPIRED' },
  ]);
  assert.equal(s.phase, 'expired');
  assert.deepEqual(s.endpoints, []);
});

test('un event hors phase ne casse pas l état (READY avant CONNECTING ignoré)', () => {
  const s = run([
    { type: 'OPEN_REQUESTED' },
    { type: 'GRANT_RECEIVED', expiresAtEpochMs: 1_000 },
    { type: 'READY', expiresAtEpochMs: 2_000 },
  ]);
  assert.equal(s.phase, 'granted');
});

test('CLOSE_REQUESTED puis CLOSED', () => {
  const s = run([
    { type: 'OPEN_REQUESTED' },
    { type: 'GRANT_RECEIVED', expiresAtEpochMs: 1_000 },
    { type: 'CONNECTING' },
    { type: 'READY', expiresAtEpochMs: 2_000 },
    { type: 'CLOSE_REQUESTED' },
    { type: 'CLOSED' },
  ]);
  assert.equal(s.phase, 'closed');
});

test('RESET ramène à idle, OPEN_REQUESTED relançable depuis un état terminal', () => {
  const afterError = run([{ type: 'OPEN_REQUESTED' }, { type: 'GRANT_FAILED', error: 'x' }]);
  const reopened = reduce(afterError, { type: 'OPEN_REQUESTED' });
  assert.equal(reopened.phase, 'requesting');
  assert.equal(reopened.error, null);
});

test('minutesRemaining : floor positif, null sans expiration', () => {
  assert.equal(minutesRemaining(initialSessionState), null);
  const s: SessionState = { ...initialSessionState, expiresAtEpochMs: 10 * 60_000 };
  assert.equal(minutesRemaining(s, 0), 10);
  assert.equal(minutesRemaining(s, 9.5 * 60_000), 0);
  assert.equal(minutesRemaining(s, 20 * 60_000), 0);
});

test('isActive couvre requesting..ready', () => {
  assert.equal(isActive('requesting'), true);
  assert.equal(isActive('ready'), true);
  assert.equal(isActive('closed'), false);
  assert.equal(isActive('error'), false);
});
