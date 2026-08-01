import { api, type LiveSession } from './api';

/**
 * Reports LAN-observed hotspot sessions to the server for a LOCAL router.
 *
 * The VPS cannot reach a router on a private LAN, so this is the only way it
 * learns a ticket was actually used — which is what turns it into revenue.
 * Best-effort on purpose: a screen that was merely listing sessions must not
 * fail because the server was unreachable. The next read retries.
 */
export async function reportLanSessions(
  routerId: string,
  active: LiveSession[],
): Promise<void> {
  try {
    await api.routers.syncSessions(routerId, active);
  } catch {
    // offline, or the router flipped to REMOTE between reads — nothing to do
  }
}
