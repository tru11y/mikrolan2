/**
 * Codec pur du protocole fil « remote-tunnel » (WSS 443).
 *
 * Transport : messages WebSocket binaires, entiers big-endian.
 * En-tête commun : uint8 type + uint32 streamId, puis payload selon le type.
 *
 * Aucune dépendance React Native : testable en isolation (node:test).
 * La spec normative et les vecteurs figés sont dans `__fixtures__/wire-vectors.json`.
 */

export const TUNNEL_SERVICE = {
  webfig: 1,
  ssh: 2,
  winbox: 3,
} as const;

export type ServiceId = (typeof TUNNEL_SERVICE)[keyof typeof TUNNEL_SERVICE];

export const MSG_TYPE = {
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

/** Taille max d'un payload DATA (découper au-delà). */
export const MAX_DATA_PAYLOAD = 16384;
/** Taille max du ticket (UTF-8). */
export const MAX_TICKET_BYTES = 512;
/** Crédit initial de contrôle de flux, par sens et par stream. */
export const INITIAL_CREDIT = 65536;

export type TunnelMessage =
  | { type: 'HELLO'; streamId: 0; ticket: string }
  | { type: 'READY'; streamId: 0; expiresAtEpochMs: number }
  | { type: 'OPEN'; streamId: number; serviceId: ServiceId }
  | { type: 'OPEN_OK'; streamId: number }
  | { type: 'OPEN_ERR'; streamId: number; code: number }
  | { type: 'DATA'; streamId: number; data: Uint8Array }
  | { type: 'WINDOW'; streamId: number; credit: number }
  | { type: 'CLOSE'; streamId: number }
  | { type: 'PING'; streamId: 0 }
  | { type: 'PONG'; streamId: 0 }
  | { type: 'GOAWAY'; streamId: 0; reason: number };

export class TunnelProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TunnelProtocolError';
  }
}

const HEADER_SIZE = 5;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assertUint16(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new TunnelProtocolError(`${label} doit tenir sur uint16 (0..65535), reçu ${value}`);
  }
}

function assertUint32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TunnelProtocolError(`${label} doit tenir sur uint32, reçu ${value}`);
  }
}

function writeHeader(view: DataView, type: number, streamId: number): void {
  assertUint32(streamId, 'streamId');
  view.setUint8(0, type);
  view.setUint32(1, streamId, false);
}

export function encode(msg: TunnelMessage): Uint8Array {
  switch (msg.type) {
    case 'HELLO': {
      const ticketBytes = encoder.encode(msg.ticket);
      if (ticketBytes.length > MAX_TICKET_BYTES) {
        throw new TunnelProtocolError(
          `ticket trop long : ${ticketBytes.length} o (max ${MAX_TICKET_BYTES})`,
        );
      }
      const out = new Uint8Array(HEADER_SIZE + 2 + ticketBytes.length);
      const view = new DataView(out.buffer);
      writeHeader(view, MSG_TYPE.HELLO, 0);
      view.setUint16(HEADER_SIZE, ticketBytes.length, false);
      out.set(ticketBytes, HEADER_SIZE + 2);
      return out;
    }
    case 'READY': {
      const out = new Uint8Array(HEADER_SIZE + 8);
      const view = new DataView(out.buffer);
      writeHeader(view, MSG_TYPE.READY, 0);
      writeUint64(view, HEADER_SIZE, msg.expiresAtEpochMs);
      return out;
    }
    case 'OPEN': {
      const out = new Uint8Array(HEADER_SIZE + 1);
      const view = new DataView(out.buffer);
      writeHeader(view, MSG_TYPE.OPEN, msg.streamId);
      view.setUint8(HEADER_SIZE, msg.serviceId);
      return out;
    }
    case 'OPEN_OK': {
      const out = new Uint8Array(HEADER_SIZE);
      writeHeader(new DataView(out.buffer), MSG_TYPE.OPEN_OK, msg.streamId);
      return out;
    }
    case 'OPEN_ERR': {
      assertUint16(msg.code, 'code');
      const out = new Uint8Array(HEADER_SIZE + 2);
      const view = new DataView(out.buffer);
      writeHeader(view, MSG_TYPE.OPEN_ERR, msg.streamId);
      view.setUint16(HEADER_SIZE, msg.code, false);
      return out;
    }
    case 'DATA': {
      if (msg.data.length > MAX_DATA_PAYLOAD) {
        throw new TunnelProtocolError(
          `payload DATA trop grand : ${msg.data.length} o (max ${MAX_DATA_PAYLOAD})`,
        );
      }
      const out = new Uint8Array(HEADER_SIZE + msg.data.length);
      writeHeader(new DataView(out.buffer), MSG_TYPE.DATA, msg.streamId);
      out.set(msg.data, HEADER_SIZE);
      return out;
    }
    case 'WINDOW': {
      assertUint32(msg.credit, 'credit');
      const out = new Uint8Array(HEADER_SIZE + 4);
      const view = new DataView(out.buffer);
      writeHeader(view, MSG_TYPE.WINDOW, msg.streamId);
      view.setUint32(HEADER_SIZE, msg.credit, false);
      return out;
    }
    case 'CLOSE': {
      const out = new Uint8Array(HEADER_SIZE);
      writeHeader(new DataView(out.buffer), MSG_TYPE.CLOSE, msg.streamId);
      return out;
    }
    case 'PING': {
      const out = new Uint8Array(HEADER_SIZE);
      writeHeader(new DataView(out.buffer), MSG_TYPE.PING, 0);
      return out;
    }
    case 'PONG': {
      const out = new Uint8Array(HEADER_SIZE);
      writeHeader(new DataView(out.buffer), MSG_TYPE.PONG, 0);
      return out;
    }
    case 'GOAWAY': {
      assertUint16(msg.reason, 'reason');
      const out = new Uint8Array(HEADER_SIZE + 2);
      const view = new DataView(out.buffer);
      writeHeader(view, MSG_TYPE.GOAWAY, 0);
      view.setUint16(HEADER_SIZE, msg.reason, false);
      return out;
    }
  }
}

