import {
  withApi,
  LanApiError,
  type ApiConnectionParams,
} from './MikroTikApiClient';
import type { ProvisionBundle } from '@/src/lib/api';

const WG_IFACE = 'mikrolan';
const ROUTER_LISTEN_PORT = '13231';
// Firewall rule comments (one per protected service, so each is idempotent and
// re-positionable independently, matching what mikroserver v1 does).
const FW_COMMENT_API = 'mikrolan-mgmt-api';
const FW_COMMENT_WEBFIG = 'mikrolan-mgmt-webfig';
const FW_COMMENT_ADMIN = 'mikrolan-mgmt-admin';
const ROUTE_COMMENT = 'mikrolan-mgmt-route';
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

function vpsTunnelIp(wgIp: string): string {
  const parts = wgIp.split('.');
  parts[3] = '1';
  return parts.join('.');
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

    // 4) Explicit static route toward the tunnel subnet via the WG interface.
    // The /24 address on the interface installs a connected route, but that
    // route can be shadowed by hotspot / DHCP-Client reconfigurations. An
    // explicit route via the WG interface is what mikroserver v1 does and is
    // what guarantees the reply path is symmetric — without it, RouterOS sends
    // a RST because the incoming SYN has no valid return route through the
    // tunnel. Idempotent by comment.
    const routes = await c.print('/ip/route');
    const wantRouteDst = tunnelSubnet(bundle.wgIp);
    const existingRoute = routes.find((r) => r.comment === ROUTE_COMMENT);
    if (!existingRoute?.['.id']) {
      await c.add('/ip/route', {
        'dst-address': wantRouteDst,
        gateway: WG_IFACE,
        distance: '1',
        comment: ROUTE_COMMENT,
      });
    } else if (
      existingRoute['dst-address'] !== wantRouteDst ||
      existingRoute.gateway !== WG_IFACE
    ) {
      await c.set('/ip/route', existingRoute['.id'], {
        'dst-address': wantRouteDst,
        gateway: WG_IFACE,
      });
    }

    // 5) Firewall: allow VPS management traffic arriving on the tunnel. Three
    // scoped rules (matching mikroserver v1's proven pattern) instead of one
    // broad accept — RouterOS treats scoped accepts more predictably against
    // subsequent hotspot/anti-tethering drops, and it makes each service's
    // rule independently idempotent/repositionable.
    //   - API (8728) : restricted to VPS source, so the backend can drive
    //   - WebFig (80) + SSH (22) + Winbox (8291) : dst-port only
    // Each rule is re-positioned to the top on every provision (place-before=0
    // literal — the sequence-index that RouterOS interprets as "very top"),
    // because later-added rules can silently displace it downward.
    const vpsIp = vpsTunnelIp(bundle.wgIp);
    type FwRule = {
      comment: string;
      spec: Record<string, string>;
    };
    const wantedRules: FwRule[] = [
      {
        comment: FW_COMMENT_API,
        spec: {
          chain: 'input',
          action: 'accept',
          protocol: 'tcp',
          'dst-port': '8728',
          'src-address': vpsIp,
          'in-interface': WG_IFACE,
          comment: FW_COMMENT_API,
        },
      },
      {
        comment: FW_COMMENT_WEBFIG,
        spec: {
          chain: 'input',
          action: 'accept',
          protocol: 'tcp',
          'dst-port': '80',
          'in-interface': WG_IFACE,
          comment: FW_COMMENT_WEBFIG,
        },
      },
      {
        comment: FW_COMMENT_ADMIN,
        spec: {
          chain: 'input',
          action: 'accept',
          protocol: 'tcp',
          'dst-port': '22,8291',
          'in-interface': WG_IFACE,
          comment: FW_COMMENT_ADMIN,
        },
      },
    ];

    const filters = await c.print('/ip/firewall/filter');
    // Add missing rules first (in reverse — see below for order rationale).
    for (const wanted of wantedRules) {
      const existing = filters.find((f) => f.comment === wanted.comment);
      if (!existing?.['.id']) {
        await c.add('/ip/firewall/filter', { ...wanted.spec, 'place-before': '0' });
      }
    }
    // Then reposition ALL managed rules to the top so they take precedence
    // over any drop rule inserted after them. Move in REVERSE wantedRules
    // order: after each move(dest=0) the moved rule sits at position 0, so
    // moving them last-to-first leaves the final order matching wantedRules.
    const filtersAfterAdd = await c.print('/ip/firewall/filter');
    for (let i = wantedRules.length - 1; i >= 0; i--) {
      const wanted = wantedRules[i];
      const rule = filtersAfterAdd.find((f) => f.comment === wanted.comment);
      if (!rule?.['.id']) continue;
      try {
        await c.move('/ip/firewall/filter', rule['.id'], '0');
      } catch (e) {
        // RouterOS refuses to move a rule that is already at the top
        // ("can not move object before itself") — a no-op re-provision on
        // an unchanged router hits this on every rule, it's not a failure.
        if (!(e instanceof LanApiError && e.message.includes('before itself'))) {
          throw e;
        }
      }
    }
  });
}
