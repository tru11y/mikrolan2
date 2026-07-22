import {
  deleteStoredValue,
  getStoredValue,
  setStoredValue,
} from '@/src/lib/storage';
import type { RouterCredentials } from '@/src/lib/api';

// Local (free) mode: RouterOS credentials never leave the device — stored in the
// OS secure enclave, keyed by router id. The backend only holds them (encrypted)
// when the operator opts into remote (PRO) management.
const KEY = (routerId: string) => `mikrolan_router_cred_${routerId}`;

export type LocalRouterCredentials = RouterCredentials & {
  host: string;
  port: number;
};

export async function saveLocalCredentials(
  routerId: string,
  creds: LocalRouterCredentials,
): Promise<void> {
  await setStoredValue(KEY(routerId), JSON.stringify(creds));
}

export async function getLocalCredentials(
  routerId: string,
): Promise<LocalRouterCredentials | null> {
  const raw = await getStoredValue(KEY(routerId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalRouterCredentials;
  } catch {
    return null;
  }
}

export async function deleteLocalCredentials(routerId: string): Promise<void> {
  await deleteStoredValue(KEY(routerId));
}

/** host:port string → {host, port}. Defaults to RouterOS REST 80. */
export function parseAddress(address: string): { host: string; port: number } {
  const trimmed = address.trim().replace(/^https?:\/\//i, '');
  const [host, portStr] = trimmed.split(':');
  const port = portStr ? Number.parseInt(portStr, 10) : 80;
  return { host, port: Number.isFinite(port) ? port : 80 };
}
