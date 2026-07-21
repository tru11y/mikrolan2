import {
  withApi,
  type ApiConnectionParams,
} from './MikroTikApiClient';
import type { ProvisionBundle } from '@/src/lib/api';

const WG_IFACE = 'mikrolan';
const ROUTER_LISTEN_PORT = '13231';

function serverTunnelIp(wgIp: string): string {
  const parts = wgIp.split('.');
  parts[3] = '1'; // server is host .1 of the tunnel subnet
  return `${parts.join('.')}/32`;
}

/**
 * Pushes the WireGuard client config to the router over the RouterOS API so it
 * dials the VPS. Idempotent: reuses the `mikrolan` interface/peer/address.
 */
export async function pushWireGuardConfig(
  creds: ApiConnectionParams,
  bundle: ProvisionBundle,
): Promise<void> {
  const [endpointHost, endpointPort] = bundle.endpoint.split(':');

  await withApi(creds, async (c) => {
    // 1) WireGuard interface with the router's private key.
    const ifaces = await c.print('/interface/wireguard');
    const iface = ifaces.find((i) => i.name === WG_IFACE);
    if (iface?.['.id']) {
      await c.set('/interface/wireguard', iface['.id'], {
        'private-key': bundle.routerPrivateKey,
      });
    } else {
      await c.add('/interface/wireguard', {
        name: WG_IFACE,
        'private-key': bundle.routerPrivateKey,
        'listen-port': ROUTER_LISTEN_PORT,
      });
    }

    // 2) Tunnel address on that interface.
    const addresses = await c.print('/ip/address');
    const hasAddress = addresses.some((a) => a.interface === WG_IFACE);
    if (!hasAddress) {
      await c.add('/ip/address', {
        address: `${bundle.wgIp}/32`,
        interface: WG_IFACE,
      });
    }

    // 3) Peer pointing at the VPS server.
    const peers = await c.print('/interface/wireguard/peers');
    const peer = peers.find((p) => p.interface === WG_IFACE);
    const peerData = {
      interface: WG_IFACE,
      'public-key': bundle.serverPublicKey,
      'endpoint-address': endpointHost,
      'endpoint-port': endpointPort,
      'allowed-address': serverTunnelIp(bundle.wgIp),
      'persistent-keepalive': '25',
    };
    if (peer?.['.id']) {
      await c.set('/interface/wireguard/peers', peer['.id'], peerData);
    } else {
      await c.add('/interface/wireguard/peers', peerData);
    }
  });
}
