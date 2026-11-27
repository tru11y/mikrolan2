import { Injectable, Logger } from '@nestjs/common';
import { RemoteTunnelCloseReason } from '@prisma/client';

/**
 * Une connexion WS vivante, pilotable par le registre. Le gateway enregistre
 * un handle dont `close(reason)` ferme la socket (GOAWAY + ws.close) et persiste
 * la fermeture. Le registre ne connaît rien du protocole : il route par peer.
 */
export interface LiveTunnelConnection {
  readonly sessionId: string;
  readonly peerId: string;
  readonly tenantId: string;
  close(reason: RemoteTunnelCloseReason): void;
}

/**
 * Registre en mémoire du process des sessions tunnel vivantes. La base fait foi
 * pour l'audit ; ce registre ne sert qu'à agir sur les connexions ouvertes
 * (fermeture à la révocation/expiration). Au redémarrage il repart vide : les
 * sockets tombent et les clients rouvrent via un nouvel open-access.
 */
@Injectable()
export class TunnelSessionRegistry {
  private readonly logger = new Logger(TunnelSessionRegistry.name);
  private readonly bySession = new Map<string, LiveTunnelConnection>();

  register(conn: LiveTunnelConnection): void {
    this.bySession.set(conn.sessionId, conn);
  }

  unregister(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  /** Nombre de connexions vivantes pour un utilisateur donné (quota applicatif). */
  countByPredicate(predicate: (conn: LiveTunnelConnection) => boolean): number {
    let n = 0;
    for (const conn of this.bySession.values()) if (predicate(conn)) n += 1;
    return n;
  }

  /** Ferme toutes les connexions vivantes d'un peer. Utilisé à la révocation. */
  closeByPeer(
    peerId: string,
    reason: RemoteTunnelCloseReason = RemoteTunnelCloseReason.REVOKED,
  ): number {
    let closed = 0;
    for (const conn of [...this.bySession.values()]) {
      if (conn.peerId === peerId) {
        try {
          conn.close(reason);
        } catch (err) {
          this.logger.warn(
            `closeByPeer failed for session ${conn.sessionId}: ${err instanceof Error ? err.message : err}`,
          );
        }
        closed += 1;
      }
    }
    return closed;
  }

  closeAll(reason: RemoteTunnelCloseReason = RemoteTunnelCloseReason.ERROR): void {
    for (const conn of [...this.bySession.values()]) {
      try {
        conn.close(reason);
      } catch {
        /* best-effort shutdown */
      }
    }
    this.bySession.clear();
  }
}
