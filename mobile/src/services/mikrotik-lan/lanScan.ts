import * as Network from 'expo-network';
import { getWifiInfo } from '@/src/lib/lanBinder';

const CONCURRENCY = 24;
const PROBE_TIMEOUT_MS = 1200;

/** A RouterOS REST endpoint answers /rest/system/identity with 401 (no creds)
 *  or 200 (creds) — either means "a router lives here". */
async function isRouter(host: string, port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`http://${host}:${port}/rest/system/identity`, {
      signal: controller.signal,
    });
    return res.status === 401 || res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface ScanOutcome {
  ip: string | null; // the phone's own IP
  gateway: string | null; // DHCP gateway = the router, in most setups
  hosts: string[]; // reachable RouterOS candidates
}

const isIp = (v?: string | null): v is string =>
  !!v && /^\d+\.\d+\.\d+\.\d+$/.test(v) && v !== '0.0.0.0';

/**
 * Detects the Wi-Fi gateway (the router) and scans the relevant /24 subnets.
 * The subnet may be wider than /24 (e.g. /22), so scanning the phone's /24
 * alone can miss the gateway — hence probing the gateway explicitly first.
 */
export async function scanLan(
  port = 80,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanOutcome> {
  const info = await getWifiInfo();
  const ip = isIp(info?.ipAddress)
    ? info!.ipAddress
    : await Network.getIpAddressAsync().catch(() => null);
  const gateway = isIp(info?.gateway) ? info!.gateway : null;

  const bases = new Set<string>();
  if (isIp(ip)) bases.add(ip.split('.').slice(0, 3).join('.'));
  if (gateway) bases.add(gateway.split('.').slice(0, 3).join('.'));

  // Gateway first (most likely the router), then the candidate /24s.
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (h: string) => {
    if (!seen.has(h)) {
      seen.add(h);
      ordered.push(h);
    }
  };
  if (gateway) push(gateway);
  bases.forEach((base) => {
    for (let i = 1; i <= 254; i++) push(`${base}.${i}`);
  });
  push('192.168.88.1');

  const found: string[] = [];
  let done = 0;
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < ordered.length) {
      const host = ordered[idx++];
      if (await isRouter(host, port)) found.push(host);
      onProgress?.(++done, ordered.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  found.sort((a, b) => {
    if (a === gateway) return -1;
    if (b === gateway) return 1;
    return 0;
  });
  return { ip: isIp(ip) ? ip : null, gateway, hosts: found };
}
