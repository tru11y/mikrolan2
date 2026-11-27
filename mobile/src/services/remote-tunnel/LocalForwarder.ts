/**
 * Forwarder TCP local : expose un service du routeur distant sur un port
 * loopback de l'appareil, et relaie chaque connexion locale vers un stream
 * du tunnel.
 *
 * SÉCURITÉ : le listener est lié **strictement à 127.0.0.1**. Un bind sur
 * `0.0.0.0` exposerait le port à tout le réseau Wi-Fi = régression de sécurité.
 * Le défaut de `react-native-tcp-socket` est `0.0.0.0` → on passe toujours
 * `host: '127.0.0.1'` explicitement (vérifié par un test dédié).
 */

import type { ServiceId } from './tunnelProtocol';

/** Hôte de bind imposé, jamais paramétrable. */
export const LOOPBACK_HOST = '127.0.0.1';

/** Ports locaux par défaut (repli éphémère si occupé). */
export const DEFAULT_LOCAL_PORTS = {
  ssh: 2222,
  webfig: 8080,
} as const;

/** Sous-ensemble structurel d'un socket TCP client (react-native-tcp-socket). */
export interface TcpSocketLike {
  on(event: 'data', listener: (data: Uint8Array | string) => void): void;
  on(event: 'close' | 'error', listener: (arg?: unknown) => void): void;
  write(data: Uint8Array): void;
  destroy(): void;
}

/** Sous-ensemble structurel d'un serveur TCP. */
export interface TcpServerLike {
  listen(options: { port: number; host: string }, callback?: () => void): void;
  on(event: 'error', listener: (err: { code?: string } & Error) => void): void;
  close(callback?: () => void): void;
  address(): { port: number; host: string } | null;
}

export type CreateServer = (onConnection: (socket: TcpSocketLike) => void) => TcpServerLike;

/** Pont bidirectionnel entre un socket local et un stream du tunnel. */
export interface StreamBridge {
  /** Ouvre un stream pour ce service et branche le relais retour → socket local. */
  open(serviceId: ServiceId, toLocal: (data: Uint8Array) => void, onClose: () => void): {
    sendData: (data: Uint8Array) => void;
    close: () => void;
  };
}

export type ForwarderResult = {
  /** Port effectivement lié (peut différer du souhaité en cas de repli). */
  port: number;
  /** URL loopback exploitable par l'UI (pour WebFig). */
  url: string;
};

/**
 * Tente de lier `preferredPort` sur 127.0.0.1 ; en cas de port occupé
 * (`EADDRINUSE`), bascule sur un port éphémère (0) choisi par l'OS.
 */
export function startForwarder(
  createServer: CreateServer,
  serviceId: ServiceId,
  preferredPort: number,
  bridge: StreamBridge,
): Promise<{ server: TcpServerLike; result: ForwarderResult }> {
  return new Promise((resolve, reject) => {
    let triedEphemeral = false;

    const onConnection = (socket: TcpSocketLike): void => {
      const stream = bridge.open(
        serviceId,
        (data) => socket.write(data),
        () => socket.destroy(),
      );
      socket.on('data', (data) => {
        stream.sendData(typeof data === 'string' ? strToBytes(data) : data);
      });
      socket.on('close', () => stream.close());
      socket.on('error', () => stream.close());
    };

    const server = createServer(onConnection);

    const bind = (port: number): void => {
      server.listen({ port, host: LOOPBACK_HOST }, () => {
        const addr = server.address();
        const boundPort = addr?.port ?? port;
        resolve({
          server,
          result: { port: boundPort, url: `http://${LOOPBACK_HOST}:${boundPort}` },
        });
      });
    };

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && !triedEphemeral) {
        triedEphemeral = true;
        bind(0); // repli port éphémère
        return;
      }
      reject(err);
    });

    bind(preferredPort);
  });
}

function strToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
