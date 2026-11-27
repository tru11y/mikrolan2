import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  decode,
  encode,
  fromHex,
  toHex,
  TunnelProtocolError,
  type TunnelMessage,
} from './tunnelProtocol.ts';

type Vector = {
  name: string;
  type: number;
  streamId: number;
  fields: Record<string, unknown>;
  hexBytes: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const vectors: Vector[] = JSON.parse(
  readFileSync(join(here, '__fixtures__', 'wire-vectors.json'), 'utf8'),
);

function messageFromVector(v: Vector): TunnelMessage {
  const f = v.fields;
  switch (v.type) {
    case 1:
      return { type: 'HELLO', streamId: 0, ticket: f.ticket as string };
    case 2:
      return { type: 'READY', streamId: 0, expiresAtEpochMs: f.expiresAtEpochMs as number };
    case 16:
      return { type: 'OPEN', streamId: v.streamId, serviceId: f.serviceId as 1 | 2 | 3 };
    case 17:
      return { type: 'OPEN_OK', streamId: v.streamId };
    case 18:
      return { type: 'OPEN_ERR', streamId: v.streamId, code: f.code as number };
    case 32:
      return { type: 'DATA', streamId: v.streamId, data: fromHex(f.bytesHex as string) };
    case 33:
      return { type: 'WINDOW', streamId: v.streamId, credit: f.credit as number };
    case 48:
      return { type: 'CLOSE', streamId: v.streamId };
    case 64:
      return { type: 'PING', streamId: 0 };
    case 65:
      return { type: 'PONG', streamId: 0 };
    case 80:
      return { type: 'GOAWAY', streamId: 0, reason: f.reason as number };
    default:
      throw new Error(`type de vecteur non géré : ${v.type}`);
  }
}

test('encode : chaque vecteur produit exactement les hexBytes figés', () => {
  for (const v of vectors) {
    assert.equal(toHex(encode(messageFromVector(v))), v.hexBytes, `encode ${v.name}`);
  }
});

test('decode : chaque vecteur se reparse dans le bon message', () => {
  for (const v of vectors) {
    const decoded = decode(fromHex(v.hexBytes));
    assert.equal(decoded.type !== undefined, true);
    assert.deepEqual(decoded, messageFromVector(v), `decode ${v.name}`);
  }
});

test('round-trip : decode(encode(m)) === m pour tous les vecteurs', () => {
  for (const v of vectors) {
    const m = messageFromVector(v);
    assert.deepEqual(decode(encode(m)), m, `round-trip ${v.name}`);
  }
});

test('decode rejette une trame tronquée (plus courte que l en-tête)', () => {
  assert.throws(() => decode(new Uint8Array([0x01, 0x00])), TunnelProtocolError);
});

test('decode rejette un type inconnu', () => {
  assert.throws(() => decode(fromHex('ff00000000')), TunnelProtocolError);
});

test('decode rejette un serviceId hors 1..3', () => {
  assert.throws(() => decode(fromHex('100000000109')), TunnelProtocolError);
});

test('encode rejette un payload DATA > 16384 o', () => {
  assert.throws(
    () => encode({ type: 'DATA', streamId: 1, data: new Uint8Array(16385) }),
    TunnelProtocolError,
  );
});

test('encode rejette un ticket > 512 o', () => {
  assert.throws(
    () => encode({ type: 'HELLO', streamId: 0, ticket: 'x'.repeat(513) }),
    TunnelProtocolError,
  );
});

test('uint64 READY round-trip sur une valeur epoch-ms réaliste', () => {
  const m: TunnelMessage = { type: 'READY', streamId: 0, expiresAtEpochMs: 1_900_123_456_789 };
  assert.deepEqual(decode(encode(m)), m);
});
