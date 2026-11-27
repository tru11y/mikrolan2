import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Prisma,
  RemotePeer,
  RemotePeerStatus,
  RemoteTunnelCloseReason,
  RemoteTunnelSession,
  AccessMode,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/error-codes';
import { CloseCode } from './tunnel-protocol';

/** Ticket aléatoire 256 bits, usage unique, TTL 60 s. */
const TICKET_BYTES = 32;
export const TICKET_TTL_MS = 60_000;
/** Quota : nombre max de sessions tunnel simultanées par utilisateur. */
export const MAX_SESSIONS_PER_USER = 2;
/** Quota : nombre max de streams ouverts par session. */
export const MAX_STREAMS_PER_SESSION = 16;

export interface IssueTicketInput {
  tenantId: string;
  routerId: string;
  peerId: string;
  userId: string;
  sourceIp: string;
  expiresAt: Date;
}

export interface IssuedTicket {
  ticket: string;
  ticketExpiresInSec: number;
  session: RemoteTunnelSession;
}

export type ConsumeResult =
  | { ok: true; session: RemoteTunnelSession; peer: RemotePeer }
  | { ok: false; code: CloseCode };

function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Comparaison à temps constant de deux empreintes hex de même longueur. */
function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Émission/consommation du ticket d'accès tunnel et cycle de vie de la session
 * en base. La base fait foi (audit, révocation) ; le registre en mémoire pilote
 * les sockets vivantes. Jamais de ticket en clair stocké ni logué.
 */
@Injectable()
export class RemoteTunnelService {
  private readonly logger = new Logger(RemoteTunnelService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Émet un ticket pour une fenêtre d'accès TUNNEL. Révoque les sessions
   * tunnel ouvertes précédentes du peer (`REPLACED`) et applique le quota
   * par utilisateur. Appelé depuis open-access (contexte requête).
   */
  async issueTicket(input: IssueTicketInput): Promise<IssuedTicket> {
    const openForUser = await this.prisma.remoteTunnelSession.count({
      where: {
        userId: input.userId,
        closedAt: null,
        expiresAt: { gt: new Date() },
        // On ne compte pas celles du peer courant : elles vont être remplacées.
        NOT: { peerId: input.peerId },
      },
    });
    if (openForUser >= MAX_SESSIONS_PER_USER) {
      throw new BusinessException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.REMOTE_TUNNEL_LIMIT,
        `Limite de ${MAX_SESSIONS_PER_USER} sessions de tunnel simultanées atteinte. Fermez-en une avant d'en ouvrir une nouvelle.`,
      );
    }

    await this.revokeOpenSessions(input.peerId, RemoteTunnelCloseReason.REPLACED);

    const raw = randomBytes(TICKET_BYTES);
    const ticket = raw.toString('base64url');
    const ticketHash = sha256Hex(raw);

    const session = await this.prisma.remoteTunnelSession.create({
      data: {
        tenantId: input.tenantId,
        routerId: input.routerId,
        peerId: input.peerId,
        userId: input.userId,
        ticketHash,
        sourceIp: input.sourceIp,
        expiresAt: input.expiresAt,
      },
    });

    return {
      ticket,
      ticketExpiresInSec: Math.floor(TICKET_TTL_MS / 1000),
      session,
    };
  }

