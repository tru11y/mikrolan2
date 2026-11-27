import { Injectable, Logger } from '@nestjs/common';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import { isIP } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { AuditAction, RemotePeer, RemoteTunnelCloseReason } from '@prisma/client';
import { EventLogService } from '../../events/event-log.service';
import { clientIpv4 } from '../remote-access.controller';
import {
  CloseCode,
  FrameType,
  MAX_WS_PAYLOAD,
  ServiceId,
  TunnelProtocolError,
  decode,
  encodeGoaway,
  encodeOpenErr,
  encodeOpenOk,
  encodePing,
  encodePong,
  encodeReady,
} from './tunnel-protocol';
import {
  MAX_STREAMS_PER_SESSION,
  RemoteTunnelService,
} from './remote-tunnel.service';
import { TunnelSessionRegistry } from './tunnel-session.registry';
import { TunnelStream } from './tunnel-stream';

const TUNNEL_PATH = '/remote-tunnel';
const HELLO_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 25_000;
const IDLE_TIMEOUT_MS = 90_000;
const OPEN_RATE_WINDOW_MS = 1000;
const OPEN_RATE_MAX = 10;

/** Dernier saut de X-Forwarded-For, uniquement si la socket vient de loopback. */
export function deriveClientIpv4(
  socketRemoteAddress: string | undefined,
  xForwardedFor: string | string[] | undefined,
): string | null {
  const direct = socketRemoteAddress ? clientIpv4(socketRemoteAddress) : null;
  const isLoopback =
    socketRemoteAddress === '127.0.0.1' ||
    socketRemoteAddress === '::1' ||
    socketRemoteAddress === '::ffff:127.0.0.1';
  if (!isLoopback) {
    // Connexion directe (pas via le proxy loopback) : XFF non fiable, ignoré.
    return direct;
  }
  if (!xForwardedFor) return direct;
  const header = Array.isArray(xForwardedFor)
    ? xForwardedFor[xForwardedFor.length - 1]
    : xForwardedFor;
  const hops = header.split(',').map((h) => h.trim()).filter(Boolean);
  const last = hops[hops.length - 1];
  return last ? clientIpv4(last) : direct;
}

function serviceHostPort(
  serviceId: number,
  peer: RemotePeer,
): { host: string; port: number } | null {
  switch (serviceId) {
    case ServiceId.WEBFIG:
      return { host: peer.wgIp, port: peer.webfigPort };
    case ServiceId.SSH:
      return { host: peer.wgIp, port: peer.sshPort };
    case ServiceId.WINBOX:
      return { host: peer.wgIp, port: peer.winboxPort };
    default:
      return null;
  }
}

/**
 * Gateway WS du tunnel distant. Lib `ws` en `noServer`, accrochée à l'évènement
 * `upgrade` du serveur HTTP Fastify (filtre path `/remote-tunnel`). Auth par
 * ticket (HELLO), pas de JWT ni de query. Relaie net↔WS avec crédit/backpressure.
 */
@Injectable()
export class RemoteTunnelGateway {
  private readonly logger = new Logger(RemoteTunnelGateway.name);
  private wss: WebSocketServer | null = null;
  private upgradeHandler:
    | ((req: IncomingMessage, socket: Socket, head: Buffer) => void)
    | null = null;
  private attachedServer: HttpServer | null = null;

  constructor(
    private readonly tunnel: RemoteTunnelService,
    private readonly registry: TunnelSessionRegistry,
    private readonly eventLog: EventLogService,
  ) {}

  /** Accroche le gateway au serveur HTTP (appelé dans main.ts après listen). */
  attach(server: HttpServer): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_WS_PAYLOAD,
      perMessageDeflate: false,
    });

    this.upgradeHandler = (req, socket, head) => {
      let path = req.url ?? '';
      const q = path.indexOf('?');
      if (q !== -1) path = path.slice(0, q);
      if (path !== TUNNEL_PATH) return; // laisse les autres upgrades tranquilles

      // CSWSH : un navigateur injecte Origin ; un vrai client natif n'en met pas.
      if (req.headers.origin) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        void this.onConnection(ws, req);
      });
    };
    server.on('upgrade', this.upgradeHandler);
    this.attachedServer = server;
    this.logger.log(`Remote tunnel gateway attached on ${TUNNEL_PATH}`);
  }

  detach(): void {
    if (this.attachedServer && this.upgradeHandler) {
      this.attachedServer.off('upgrade', this.upgradeHandler);
    }
    this.registry.closeAll();
    this.wss?.close();
    this.wss = null;
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const sourceIp = deriveClientIpv4(
      req.socket.remoteAddress ?? undefined,
      req.headers['x-forwarded-for'],
    );

    const conn = new TunnelConnection(
      ws,
      sourceIp,
      this.tunnel,
      this.registry,
      this.eventLog,
      this.logger,
    );
    await conn.start();
  }
}

