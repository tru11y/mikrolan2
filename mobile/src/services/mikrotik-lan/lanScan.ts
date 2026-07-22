import * as Network from 'expo-network';
import TcpSocket from 'react-native-tcp-socket';
import { getWifiInfo } from '@/src/lib/lanBinder';

const CONCURRENCY = 24;
const PROBE_TIMEOUT_MS = 1400;

/** A router is present if its RouterOS API port (default 8728) accepts a TCP
 *  connection. This works whether or not REST/www is enabled. */
async function isRouter(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    const socket = TcpSocket.createConnection(
      { host, port, interface: 'wifi' },
      () => {
        clearTimeout(timer);
        finish(true);
      },
    );
    socket.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
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
  port = 8728,
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
