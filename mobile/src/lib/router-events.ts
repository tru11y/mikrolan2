import { api, type ClientEventKind, type EventOutcome } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { reportSilent } from '@/src/lib/report';

/**
 * Reports an action done directly over the LAN to the server audit trail.
 * Tracing must never break the action itself, but a failed trace is reported.
 */
export async function traceRouterEvent(
  routerId: string,
  kind: ClientEventKind,
  outcome: EventOutcome,
  err?: unknown,
): Promise<void> {
  try {
    const described = err === undefined ? null : describeError(err);
    await api.routers.recordEvent(routerId, {
      kind,
      outcome,
      ...(described
        ? { errorCode: described.errorCode ?? (err instanceof Error ? err.name : undefined), message: described.message }
        : {}),
    });
  } catch (traceErr) {
    reportSilent(`trace.${kind}`, traceErr);
  }
}
