/**
 * Orchestrateur runtime : câble la machine d'états (`tunnelSession`), le
 * `TunnelClient` (WSS) et les `LocalForwarder` (TCP loopback) avec les vraies
 * dépendances React Native. Thin : aucune logique de protocole ici.
 *
 * `react-native-tcp-socket` est importé paresseusement pour ne pas casser les
 * tests Node (la machine d'états et les codecs restent testables en isolation).
 */

import { api, type RemoteTunnelGrant } from '@/src/lib/api';
import {
  DEFAULT_LOCAL_PORTS,
  startForwarder,
  type CreateServer,
  type StreamBridge,
  type TcpServerLike,
} from './LocalForwarder';
import { TunnelClient } from './TunnelClient';
import {
  initialSessionState,
  reduce,
  type LocalEndpoint,
  type SessionEvent,
  type SessionState,
} from './tunnelSession';
import type { ServiceId } from './tunnelProtocol';

const TUNNEL_URL = 'wss://vpn.mikrolan.net/remote-tunnel';

export type RuntimeListener = (state: SessionState) => void;

type NativeTcp = { createServer: (onConnection: (socket: unknown) => void) => unknown };

/** Charge react-native-tcp-socket uniquement en runtime app (pas en test). */
function loadCreateServer(): CreateServer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TcpSocket = require('react-native-tcp-socket') as { default?: NativeTcp } & NativeTcp;
  const mod = TcpSocket.default ?? TcpSocket;
  return (onConnection) => mod.createServer(onConnection as (s: unknown) => void) as TcpServerLike;
}

export class TunnelRuntime {
  private state: SessionState = initialSessionState;
  private client: TunnelClient | null = null;
  private servers: TcpServerLike[] = [];
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly routerId: string,
    private readonly listener: RuntimeListener,
    private readonly createServer: CreateServer = loadCreateServer(),
  ) {}

  getState(): SessionState {
    return this.state;
  }

  private dispatch(event: SessionEvent): void {
    this.state = reduce(this.state, event);
    this.listener(this.state);
  }

  async open(durationMinutes: number): Promise<void> {
    this.dispatch({ type: 'OPEN_REQUESTED' });
    let grant: RemoteTunnelGrant;
    try {
      const res = await api.routers.openAccess(this.routerId, durationMinutes, 'TUNNEL');
      if (!res.tunnel) throw new Error('réponse sans ticket tunnel');
      grant = res.tunnel;
      this.dispatch({ type: 'GRANT_RECEIVED', expiresAtEpochMs: Date.parse(res.expiresAt) });
    } catch (e) {
      this.dispatch({ type: 'GRANT_FAILED', error: errMsg(e) });
      return;
    }
    this.connect(grant);
  }

  private connect(grant: RemoteTunnelGrant): void {
    this.dispatch({ type: 'CONNECTING' });
    const client = new TunnelClient(grant.url || TUNNEL_URL, grant.ticket, {
      onReady: (expiresAtEpochMs) => {
        this.dispatch({ type: 'READY', expiresAtEpochMs });
        this.armExpiry(expiresAtEpochMs);
        void this.bindForwarders();
      },
      onGoAway: () => this.dispatch({ type: 'EXPIRED' }),
      onClose: () => this.dispatch({ type: 'CLOSED' }),
      onError: (error) => this.dispatch({ type: 'CONNECTION_ERROR', error: error.message }),
    });
    this.client = client;
    client.connect();
  }

  private bridge(): StreamBridge {
    return {
      open: (serviceId, toLocal, onClose) => {
        const client = this.client;
        if (!client) return { sendData: () => {}, close: () => {} };
        const streamId = client.openStream(serviceId, {
          onData: toLocal,
          onOpen: () => {},
          onClose: () => onClose(),
        });
        return {
          sendData: (data) => client.sendData(streamId, data),
          close: () => client.closeStream(streamId),
        };
      },
    };
  }

  private async bindForwarders(): Promise<void> {
    const bridge = this.bridge();
    const plan: { serviceId: ServiceId; name: LocalEndpoint['name']; port: number }[] = [
      { serviceId: 1, name: 'webfig', port: DEFAULT_LOCAL_PORTS.webfig },
      { serviceId: 2, name: 'ssh', port: DEFAULT_LOCAL_PORTS.ssh },
    ];
    for (const item of plan) {
      try {
        const { server, result } = await startForwarder(
          this.createServer,
          item.serviceId,
          item.port,
          bridge,
        );
        this.servers.push(server);
        this.dispatch({
          type: 'FORWARDER_BOUND',
          endpoint: {
            serviceId: item.serviceId,
            name: item.name,
            host: '127.0.0.1',
            port: result.port,
            url: `http://127.0.0.1:${result.port}`,
          },
        });
      } catch (e) {
        this.dispatch({ type: 'CONNECTION_ERROR', error: errMsg(e) });
        return;
      }
    }
  }

  private armExpiry(expiresAtEpochMs: number): void {
    const delay = Math.max(0, expiresAtEpochMs - Date.now());
    this.expiryTimer = setTimeout(() => {
      this.dispatch({ type: 'EXPIRED' });
      this.teardown();
    }, delay);
  }

  close(): void {
    this.dispatch({ type: 'CLOSE_REQUESTED' });
    this.teardown();
    this.dispatch({ type: 'CLOSED' });
  }

  private teardown(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    for (const server of this.servers) {
      try {
        server.close();
      } catch {
        // le listener a pu déjà tomber avec le tunnel
      }
    }
    this.servers = [];
    this.client?.close();
    this.client = null;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