export function decode(bytes: Uint8Array): TunnelMessage {
  if (bytes.length < HEADER_SIZE) {
    throw new TunnelProtocolError(`trame tronquée : ${bytes.length} o < en-tête ${HEADER_SIZE} o`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint8(0);
  const streamId = view.getUint32(1, false);
  const payloadLen = bytes.length - HEADER_SIZE;

  switch (type) {
    case MSG_TYPE.HELLO: {
      requireStreamZero(streamId, 'HELLO');
      if (payloadLen < 2) throw new TunnelProtocolError('HELLO tronqué (ticketLen manquant)');
      const ticketLen = view.getUint16(HEADER_SIZE, false);
      if (payloadLen < 2 + ticketLen) throw new TunnelProtocolError('HELLO tronqué (ticket incomplet)');
      const ticket = decoder.decode(bytes.subarray(HEADER_SIZE + 2, HEADER_SIZE + 2 + ticketLen));
      return { type: 'HELLO', streamId: 0, ticket };
    }
    case MSG_TYPE.READY: {
      requireStreamZero(streamId, 'READY');
      if (payloadLen < 8) throw new TunnelProtocolError('READY tronqué');
      return { type: 'READY', streamId: 0, expiresAtEpochMs: readUint64(view, HEADER_SIZE) };
    }
    case MSG_TYPE.OPEN: {
      if (payloadLen < 1) throw new TunnelProtocolError('OPEN tronqué (serviceId manquant)');
      const serviceId = view.getUint8(HEADER_SIZE);
      if (serviceId !== 1 && serviceId !== 2 && serviceId !== 3) {
        throw new TunnelProtocolError(`serviceId inconnu : ${serviceId}`);
      }
      return { type: 'OPEN', streamId, serviceId };
    }
    case MSG_TYPE.OPEN_OK:
      return { type: 'OPEN_OK', streamId };
    case MSG_TYPE.OPEN_ERR: {
      if (payloadLen < 2) throw new TunnelProtocolError('OPEN_ERR tronqué');
      return { type: 'OPEN_ERR', streamId, code: view.getUint16(HEADER_SIZE, false) };
    }
    case MSG_TYPE.DATA: {
      if (payloadLen > MAX_DATA_PAYLOAD) {
        throw new TunnelProtocolError(`DATA trop grand : ${payloadLen} o (max ${MAX_DATA_PAYLOAD})`);
      }
      return { type: 'DATA', streamId, data: bytes.slice(HEADER_SIZE) };
    }
    case MSG_TYPE.WINDOW: {
      if (payloadLen < 4) throw new TunnelProtocolError('WINDOW tronqué');
      return { type: 'WINDOW', streamId, credit: view.getUint32(HEADER_SIZE, false) };
    }
    case MSG_TYPE.CLOSE:
      return { type: 'CLOSE', streamId };
    case MSG_TYPE.PING:
      requireStreamZero(streamId, 'PING');
      return { type: 'PING', streamId: 0 };
    case MSG_TYPE.PONG:
      requireStreamZero(streamId, 'PONG');
      return { type: 'PONG', streamId: 0 };
    case MSG_TYPE.GOAWAY: {
      requireStreamZero(streamId, 'GOAWAY');
      if (payloadLen < 2) throw new TunnelProtocolError('GOAWAY tronqué');
      return { type: 'GOAWAY', streamId: 0, reason: view.getUint16(HEADER_SIZE, false) };
    }
    default:
      throw new TunnelProtocolError(`type de message inconnu : 0x${type.toString(16)}`);
  }
}

function requireStreamZero(streamId: number, label: string): void {
  if (streamId !== 0) {
    throw new TunnelProtocolError(`${label} doit avoir streamId=0, reçu ${streamId}`);
  }
}

/**
 * uint64 big-endian sans BigInt dans le chemin chaud : les timestamps epoch-ms
 * tiennent largement sous 2^53 (Number.MAX_SAFE_INTEGER).
 */
function writeUint64(view: DataView, offset: number, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new TunnelProtocolError(`valeur uint64 hors domaine sûr : ${value}`);
  }
  const high = Math.floor(value / 0x1_0000_0000);
  const low = value % 0x1_0000_0000;
  view.setUint32(offset, high, false);
  view.setUint32(offset + 4, low, false);
}

function readUint64(view: DataView, offset: number): number {
  const high = view.getUint32(offset, false);
  const low = view.getUint32(offset + 4, false);
  return high * 0x1_0000_0000 + low;
}

/** Hex minuscule sans séparateur (utilitaire de test / debug). */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new TunnelProtocolError('hex de longueur impaire');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
