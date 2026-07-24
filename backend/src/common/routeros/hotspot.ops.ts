import { attrs, type ApiRow, type RouterOsApiClient } from './routeros-api.client';

// Names mikrolan owns on the router — stable so setup/teardown stays idempotent.
export const HS_POOL = 'mikrolan-pool';
export const HS_DHCP = 'mikrolan-dhcp';
export const HS_PROFILE = 'mikrolan-hsprof';
export const HS_SERVER = 'mikrolan';

export interface PlanForProfile {
  userProfile: string;
  downloadKbps: number | null;
  uploadKbps: number | null;
  sharedUsers?: number; // logins simultanés (RouterOS shared-users)
}

export interface HotspotUserSpec {
  code: string;
  password: string;
  profile: string;
  limitUptime?: string; // RouterOS time, e.g. "60m"
  limitBytesTotal?: number;
  comment?: string;
}

export interface ConfigureHotspotOpts {
  iface: string;
  gateway: string; // e.g. 10.5.50.1
  prefix: number; // e.g. 24
  poolRange: string; // e.g. 10.5.50.10-10.5.50.254
  network: string; // e.g. 10.5.50.0/24
  dns: string; // e.g. 8.8.8.8
}

const idOf = (r?: ApiRow): string | undefined => r?.['.id'];

/**
 * Idempotently configures a hotspot on `iface` (address, pool, DHCP, profile,
 * server) — the API equivalent of `/ip/hotspot/setup`. EXPERIMENTAL: RouterOS
 * setup has subtle ordering/DNS/login nuances; validate end-to-end on a real
 * router and adjust before relying on it in production.
 */
export async function configureHotspot(
  c: RouterOsApiClient,
  o: ConfigureHotspotOpts,
): Promise<void> {
  const addresses = await c.command([
    '/ip/address/print',
    '=.proplist=.id,address,interface',
  ]);
  if (
    !addresses.some(
      (a) => a.interface === o.iface && a.address?.startsWith(`${o.gateway}/`),
    )
  ) {
    await c.command([
      '/ip/address/add',
      ...attrs({ address: `${o.gateway}/${o.prefix}`, interface: o.iface }),
    ]);
  }

  const pools = await c.command(['/ip/pool/print', '=.proplist=.id,name']);
  if (!pools.some((p) => p.name === HS_POOL)) {
    await c.command([
      '/ip/pool/add',
      ...attrs({ name: HS_POOL, ranges: o.poolRange }),
    ]);
  }

  const dhcp = await c.command([
    '/ip/dhcp-server/print',
    '=.proplist=.id,name',
  ]);
  if (!dhcp.some((d) => d.name === HS_DHCP)) {
    await c.command([
      '/ip/dhcp-server/add',
      ...attrs({
        name: HS_DHCP,
        interface: o.iface,
        'address-pool': HS_POOL,
        disabled: 'no',
        'lease-time': '1h',
      }),
    ]);
  }

  const nets = await c.command([
    '/ip/dhcp-server/network/print',
    '=.proplist=.id,address',
  ]);
  if (!nets.some((n) => n.address === o.network)) {
    await c.command([
      '/ip/dhcp-server/network/add',
      ...attrs({ address: o.network, gateway: o.gateway, 'dns-server': o.dns }),
    ]);
  }

  const profiles = await c.command([
    '/ip/hotspot/profile/print',
    '=.proplist=.id,name',
  ]);
  if (!profiles.some((p) => p.name === HS_PROFILE)) {
    await c.command([
      '/ip/hotspot/profile/add',
      ...attrs({
        name: HS_PROFILE,
        'hotspot-address': o.gateway,
        'login-by': 'http-chap,http-pap',
      }),
    ]);
  }

  const servers = await c.command(['/ip/hotspot/print', '=.proplist=.id,name']);
  if (!servers.some((s) => s.name === HS_SERVER)) {
    await c.command([
      '/ip/hotspot/add',
      ...attrs({
        name: HS_SERVER,
        interface: o.iface,
        'address-pool': HS_POOL,
        profile: HS_PROFILE,
        disabled: 'no',
      }),
    ]);
  }
}

/** Ensures a hotspot user-profile mirroring the Plan (rate-limit). Idempotent. */
export async function ensureUserProfile(
  c: RouterOsApiClient,
  plan: PlanForProfile,
): Promise<void> {
  // RouterOS rate-limit = "rx/tx" from the CLIENT's perspective: rx = client
  // upload, tx = client download. Only set when both are known.
  const rateLimit =
    plan.uploadKbps && plan.downloadKbps
      ? `${plan.uploadKbps}k/${plan.downloadKbps}k`
      : undefined;

  // `.proplist` is REQUIRED here: a bare print of hotspot user-profiles can
  // stall forever (0 bytes back) when another profile carries a large on-login/
  // on-logout script (e.g. left by MikroTicket). Fetching only .id+name avoids
  // serializing those fields.
  const rows = await c.command([
    '/ip/hotspot/user/profile/print',
    '=.proplist=.id,name',
  ]);
  const sharedUsers =
    plan.sharedUsers && plan.sharedUsers > 0 ? String(plan.sharedUsers) : undefined;
  const existing = rows.find((r) => r.name === plan.userProfile);
  const id = idOf(existing);
  if (id) {
    if (rateLimit || sharedUsers) {
      await c.command([
        '/ip/hotspot/user/profile/set',
        `=.id=${id}`,
        ...attrs({ 'rate-limit': rateLimit, 'shared-users': sharedUsers }),
      ]);
    }
    return;
  }
  await c.command([
    '/ip/hotspot/user/profile/add',
    ...attrs({
      name: plan.userProfile,
      'rate-limit': rateLimit,
      'shared-users': sharedUsers,
    }),
  ]);
}

/** Adds a hotspot user (voucher). Returns the RouterOS `.id`. */
export async function addHotspotUser(
  c: RouterOsApiClient,
  u: HotspotUserSpec,
): Promise<string> {
  const rows = await c.command([
    '/ip/hotspot/user/add',
    ...attrs({
      name: u.code,
      password: u.password,
      profile: u.profile,
      'limit-uptime': u.limitUptime,
      'limit-bytes-total': u.limitBytesTotal,
      comment: u.comment,
    }),
  ]);
  return rows.find((r) => 'ret' in r)?.ret ?? '';
}

export async function removeHotspotUser(
  c: RouterOsApiClient,
  mikrotikId: string,
): Promise<void> {
  await c.command(['/ip/hotspot/user/remove', `=.id=${mikrotikId}`]);
}

export function listActive(c: RouterOsApiClient): Promise<ApiRow[]> {
  // Scope to the fields we reflect — keeps replies small and dodges any
  // stall on heavy computed columns (see ensureUserProfile).
  return c.command([
    '/ip/hotspot/active/print',
    '=.proplist=.id,user,address,mac-address,bytes-in,bytes-out,uptime',
  ]);
}

export async function removeActive(
  c: RouterOsApiClient,
  mikrotikId: string,
): Promise<void> {
  await c.command(['/ip/hotspot/active/remove', `=.id=${mikrotikId}`]);
}
