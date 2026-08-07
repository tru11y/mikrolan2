import { withApi, type ApiConnectionParams } from './MikroTikApiClient';
import type { ServicePorts } from '@/src/lib/api';

// Operators harden RouterOS by moving `www` off the default 80 (87 is common,
// occasionally 8080). SSH/Winbox can also be relocated. We probe /ip/service
// right before provisioning so the VPS DNAT target matches what the router
// actually listens on — a hardcoded :80 target produces silent TCP RSTs the
// user only sees as "connection refused" in the browser.
export async function detectServicePorts(
  creds: ApiConnectionParams,
): Promise<ServicePorts> {
  const rows = await withApi(creds, (c) => c.print('/ip/service'));

  function port(name: string, fallback: number): number {
    const row = rows.find((r) => r.name === name);
    const raw = Number.parseInt(row?.port ?? '', 10);
    return Number.isFinite(raw) && raw > 0 && raw <= 65535 ? raw : fallback;
  }

  return {
    webfigPort: port('www', 80),
    sshPort: port('ssh', 22),
    winboxPort: port('winbox', 8291),
  };
}
