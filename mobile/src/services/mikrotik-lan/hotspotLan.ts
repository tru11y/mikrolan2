import {
  withApi,
  type ApiConnectionParams,
  type ApiRow,
} from './MikroTikApiClient';
import type {
  VoucherItem,
  VoucherPushParams,
  LiveSession,
  HotspotServer,
  IpBinding,
  CreateIpBindingPayload,
} from '@/src/lib/api';

// `.proplist` is REQUIRED on hotspot profile/active prints: a bare print can
// stall forever when a profile carries a large on-login script (MikroTicket).
// See skills_routeros_print_proplist_hang in project memory.

/** Pushes generated vouchers to the router over the LAN (free/offline mode). */
export async function pushVouchersLan(
  creds: ApiConnectionParams,
  vouchers: VoucherItem[],
  push: VoucherPushParams,
): Promise<{ id: string; mikrotikId: string }[]> {
  return withApi(creds, async (c) => {
    // 1) ensure the plan's user-profile exists
    const profiles = await c.print('/ip/hotspot/user/profile', [
      '=.proplist=.id,name',
    ]);
    if (!profiles.some((p) => p.name === push.userProfile)) {
      const data: Record<string, string> = { name: push.userProfile };
      if (push.rateLimit) data['rate-limit'] = push.rateLimit;
      if (push.sharedUsers && push.sharedUsers > 0) {
        data['shared-users'] = String(push.sharedUsers);
      }
      await c.add('/ip/hotspot/user/profile', data);
    }

    // 2) push each voucher as a hotspot user, collecting the RouterOS .id
    const out: { id: string; mikrotikId: string }[] = [];
    for (const v of vouchers) {
      const data: Record<string, string> = {
        name: v.code,
        password: v.password,
        profile: push.userProfile,
        'limit-uptime': push.limitUptime,
        comment: push.comment,
      };
      if (push.limitBytesTotal) {
        data['limit-bytes-total'] = String(push.limitBytesTotal);
      }
      const mikrotikId = await c.add('/ip/hotspot/user', data);
      if (mikrotikId) out.push({ id: v.id, mikrotikId });
    }
    return out;
  });
}

function mapActive(row: ApiRow): LiveSession {
  return {
    id: row['.id'] ?? '',
    user: row.user ?? '',
    ipAddress: row.address ?? null,
    macAddress: row['mac-address'] ?? null,
    bytesIn: row['bytes-in'] ?? '0',
    bytesOut: row['bytes-out'] ?? '0',
    uptime: row.uptime ?? null,
  };
}

/** Reads the live hotspot sessions over the LAN (free/offline mode). */
export async function listActiveLan(
  creds: ApiConnectionParams,
): Promise<LiveSession[]> {
  return withApi(creds, async (c) => {
    const rows = await c.print('/ip/hotspot/active', [
      '=.proplist=.id,user,address,mac-address,bytes-in,bytes-out,uptime',
    ]);
    return rows.map(mapActive);
  });
}

/** Disconnects an active session over the LAN. */
export async function terminateActiveLan(
  creds: ApiConnectionParams,
  mikrotikId: string,
): Promise<void> {
  await withApi(creds, (c) => c.remove('/ip/hotspot/active', mikrotikId));
}

export type RouterProfile = {
  id: string;
  name: string;
  sharedUsers: number;
  rateLimit: string | null;
};

/** Lists hotspot user-profiles on the router (plans already configured on the device). */
export async function listUserProfilesLan(
  creds: ApiConnectionParams,
): Promise<RouterProfile[]> {
  return withApi(creds, async (c) => {
    const rows = await c.print('/ip/hotspot/user/profile', [
      '=.proplist=.id,name,shared-users,rate-limit',
    ]);
    return rows
      .filter((r) => r.name && r.name !== 'default')
      .map((r) => ({
        id: r['.id'] ?? '',
        name: r.name ?? '',
        sharedUsers: Number(r['shared-users']) || 1,
        rateLimit: r['rate-limit'] || null,
      }));
  });
}

/** Lists hotspot servers over the LAN (free/offline mode), for the ticket « Serveur Hotspot » dropdown. */
export async function listHotspotServersLan(
  creds: ApiConnectionParams,
): Promise<HotspotServer[]> {
  return withApi(creds, async (c) => {
    const rows = await c.print('/ip/hotspot', ['=.proplist=.id,name,interface']);
    return rows
      .filter((r) => r.name)
      .map((r) => ({
        id: r['.id'] ?? '',
        name: r.name ?? '',
        interface: r.interface ?? '',
      }));
  });
}

/** Lists IP bindings over the LAN (free/offline mode). */
export async function listIpBindingsLan(
  creds: ApiConnectionParams,
): Promise<IpBinding[]> {
  return withApi(creds, async (c) => {
    const rows = await c.print('/ip/hotspot/ip-binding', [
      '=.proplist=.id,mac-address,address,server,type,comment',
    ]);
    return rows.map((r) => ({
      id: r['.id'] ?? '',
      macAddress: r['mac-address'] ?? '',
      ipAddress: r.address || undefined,
      server: r.server || undefined,
      type: (r.type as IpBinding['type']) || 'regular',
      comment: r.comment || undefined,
    }));
  });
}

/** Adds an IP binding over the LAN. Returns the RouterOS `.id`. */
export async function addIpBindingLan(
  creds: ApiConnectionParams,
  binding: CreateIpBindingPayload,
): Promise<string> {
  return withApi(creds, async (c) => {
    const data: Record<string, string> = {
      'mac-address': binding.macAddress,
      type: binding.type,
    };
    if (binding.ipAddress) data.address = binding.ipAddress;
    if (binding.server) data.server = binding.server;
    if (binding.comment) data.comment = binding.comment;
    return c.add('/ip/hotspot/ip-binding', data);
  });
}

/** Removes an IP binding over the LAN. */
export async function removeIpBindingLan(
  creds: ApiConnectionParams,
  mikrotikId: string,
): Promise<void> {
  await withApi(creds, (c) => c.remove('/ip/hotspot/ip-binding', mikrotikId));
}
