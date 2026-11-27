import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FrameType,
  MAX_DATA,
  TunnelProtocolError,
  decode,
  encodeClose,
  encodeData,
  encodeGoaway,
  encodeHello,
  encodeOpen,
  encodeOpenErr,
  encodeOpenOk,
  encodePing,
  encodePong,
  encodeReady,
  encodeWindow,
} from './tunnel-protocol';

interface WireVector {
  name: string;
  type: number;
  streamId: number;
  fields: Record<string, unknown>;
  hexBytes: string;
}

const vectors: WireVector[] = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'wire-vectors.json'), 'utf8'),
) as WireVector[];

function encodeVector(v: WireVector): Buffer {
  switch (v.type) {
    case FrameType.HELLO:
      return encodeHello(v.fields.ticket as string);
    case FrameType.READY:
      return encodeReady(v.fields.expiresAtEpochMs as number);
    case FrameType.OPEN:
      return encodeOpen(v.streamId, v.fields.serviceId as number);
    case FrameType.OPEN_OK:
      return encodeOpenOk(v.streamId);
    case FrameType.OPEN_ERR:
      return encodeOpenErr(v.streamId, v.fields.code as number);
    case FrameType.DATA:
      return encodeData(v.streamId, Buffer.from(v.fields.bytesHex as string, 'hex'));
    case FrameType.WINDOW:
      return encodeWindow(v.streamId, v.fields.credit as number);
    case FrameType.CLOSE:
      return encodeClose(v.streamId);
    case FrameType.PING:
      return encodePing();
    case FrameType.PONG:
      return encodePong();
    case FrameType.GOAWAY:
      return encodeGoaway(v.fields.reason as number);
    default:
      throw new Error(`unhandled vector type ${v.type}`);
  }
}

describe('tunnel-protocol wire vectors', () => {
  it.each(vectors.map((v) => [v.name, v] as const))(
    'encodes %s to the frozen hexBytes',
    (_name, v) => {
      expect(encodeVector(v).toString('hex')).toBe(v.hexBytes);
    },
  );

  it.each(vectors.map((v) => [v.name, v] as const))(
    'round-trips %s (decode(encode) === fields)',
    (_name, v) => {
      const decoded = decode(Buffer.from(v.hexBytes, 'hex'));
      expect(decoded.type).toBe(v.type);
      expect(decoded.streamId).toBe(v.streamId);
      switch (decoded.type) {
        case FrameType.HELLO:
          expect(decoded.ticket).toBe(v.fields.ticket);
          break;
        case FrameType.READY:
          expect(decoded.expiresAtEpochMs).toBe(v.fields.expiresAtEpochMs);
          break;
        case FrameType.OPEN:
          expect(decoded.serviceId).toBe(v.fields.serviceId);
          break;
        case FrameType.OPEN_ERR:
          expect(decoded.code).toBe(v.fields.code);
          break;
        case FrameType.DATA:
          expect(decoded.data.toString('hex')).toBe(v.fields.bytesHex);
          break;
        case FrameType.WINDOW:
          expect(decoded.credit).toBe(v.fields.credit);
          break;
        case FrameType.GOAWAY:
          expect(decoded.reason).toBe(v.fields.reason);
          break;
        default:
          break;
      }
    },
  );
});

describe('tunnel-protocol decode guards', () => {
  it('rejects a frame shorter than the header', () => {
    expect(() => decode(Buffer.from('0100', 'hex'))).toThrow(TunnelProtocolError);
  });

  it('rejects an unknown frame type', () => {
    expect(() => decode(Buffer.from('ff00000000', 'hex'))).toThrow(/unknown frame type/);
  });

  it('rejects a HELLO whose declared ticketLen mismatches the body', () => {
    // streamId 0, ticketLen 5, body only "abc"
    expect(() => decode(Buffer.from('01000000000005616263', 'hex'))).toThrow(TunnelProtocolError);
  });

  it('rejects a DATA payload larger than MAX_DATA on decode', () => {
    const frame = Buffer.concat([
      Buffer.from('2000000001', 'hex'),
      Buffer.alloc(MAX_DATA + 1),
    ]);
    expect(() => decode(frame)).toThrow(/too large/);
  });

  it('rejects encoding a DATA payload larger than MAX_DATA', () => {
    expect(() => encodeData(1, Buffer.alloc(MAX_DATA + 1))).toThrow(/too large/);
  });

  it('rejects a READY with a wrong payload length', () => {
    expect(() => decode(Buffer.from('0200000000deadbeef', 'hex'))).toThrow(TunnelProtocolError);
  });

  it('round-trips a full-size DATA chunk', () => {
    const payload = Buffer.alloc(MAX_DATA, 0x7f);
    const decoded = decode(encodeData(3, payload));
    expect(decoded.type).toBe(FrameType.DATA);
    if (decoded.type === FrameType.DATA) expect(decoded.data.equals(payload)).toBe(true);
  });
});
