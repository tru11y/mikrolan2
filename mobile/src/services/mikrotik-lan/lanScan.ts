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

/**
 * Scans the phone's /24 subnet for MikroTik routers on the given port.
 * Returns reachable candidate IPs, sorted by last octet.
 */
export async function scanLan(
  port = 80,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const ip = await Network.getIpAddressAsync();
  if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return [];

  const base = ip.split('.').slice(0, 3).join('.');
  const hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
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
  return found.sort(
    (a, b) => Number(a.split('.')[3]) - Number(b.split('.')[3]),
  );
}