/** Une connexion WS = une session = un peer. Isolée pour contenir l'état. */
class TunnelConnection {
  private helloDone = false;
  private helloTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private windowTimer: NodeJS.Timeout | null = null;
  private peer: RemotePeer | null = null;
  private sessionId: string | null = null;
  private tenantId: string | null = null;
  private peerId: string | null = null;
  private userId: string | null = null;
  private readonly streams = new Map<number, TunnelStream>();
  private streamsOpened = 0;
  private bytesUp = 0;
  private bytesDown = 0;
  private openTimestamps: number[] = [];
  private finished = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly sourceIp: string | null,
    private readonly tunnel: RemoteTunnelService,
    private readonly registry: TunnelSessionRegistry,
    private readonly eventLog: EventLogService,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) return this.fail(CloseCode.TICKET_INVALID);
      void this.onMessage(data);
    });
    this.ws.on('close', () => this.cleanup(RemoteTunnelCloseReason.CLOSED_BY_USER));
    this.ws.on('error', () => this.cleanup(RemoteTunnelCloseReason.ERROR));
    this.ws.on('pong', () => this.resetIdle());

    this.helloTimer = setTimeout(
      () => this.fail(CloseCode.TICKET_INVALID),
      HELLO_TIMEOUT_MS,
    );
    this.helloTimer.unref?.();
  }

  private send(frame: Buffer): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(frame, { binary: true });
  }

  private async onMessage(data: Buffer): Promise<void> {
    let frame;
    try {
      frame = decode(data);
    } catch (err) {
      if (err instanceof TunnelProtocolError) return this.fail(CloseCode.TICKET_INVALID);
      throw err;
    }

    if (!this.helloDone) {
      if (frame.type !== FrameType.HELLO) return this.fail(CloseCode.TICKET_INVALID);
      return this.onHello(frame.ticket);
    }

    switch (frame.type) {
      case FrameType.OPEN:
        return this.onOpen(frame.streamId, frame.serviceId);
      case FrameType.DATA:
        this.bytesUp += frame.data.length;
        this.streams.get(frame.streamId)?.onData(frame.data);
        return;
      case FrameType.WINDOW:
        this.streams.get(frame.streamId)?.onWindow(frame.credit);
        return;
      case FrameType.CLOSE:
        this.streams.get(frame.streamId)?.onClose();
        return;
      case FrameType.PING:
        this.resetIdle();
        return this.send(encodePong());
      case FrameType.PONG:
        this.resetIdle();
        return;
      default:
        return; // trames serveur→client reçues à tort : ignorées
    }
  }

  private async onHello(ticket: string): Promise<void> {
    if (this.helloTimer) clearTimeout(this.helloTimer);
    if (this.sourceIp === null) return this.fail(CloseCode.IP_MISMATCH);

    const result = await this.tunnel.consumeTicket(ticket, this.sourceIp);
    if (!result.ok) return this.fail(result.code);

    this.helloDone = true;
    this.peer = result.peer;
    this.sessionId = result.session.id;
    this.tenantId = result.session.tenantId;
    this.peerId = result.session.peerId;
    this.userId = result.session.userId;

    this.registry.register({
      sessionId: this.sessionId,
      peerId: this.peerId,
      tenantId: this.tenantId,
      close: (reason) => this.goaway(reason),
    });

    this.send(encodeReady(result.session.expiresAt.getTime()));

    await this.eventLog.success(
      AuditAction.CONNECT,
      'RemoteTunnelSession',
      this.sessionId,
      { mode: 'TUNNEL', sourceIp: this.sourceIp, peerId: this.peerId },
      { tenantId: this.tenantId, userId: this.userId },
    );

    this.scheduleWindowTimer(result.session.expiresAt);
    this.startHeartbeat();
  }

  private onOpen(streamId: number, serviceId: number): void {
    if (!this.peer) return;
    if (this.streams.has(streamId)) return this.send(encodeOpenErr(streamId, CloseCode.TICKET_INVALID));

    // Quota de streams simultanés.
    if (this.streams.size >= MAX_STREAMS_PER_SESSION) {
      return this.send(encodeOpenErr(streamId, CloseCode.QUOTA));
    }
    // Débit d'ouverture : 10 OPEN/s.
    const now = Date.now();
    this.openTimestamps = this.openTimestamps.filter((t) => now - t < OPEN_RATE_WINDOW_MS);
    if (this.openTimestamps.length >= OPEN_RATE_MAX) {
      return this.send(encodeOpenErr(streamId, CloseCode.QUOTA));
    }
    this.openTimestamps.push(now);

    const target = serviceHostPort(serviceId, this.peer);
    if (!target) return this.send(encodeOpenErr(streamId, CloseCode.BACKEND_CONNECT_FAILED));

    const stream = new TunnelStream(
      streamId,
      (frame) => this.send(frame),
      () => this.ws.bufferedAmount,
      (s) => {
        this.bytesDown += s.bytesDown;
        this.streams.delete(s.streamId);
      },
    );
    this.streams.set(streamId, stream);
    this.streamsOpened += 1;

    stream
      .connect(target.host, target.port)
      .then(() => this.send(encodeOpenOk(streamId)))
      .catch(() => {
        this.streams.delete(streamId);
        stream.destroy();
        this.send(encodeOpenErr(streamId, CloseCode.BACKEND_CONNECT_FAILED));
      });
  }

  private startHeartbeat(): void {
    this.resetIdle();
    this.pingTimer = setInterval(() => this.send(encodePing()), PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  private resetIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.goaway(RemoteTunnelCloseReason.ERROR, CloseCode.WINDOW_EXPIRED),
      IDLE_TIMEOUT_MS,
    );
    this.idleTimer.unref?.();
  }

  private scheduleWindowTimer(expiresAt: Date): void {
    const ms = expiresAt.getTime() - Date.now();
    this.windowTimer = setTimeout(
      () => this.goaway(RemoteTunnelCloseReason.EXPIRED, CloseCode.WINDOW_EXPIRED),
      Math.max(0, ms),
    );
    this.windowTimer.unref?.();
  }

  /** Rejet avant/pendant HELLO : GOAWAY + close, pas de session persistée. */
  private fail(code: CloseCode): void {
    try {
      this.send(encodeGoaway(code));
    } catch {
      /* ignore */
    }
    this.ws.close(code);
    this.cleanup(RemoteTunnelCloseReason.ERROR);
  }

  /** Fermeture imposée d'une session établie (révocation/expiration/remplacement). */
  private goaway(reason: RemoteTunnelCloseReason, code?: CloseCode): void {
    const wsCode = code ?? this.reasonToCloseCode(reason);
    try {
      this.send(encodeGoaway(wsCode));
    } catch {
      /* ignore */
    }
    this.ws.close(wsCode);
    this.cleanup(reason);
  }

  private reasonToCloseCode(reason: RemoteTunnelCloseReason): CloseCode {
    switch (reason) {
      case RemoteTunnelCloseReason.REPLACED:
        return CloseCode.REPLACED;
      case RemoteTunnelCloseReason.REVOKED:
        return CloseCode.REVOKED;
      case RemoteTunnelCloseReason.IP_MISMATCH:
        return CloseCode.IP_MISMATCH;
      case RemoteTunnelCloseReason.EXPIRED:
        return CloseCode.WINDOW_EXPIRED;
      default:
        return CloseCode.WINDOW_EXPIRED;
    }
  }

  private cleanup(reason: RemoteTunnelCloseReason): void {
    if (this.finished) return;
    this.finished = true;
    if (this.helloTimer) clearTimeout(this.helloTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.windowTimer) clearTimeout(this.windowTimer);
    for (const stream of this.streams.values()) {
      this.bytesDown += stream.bytesDown;
      stream.destroy();
    }
    this.streams.clear();

    if (this.sessionId) {
      this.registry.unregister(this.sessionId);
      void this.tunnel.close(this.sessionId, reason, {
        bytesUp: this.bytesUp,
        bytesDown: this.bytesDown,
        streamsOpened: this.streamsOpened,
      });
      if (this.tenantId) {
        void this.eventLog.success(
          AuditAction.DISCONNECT,
          'RemoteTunnelSession',
          this.sessionId,
          {
            mode: 'TUNNEL',
            reason,
            bytesUp: this.bytesUp,
            bytesDown: this.bytesDown,
            streamsOpened: this.streamsOpened,
          },
          { tenantId: this.tenantId, userId: this.userId ?? undefined },
        );
      }
    }
    try {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
