import { reportSilent } from '@/src/lib/report';
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
  observedRouterIdentity: string | null,
): Promise<void> {
  // Aucun rapport sans preuve que la liste vient bien du MikroTik de ce routerId (voir lanRouting).
  if (!observedRouterIdentity) return;
  try {
    await api.routers.syncSessions(routerId, active, observedRouterIdentity);
  } catch (e) {
    // Offline, or the router flipped to REMOTE between reads: retried on next read.
    reportSilent('session-sync', e, { routerId });
  }
}
