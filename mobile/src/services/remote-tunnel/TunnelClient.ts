/**
 * Client WebSocket du tunnel distant (React Native, mode `arraybuffer`).
 *
 * Responsabilités :
 *  - ouvrir `wss://vpn.mikrolan.net/remote-tunnel`, envoyer HELLO{ticket} ;
 *  - router READY / OPEN_OK / OPEN_ERR / DATA / WINDOW / CLOSE / PING-PONG / GOAWAY ;
 *  - multiplexer des streams (streamId impair croissant côté client) ;
 *  - contrôle de flux par crédit (65536 o initiaux par sens et par stream).
 *
 * Aucune logique métier d'UI : l'orchestration (ouverture de fenêtre, forwarders)
 * vit dans `tunnelSession.ts`.
 */

import {
  decode,
  encode,
  INITIAL_CREDIT,
  MAX_DATA_PAYLOAD,
  type ServiceId,
  type TunnelMessage,
} from './tunnelProtocol';

/** Intervalle PING (spec : 25 s). */
const PING_INTERVAL_MS = 25_000;
/** Idle sans PONG avant coupure (spec : 90 s). */
const IDLE_TIMEOUT_MS = 90_000;

export type StreamHandlers = {
  /** Octets reçus du routeur distant, à écrire vers le socket local. */
  onData: (data: Uint8Array) => void;
  /** Le stream est fermé (CLOSE distant, OPEN_ERR, ou tunnel coupé). */
  onClose: (reason?: number) => void;
  /** Le stream est confirmé ouvert côté serveur (OPEN_OK). */
  onOpen: () => void;
};

type Stream = {
  id: number;
  handlers: StreamHandlers;
  /** Crédit restant pour émettre vers le serveur. */
  sendCredit: number;
  /** File d'attente d'octets bloqués par le crédit. */
  pending: Uint8Array[];
  opened: boolean;
};

export type TunnelClientEvents = {
  onReady: (expiresAtEpochMs: number) => void;
  onGoAway: (reason: number) => void;
  onClose: (code: number, reason: string) => void;
  onError: (error: Error) => void;
};

/** Sous-ensemble structurel de WebSocket (RN / DOM) utilisé ici — testable. */
export interface WebSocketLike {
  binaryType: string;
  send(data: ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const defaultFactory: WebSocketFactory = (url) => new WebSocket(url) as unknown as WebSocketLike;

export class TunnelClient {
  private ws: WebSocketLike | null = null;
  private readonly streams = new Map<number, Stream>();
  private nextStreamId = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly ticket: string,
    private readonly events: TunnelClientEvents,
    private readonly factory: WebSocketFactory = defaultFactory,
  ) {}

  connect(): void {
    const ws = this.factory(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.send({ type: 'HELLO', streamId: 0, ticket: this.ticket });
      this.startKeepAlive();
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onerror = () => this.events.onError(new Error('tunnel websocket error'));
    ws.onclose = (ev) => {
      this.cleanup();
      if (!this.closed) this.events.onClose(ev.code, ev.reason);
    };
  }

  /** Ouvre un stream pour un service et renvoie son identifiant. */
  openStream(serviceId: ServiceId, handlers: StreamHandlers): number {
    const id = this.nextStreamId;
    this.nextStreamId += 2; // impair croissant
    this.streams.set(id, {
      id,
      handlers,
      sendCredit: INITIAL_CREDIT,
      pending: [],
      opened: false,
    });
    this.send({ type: 'OPEN', streamId: id, serviceId });
    return id;
  }

  /** Relaie des octets d'un socket local vers le routeur distant (avec crédit). */
  sendData(streamId: number, data: Uint8Array): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    stream.pending.push(data);
    this.flush(stream);
  }

  closeStream(streamId: number): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    this.send({ type: 'CLOSE', streamId });
    this.streams.delete(streamId);
  }

  close(code = 1000, reason = 'client close'): void {
    this.closed = true;
    this.cleanup();
    this.ws?.close(code, reason);
  }

  private flush(stream: Stream): void {
    while (stream.pending.length > 0 && stream.sendCredit > 0) {
      const head = stream.pending[0];
      const take = Math.min(head.length, stream.sendCredit, MAX_DATA_PAYLOAD);
      const chunk = head.subarray(0, take);
      this.send({ type: 'DATA', streamId: stream.id, data: chunk });
      stream.sendCredit -= take;
      if (take === head.length) stream.pending.shift();
      else stream.pending[0] = head.subarray(take);
    }
  }

  private handleMessage(raw: unknown): void {
    let bytes: Uint8Array;
    if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
    else if (raw instanceof Uint8Array) bytes = raw;
    else return; // ignore les trames texte (le protocole est binaire)

    let msg: TunnelMessage;
    try {
      msg = decode(bytes);
    } catch (e) {
      this.events.onError(e instanceof Error ? e : new Error('decode error'));
      return;
    }
    this.touchIdle();
    this.dispatch(msg);
  }

  private dispatch(msg: TunnelMessage): void {
    switch (msg.type) {
      case 'READY':
        this.events.onReady(msg.expiresAtEpochMs);
        return;
      case 'OPEN_OK': {
        const s = this.streams.get(msg.streamId);
        if (s && !s.opened) {
          s.opened = true;
          s.handlers.onOpen();
        }
        return;
      }
      case 'OPEN_ERR': {
        const s = this.streams.get(msg.streamId);
        this.streams.delete(msg.streamId);
        s?.handlers.onClose(msg.code);
        return;
      }
      case 'DATA': {
        const s = this.streams.get(msg.streamId);
        if (!s) return;
        s.handlers.onData(msg.data);
        // On a drainé ces octets : rendre le crédit au serveur.
        this.send({ type: 'WINDOW', streamId: msg.streamId, credit: msg.data.length });
        return;
      }
      case 'WINDOW': {
        const s = this.streams.get(msg.streamId);
        if (!s) return;
        s.sendCredit += msg.credit;
        this.flush(s);
        return;
      }
      case 'CLOSE': {
        const s = this.streams.get(msg.streamId);
        this.streams.delete(msg.streamId);
        s?.handlers.onClose();
        return;
      }
      case 'PING':
        this.send({ type: 'PONG', streamId: 0 });
        return;
      case 'PONG':
        return; // touchIdle a déjà réarmé le timer
      case 'GOAWAY':
        this.events.onGoAway(msg.reason);
        this.close(1000, `goaway ${msg.reason}`);
        return;
      default:
        return;
    }
  }

  private send(msg: TunnelMessage): void {
    const ws = this.ws;
    if (!ws) return;
    const bytes = encode(msg);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    ws.send(buffer as ArrayBuffer);
  }

  private startKeepAlive(): void {
    this.touchIdle();
    this.pingTimer = setInterval(() => this.send({ type: 'PING', streamId: 0 }), PING_INTERVAL_MS);
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(4000, 'idle timeout'), IDLE_TIMEOUT_MS);
  }

  private cleanup(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.pingTimer = null;
    this.idleTimer = null;
    for (const s of this.streams.values()) s.handlers.onClose();
    this.streams.clear();
  }
}
