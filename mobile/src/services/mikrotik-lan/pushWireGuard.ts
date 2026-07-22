import {
  withApi,
  type ApiConnectionParams,
} from './MikroTikApiClient';
import type { ProvisionBundle } from '@/src/lib/api';

const WG_IFACE = 'mikrolan';
const ROUTER_LISTEN_PORT = '13231';
const FW_COMMENT = 'mikrolan-mgmt';
// Tunnel subnet prefix — MUST match the backend WG_SUBNET_BASE (10.20.0.0/24).
// The address is set with this prefix (not /32) so RouterOS installs a connected
// route for the whole tunnel subnet; unlike wg-quick, RouterOS does NOT derive a
// route from a peer's allowed-address, so a /32 address leaves the server
// (10.20.0.1) unroutable and replies escape via the WAN. This mirrors how
// MikroTicket provisions (interface address carries the subnet prefix).
const TUNNEL_PREFIX = '24';

function tunnelSubnet(wgIp: string): string {
  const parts = wgIp.split('.');
  parts[3] = '0';
  return `${parts.join('.')}/${TUNNEL_PREFIX}`;
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

    // 2) Tunnel address on that interface. Reconcile rather than skip: on a
    // re-provision the VPS may allocate a different wgIp, so a stale address
    // must be corrected or the router becomes unreachable through the tunnel.
    const wantAddress = `${bundle.wgIp}/${TUNNEL_PREFIX}`;
    const addresses = await c.print('/ip/address');
    const existingAddr = addresses.find((a) => a.interface === WG_IFACE);
    if (!existingAddr?.['.id']) {
      await c.add('/ip/address', {
        address: wantAddress,
        interface: WG_IFACE,
      });
    } else if (existingAddr.address !== wantAddress) {
      await c.set('/ip/address', existingAddr['.id'], { address: wantAddress });
    }

    // 3) Peer pointing at the VPS server.
    const peers = await c.print('/interface/wireguard/peers');
    const peer = peers.find((p) => p.interface === WG_IFACE);
    const peerData = {
      interface: WG_IFACE,
      'public-key': bundle.serverPublicKey,
      'endpoint-address': endpointHost,
      'endpoint-port': endpointPort,
      'allowed-address': tunnelSubnet(bundle.wgIp),
      'persistent-keepalive': '25',
    };
    if (peer?.['.id']) {
      await c.set('/interface/wireguard/peers', peer['.id'], peerData);
    } else {
      await c.add('/interface/wireguard/peers', peerData);
    }

    // 4) Firewall: allow VPS management traffic arriving on the tunnel. RouterOS
    // drops the input chain for non-LAN interfaces by default, so without this
    // the tunnel handshakes but the router stays unreachable. Idempotent by
    // comment; placed before the first rule so it precedes any input drop.
    const filters = await c.print('/ip/firewall/filter');
    if (!filters.some((f) => f.comment === FW_COMMENT)) {
      const rule: Record<string, string> = {
        chain: 'input',
        'in-interface': WG_IFACE,
        action: 'accept',
        comment: FW_COMMENT,
      };
      const firstId = filters[0]?.['.id'];
      if (firstId) rule['place-before'] = firstId;
      await c.add('/ip/firewall/filter', rule);
    }
  });
}
