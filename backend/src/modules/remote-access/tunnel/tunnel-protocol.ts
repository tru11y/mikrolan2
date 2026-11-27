/**
 * Codec pur du protocole fil Remote Tunnel v1 (partagé backend ↔ mobile).
 *
 * Transport : messages WebSocket binaires (jamais texte). Entiers big-endian.
 * En-tête commun (5 o) : uint8 type + uint32 streamId. Payload selon le type.
 *
 * Ce module n'a AUCUNE dépendance runtime (ni ws, ni net, ni Nest) : c'est un
 * codec testable isolément dont les vecteurs figés (`__fixtures__/wire-vectors.json`)
 * sont partagés à l'identique avec le client mobile.
 */

export const FrameType = {
  HELLO: 0x01,
  READY: 0x02,
  OPEN: 0x10,
  OPEN_OK: 0x11,
  OPEN_ERR: 0x12,
  DATA: 0x20,
  WINDOW: 0x21,
  CLOSE: 0x30,
  PING: 0x40,
  PONG: 0x41,
  GOAWAY: 0x50,
} as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

/**
 * Codes de fermeture (WS close code + payload GOAWAY/OPEN_ERR). Partagés avec
 * le client mobile. `BACKEND_CONNECT_FAILED` n'est qu'un code OPEN_ERR.
 */
export const CloseCode = {
  TICKET_INVALID: 4401,
  IP_MISMATCH: 4403,
  WINDOW_EXPIRED: 4408,
  REPLACED: 4409,
  REVOKED: 4410,
  QUOTA: 4429,
  BACKEND_CONNECT_FAILED: 5000,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

/** Service exposé par OPEN{serviceId}. L'hôte/port est résolu côté serveur. */
export const ServiceId = {
  WEBFIG: 1,
  SSH: 2,
  WINBOX: 3,
} as const;
export type ServiceId = (typeof ServiceId)[keyof typeof ServiceId];

export const HEADER_LEN = 5;
/** Taille max d'un payload DATA ; au-delà, l'émetteur découpe. */
export const MAX_DATA = 16384;
/** Ticket UTF-8 ≤ 512 o (champ uint16). */
export const MAX_TICKET_BYTES = 512;
/** Crédit initial de contrôle de flux, par sens et par stream. */
export const INITIAL_CREDIT = 65536;
/** `maxPayload` WS négocié côté serveur. */
export const MAX_WS_PAYLOAD = 65536;

export type DecodedFrame =
  | { type: typeof FrameType.HELLO; streamId: number; ticket: string }
  | { type: typeof FrameType.READY; streamId: number; expiresAtEpochMs: number }
  | { type: typeof FrameType.OPEN; streamId: number; serviceId: number }
  | { type: typeof FrameType.OPEN_OK; streamId: number }
  | { type: typeof FrameType.OPEN_ERR; streamId: number; code: number }
  | { type: typeof FrameType.DATA; streamId: number; data: Buffer }
  | { type: typeof FrameType.WINDOW; streamId: number; credit: number }
  | { type: typeof FrameType.CLOSE; streamId: number }
  | { type: typeof FrameType.PING; streamId: number }
  | { type: typeof FrameType.PONG; streamId: number }
  | { type: typeof FrameType.GOAWAY; streamId: number; reason: number };

export class TunnelProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TunnelProtocolError';
  }
}

function header(type: number, streamId: number, payloadLen: number): Buffer {
  const buf = Buffer.allocUnsafe(HEADER_LEN + payloadLen);
  buf.writeUInt8(type, 0);
  buf.writeUInt32BE(streamId >>> 0, 1);
  return buf;
}

export function encodeHello(ticket: string): Buffer {
  const ticketBytes = Buffer.from(ticket, 'utf8');
  if (ticketBytes.length > MAX_TICKET_BYTES) {
    throw new TunnelProtocolError(`HELLO ticket too large (${ticketBytes.length} > ${MAX_TICKET_BYTES})`);
  }
  const buf = header(FrameType.HELLO, 0, 2 + ticketBytes.length);
  buf.writeUInt16BE(ticketBytes.length, HEADER_LEN);
  ticketBytes.copy(buf, HEADER_LEN + 2);
  return buf;
}

export function encodeReady(expiresAtEpochMs: number): Buffer {
  const buf = header(FrameType.READY, 0, 8);
  buf.writeBigUInt64BE(BigInt(expiresAtEpochMs), HEADER_LEN);
  return buf;
}

export function encodeOpen(streamId: number, serviceId: number): Buffer {
  const buf = header(FrameType.OPEN, streamId, 1);
  buf.writeUInt8(serviceId, HEADER_LEN);
  return buf;
}

export function encodeOpenOk(streamId: number): Buffer {
  return header(FrameType.OPEN_OK, streamId, 0);
}

export function encodeOpenErr(streamId: number, code: number): Buffer {
  const buf = header(FrameType.OPEN_ERR, streamId, 2);
  buf.writeUInt16BE(code, HEADER_LEN);
  return buf;
}