  /**
   * Valide un ticket présenté au HELLO et marque la session connectée (usage
   * unique). Retourne un code de fermeture WS en cas de rejet. Hors contexte
   * requête (appelé depuis le gateway) : les requêtes Prisma sont non scopées.
   */
  async consumeTicket(ticket: string, sourceIp: string): Promise<ConsumeResult> {
    let ticketHash: string;
    try {
      ticketHash = sha256Hex(Buffer.from(ticket, 'base64url'));
    } catch {
      return { ok: false, code: CloseCode.TICKET_INVALID };
    }

    const session = await this.prisma.remoteTunnelSession.findUnique({
      where: { ticketHash },
    });
    if (!session) return { ok: false, code: CloseCode.TICKET_INVALID };
    if (!constantTimeEqualHex(session.ticketHash, ticketHash)) {
      return { ok: false, code: CloseCode.TICKET_INVALID };
    }
    // Usage unique : déjà consommé ou déjà fermé.
    if (session.connectedAt !== null || session.closedAt !== null) {
      return { ok: false, code: CloseCode.TICKET_INVALID };
    }
    // TTL 60 s depuis l'émission.
    if (Date.now() - session.createdAt.getTime() > TICKET_TTL_MS) {
      return { ok: false, code: CloseCode.TICKET_INVALID };
    }
    // Fenêtre d'accès expirée.
    if (session.expiresAt.getTime() <= Date.now()) {
      return { ok: false, code: CloseCode.WINDOW_EXPIRED };
    }
    // Pin IP source (non usurpable : vérifié à l'établissement TCP+TLS).
    if (session.sourceIp !== sourceIp) {
      await this.close(session.id, RemoteTunnelCloseReason.IP_MISMATCH);
      return { ok: false, code: CloseCode.IP_MISMATCH };
    }

    const peer = await this.prisma.remotePeer.findUnique({
      where: { id: session.peerId },
    });
    if (
      !peer ||
      peer.status !== RemotePeerStatus.ACTIVE ||
      peer.accessMode !== AccessMode.TUNNEL ||
      peer.accessOpenUntil === null ||
      peer.accessOpenUntil.getTime() <= Date.now()
    ) {
      return { ok: false, code: CloseCode.WINDOW_EXPIRED };
    }

    // Marque consommé : la condition `connectedAt: null` en WHERE empêche un
    // double usage concurrent (count 0 = déjà pris → rejet).
    const claimed = await this.prisma.remoteTunnelSession.updateMany({
      where: { id: session.id, connectedAt: null, closedAt: null },
      data: { connectedAt: new Date() },
    });
    if (claimed.count === 0) return { ok: false, code: CloseCode.TICKET_INVALID };

    return { ok: true, session: { ...session, connectedAt: new Date() }, peer };
  }

  /** Clôture une session (idempotent : ne réécrit pas une session déjà fermée). */
  async close(
    sessionId: string,
    reason: RemoteTunnelCloseReason,
    totals?: { bytesUp: number; bytesDown: number; streamsOpened: number },
  ): Promise<void> {
    try {
      await this.prisma.remoteTunnelSession.updateMany({
        where: { id: sessionId, closedAt: null },
        data: {
          closedAt: new Date(),
          closeReason: reason,
          ...(totals
            ? {
                bytesUp: BigInt(totals.bytesUp),
                bytesDown: BigInt(totals.bytesDown),
                streamsOpened: totals.streamsOpened,
              }
            : {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to close tunnel session ${sessionId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Marque fermées les sessions ouvertes d'un peer (REPLACED/REVOKED/EXPIRED). */
  async revokeOpenSessions(
    peerId: string,
    reason: RemoteTunnelCloseReason,
  ): Promise<number> {
    const res = await this.prisma.remoteTunnelSession.updateMany({
      where: { peerId, closedAt: null },
      data: { closedAt: new Date(), closeReason: reason },
    });
    return res.count;
  }

  /** Expire en base les sessions dont la fenêtre est passée (appelé par le reconciler). */
  async closeExpiredSessions(): Promise<number> {
    const res = await this.prisma.remoteTunnelSession.updateMany({
      where: { closedAt: null, expiresAt: { lte: new Date() } },
      data: { closedAt: new Date(), closeReason: RemoteTunnelCloseReason.EXPIRED },
    });
    return res.count;
  }

  hashTicket(ticket: string): string {
    return sha256Hex(Buffer.from(ticket, 'base64url'));
  }

  static readonly auditMetadata = (
    session: RemoteTunnelSession,
  ): Prisma.InputJsonObject => ({ mode: 'TUNNEL', sessionId: session.id });
}
