import { MikroTikLanClient } from './MikroTikLanClient';
import type { ProvisionBundle } from '@/src/lib/api';

const WG_IFACE = 'mikrolan';
const ROUTER_LISTEN_PORT = 13231;

type IdRow = { '.id': string; [k: string]: unknown };

function serverTunnelIp(wgIp: string): string {
  const parts = wgIp.split('.');
  parts[3] = '1'; // server is host .1 of the tunnel subnet
  return `${parts.join('.')}/32`;
}

/**
 * Pushes the WireGuard client config to the router over the LAN so it dials the
 * VPS. Idempotent: reuses the `mikrolan` interface/peer/address if present.
 */
export async function pushWireGuardConfig(
  client: MikroTikLanClient,
  bundle: ProvisionBundle,
): Promise<void> {
  const [endpointHost, endpointPort] = bundle.endpoint.split(':');

  // 1) WireGuard interface with the router's private key.
  const ifaces = await client.list<IdRow>('/interface/wireguard');
  const iface = ifaces.find((i) => i['name'] === WG_IFACE);
  if (iface) {
    await client.set('/interface/wireguard', iface['.id'], {
      'private-key': bundle.routerPrivateKey,
    });
  } else {
    await client.add('/interface/wireguard', {
      name: WG_IFACE,
      'private-key': bundle.routerPrivateKey,
      'listen-port': ROUTER_LISTEN_PORT,
    });
  }

  // 2) Tunnel address on that interface.
  const addresses = await client.list<IdRow>('/ip/address');
  const hasAddress = addresses.some(
    (a) => a['interface'] === WG_IFACE,
  );
  if (!hasAddress) {
    await client.add('/ip/address', {
      address: `${bundle.wgIp}/32`,
      interface: WG_IFACE,
    });
  }

  // 3) Peer pointing at the VPS server.
  const peers = await client.list<IdRow>('/interface/wireguard/peers');
  const peer = peers.find((p) => p['interface'] === WG_IFACE);
  const peerData = {
    interface: WG_IFACE,
    'public-key': bundle.serverPublicKey,
    'endpoint-address': endpointHost,
    'endpoint-port': String(endpointPort),
    'allowed-address': serverTunnelIp(bundle.wgIp),
    'persistent-keepalive': '25s',
  };
  if (peer) {
    await client.set('/interface/wireguard/peers', peer['.id'], peerData);
  } else {
    await client.add('/interface/wireguard/peers', peerData);
  }
}