export function encodeData(streamId: number, data: Buffer): Buffer {
  if (data.length > MAX_DATA) {
    throw new TunnelProtocolError(`DATA payload too large (${data.length} > ${MAX_DATA})`);
  }
  const buf = header(FrameType.DATA, streamId, data.length);
  data.copy(buf, HEADER_LEN);
  return buf;
}

export function encodeWindow(streamId: number, credit: number): Buffer {
  const buf = header(FrameType.WINDOW, streamId, 4);
  buf.writeUInt32BE(credit >>> 0, HEADER_LEN);
  return buf;
}

export function encodeClose(streamId: number): Buffer {
  return header(FrameType.CLOSE, streamId, 0);
}

export function encodePing(): Buffer {
  return header(FrameType.PING, 0, 0);
}

export function encodePong(): Buffer {
  return header(FrameType.PONG, 0, 0);
}

export function encodeGoaway(reason: number): Buffer {
  const buf = header(FrameType.GOAWAY, 0, 2);
  buf.writeUInt16BE(reason, HEADER_LEN);
  return buf;
}

/** Normalise une entrée binaire (ws peut livrer Buffer/ArrayBuffer/Uint8Array). */
function toBuffer(input: Buffer | ArrayBuffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return Buffer.from(input);
}

export function decode(input: Buffer | ArrayBuffer | Uint8Array): DecodedFrame {
  const buf = toBuffer(input);
  if (buf.length < HEADER_LEN) {
    throw new TunnelProtocolError(`frame too short (${buf.length} < ${HEADER_LEN})`);
  }
  const type = buf.readUInt8(0);
  const streamId = buf.readUInt32BE(1);
  const payload = buf.subarray(HEADER_LEN);

  switch (type) {
    case FrameType.HELLO: {
      if (payload.length < 2) throw new TunnelProtocolError('HELLO truncated (missing ticketLen)');
      const ticketLen = payload.readUInt16BE(0);
      if (ticketLen > MAX_TICKET_BYTES) {
        throw new TunnelProtocolError(`HELLO ticket too large (${ticketLen} > ${MAX_TICKET_BYTES})`);
      }
      if (payload.length !== 2 + ticketLen) {
        throw new TunnelProtocolError(`HELLO length mismatch (expected ${2 + ticketLen}, got ${payload.length})`);
      }
      return { type: FrameType.HELLO, streamId, ticket: payload.subarray(2).toString('utf8') };
    }
    case FrameType.READY: {
      if (payload.length !== 8) throw new TunnelProtocolError('READY must carry 8 bytes');
      return { type: FrameType.READY, streamId, expiresAtEpochMs: Number(payload.readBigUInt64BE(0)) };
    }
    case FrameType.OPEN: {
      if (payload.length !== 1) throw new TunnelProtocolError('OPEN must carry 1 byte');
      return { type: FrameType.OPEN, streamId, serviceId: payload.readUInt8(0) };
    }
    case FrameType.OPEN_OK: {
      if (payload.length !== 0) throw new TunnelProtocolError('OPEN_OK carries no payload');
      return { type: FrameType.OPEN_OK, streamId };
    }
    case FrameType.OPEN_ERR: {
      if (payload.length !== 2) throw new TunnelProtocolError('OPEN_ERR must carry 2 bytes');
      return { type: FrameType.OPEN_ERR, streamId, code: payload.readUInt16BE(0) };
    }
    case FrameType.DATA: {
      if (payload.length > MAX_DATA) {
        throw new TunnelProtocolError(`DATA payload too large (${payload.length} > ${MAX_DATA})`);
      }
      return { type: FrameType.DATA, streamId, data: Buffer.from(payload) };
    }
    case FrameType.WINDOW: {
      if (payload.length !== 4) throw new TunnelProtocolError('WINDOW must carry 4 bytes');
      return { type: FrameType.WINDOW, streamId, credit: payload.readUInt32BE(0) };
    }
    case FrameType.CLOSE: {
      if (payload.length !== 0) throw new TunnelProtocolError('CLOSE carries no payload');
      return { type: FrameType.CLOSE, streamId };
    }
    case FrameType.PING: {
      if (payload.length !== 0) throw new TunnelProtocolError('PING carries no payload');
      return { type: FrameType.PING, streamId };
    }
    case FrameType.PONG: {
      if (payload.length !== 0) throw new TunnelProtocolError('PONG carries no payload');
      return { type: FrameType.PONG, streamId };
    }
    case FrameType.GOAWAY: {
      if (payload.length !== 2) throw new TunnelProtocolError('GOAWAY must carry 2 bytes');
      return { type: FrameType.GOAWAY, streamId, reason: payload.readUInt16BE(0) };
    }
    default:
      throw new TunnelProtocolError(`unknown frame type 0x${type.toString(16)}`);
  }
}
