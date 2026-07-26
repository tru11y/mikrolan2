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

export interface HotspotServer {
  id: string;
  name: string;
  interface: string;
}

export interface HotspotSettings {
  idleTimeoutMinutes: number | null;
  dnsName: string | null;
}

function parseTimeoutMinutes(value?: string): number | null {
  if (!value || value === 'none') return null;
  // RouterOS returns "00:10:00" (hh:mm:ss) or a short form like "10m".
  const hms = value.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hms) {
    return Number(hms[1]) * 60 + Number(hms[2]) + Math.round(Number(hms[3]) / 60);
  }
  const short = value.match(/^(\d+)m$/);
  return short ? Number(short[1]) : null;
}

/** Resolves the `/ip/hotspot/profile` name backing a given server. */
async function profileNameForServer(
  c: RouterOsApiClient,
  serverName: string,
): Promise<string> {
  const servers = await c.command([
    '/ip/hotspot/print',
    '=.proplist=.id,name,profile',
  ]);
  const server = servers.find((s) => s.name === serverName);
  if (!server?.profile) {
    throw new Error(`Hotspot server "${serverName}" not found`);
  }
  return server.profile;
}

/** Reads idle-timeout + dns-name from the profile behind a hotspot server. */
export async function getHotspotSettings(
  c: RouterOsApiClient,
  serverName: string,
): Promise<HotspotSettings> {
  const profileName = await profileNameForServer(c, serverName);
  const profiles = await c.command([
    '/ip/hotspot/profile/print',
    '=.proplist=.id,name,idle-timeout,dns-name',
  ]);
  const profile = profiles.find((p) => p.name === profileName);
  return {
    idleTimeoutMinutes: parseTimeoutMinutes(profile?.['idle-timeout']),
    dnsName: profile?.['dns-name'] || null,
  };
}

/** Updates idle-timeout + dns-name on the profile behind a hotspot server. */
export async function setHotspotSettings(
  c: RouterOsApiClient,
  serverName: string,
  settings: { idleTimeoutMinutes?: number | null; dnsName?: string | null },
): Promise<void> {
  const profileName = await profileNameForServer(c, serverName);
  const profiles = await c.command([
    '/ip/hotspot/profile/print',
    '=.proplist=.id,name',
  ]);
  const id = profiles.find((p) => p.name === profileName)?.['.id'];
  if (!id) throw new Error(`Hotspot profile "${profileName}" not found`);

  const data: Record<string, string | undefined> = {};
  if (settings.idleTimeoutMinutes !== undefined) {
    data['idle-timeout'] =
      settings.idleTimeoutMinutes === null
        ? 'none'
        : `${settings.idleTimeoutMinutes}m`;
  }
  if (settings.dnsName !== undefined) {
    data['dns-name'] = settings.dnsName ?? '';
  }
  await c.command(['/ip/hotspot/profile/set', `=.id=${id}`, ...attrs(data)]);
}

/** Lists the hotspot servers on the router (for the ticket « Serveur Hotspot »). */
export async function listHotspotServers(
  c: RouterOsApiClient,
): Promise<HotspotServer[]> {
  const rows = await c.command([
    '/ip/hotspot/print',
    '=.proplist=.id,name,interface',
  ]);
  return rows
    .filter((r) => r.name)
    .map((r) => ({
      id: r['.id'] ?? '',
      name: r.name ?? '',
      interface: r.interface ?? '',
    }));
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

export type IpBindingType = 'bypassed' | 'blocked' | 'regular';

export interface IpBinding {
  id: string;
  macAddress: string;
  ipAddress?: string;
  server?: string;
  type: IpBindingType;
  comment?: string;
}

export interface IpBindingSpec {
  macAddress: string;
  ipAddress?: string;
  server?: string;
  type: IpBindingType;
  comment?: string;
}

/** Lists /ip/hotspot/ip-binding entries (bypass/block MAC devices). */
export async function listIpBindings(
  c: RouterOsApiClient,
): Promise<IpBinding[]> {
  const rows = await c.command([
    '/ip/hotspot/ip-binding/print',
    '=.proplist=.id,mac-address,address,server,type,comment',
  ]);
  return rows.map((r) => ({
    id: r['.id'] ?? '',
    macAddress: r['mac-address'] ?? '',
    ipAddress: r.address || undefined,
    server: r.server || undefined,
    type: (r.type as IpBindingType) || 'regular',
    comment: r.comment || undefined,
  }));
}

/** Adds an IP binding. Returns the RouterOS `.id`. */
export async function addIpBinding(
  c: RouterOsApiClient,
  b: IpBindingSpec,
): Promise<string> {
  const rows = await c.command([
    '/ip/hotspot/ip-binding/add',
    ...attrs({
      'mac-address': b.macAddress,
      address: b.ipAddress,
      server: b.server,
      type: b.type,
      comment: b.comment,
    }),
  ]);
  return rows.find((r) => 'ret' in r)?.ret ?? '';
}

// Standard hotspot-billing anti-tethering recipe: client OSes send TTL=64/128
// on their own traffic; a shared/tethered device is one extra hop away, so its
// forwarded packets arrive with TTL-1. Dropping ttl=63/127 in forward blocks
// tethered traffic without touching direct client traffic. Idempotent via a
// stable comment; ⚠️ never applied automatically — the operator enables it
// explicitly from the app, ideally off-peak, since a live hotspot serves real
// paying customers.
const TETHER_RULE_COMMENT = 'mikrolan-antitether';

// `drop` is a /ip/firewall/filter action, not a mangle one (mangle only
// marks/rewrites packets — accept/drop decisions belong to the filter
// table). Confirmed live: mangle rejected action=drop with "input does not
// match any value of action".
export async function isInternetSharingBlocked(
  c: RouterOsApiClient,
): Promise<boolean> {
  const rows = await c.command([
    '/ip/firewall/filter/print',
    '=.proplist=.id,comment',
  ]);
  return rows.some((r) => r.comment === TETHER_RULE_COMMENT);
}

export async function setInternetSharingBlocked(
  c: RouterOsApiClient,
  blocked: boolean,
): Promise<void> {
  const rows = await c.command([
    '/ip/firewall/filter/print',
    '=.proplist=.id,comment',
  ]);
  const existingIds = rows
    .filter((r) => r.comment === TETHER_RULE_COMMENT)
    .map((r) => r['.id'])
    .filter((id): id is string => Boolean(id));

  if (!blocked) {
    for (const id of existingIds) {
      await c.command(['/ip/firewall/filter/remove', `=.id=${id}`]);
    }
    return;
  }
  if (existingIds.length > 0) return; // already enabled, idempotent

  // RouterOS 7.x's `ttl` matcher takes an operator-prefixed value, not a bare
  // integer: confirmed via `/ip/firewall/mangle/export` on the live router,
  // which showed a GUI-created rule stored as `ttl=equal:63` (also accepts
  // `less-than:`/`greater-than:`). The plain integer form ("63") is rejected
  // by the API with "invalid value for argument ttl" even though it matches
  // the older help.mikrotik.com wording — that doc is stale for this syntax.
  for (const ttl of ['equal:63', 'equal:127']) {
    await c.command([
      '/ip/firewall/filter/add',
      ...attrs({
        chain: 'forward',
        protocol: 'tcp',
        'connection-state': 'new',
        ttl,
        action: 'drop',
        comment: TETHER_RULE_COMMENT,
      }),
    ]);
  }
}

export async function removeIpBinding(
  c: RouterOsApiClient,
  mikrotikId: string,
): Promise<void> {
  await c.command(['/ip/hotspot/ip-binding/remove', `=.id=${mikrotikId}`]);
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
