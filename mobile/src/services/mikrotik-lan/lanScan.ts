import * as Network from 'expo-network';

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
  ip: string | null; // the phone's own IP (which subnet we scanned)
  hosts: string[]; // reachable RouterOS candidates
}

/**
 * Scans the phone's /24 subnet for MikroTik routers on the given port.
 * Also reports the phone IP so the operator can see which network was scanned.
 */
export async function scanLan(
  port = 80,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanOutcome> {
  const ip = await Network.getIpAddressAsync();
  if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip) || ip === '0.0.0.0') {
    return { ip: ip ?? null, hosts: [] };
  }

  const base = ip.split('.').slice(0, 3).join('.');
  // Scan the whole /24 plus the common MikroTik default gateway.
  const set = new Set<string>();
  for (let i = 1; i <= 254; i++) set.add(`${base}.${i}`);
  set.add('192.168.88.1');
  const hosts = [...set];
  const found: string[] = [];
  let done = 0;
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < hosts.length) {
      const host = hosts[idx++];
      if (await isRouter(host, port)) found.push(host);
      onProgress?.(++done, hosts.length);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  found.sort((a, b) => Number(a.split('.')[3]) - Number(b.split('.')[3]));
  return { ip, hosts: found };
}
