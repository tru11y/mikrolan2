import { Sentry } from '@/src/lib/sentry';

/**
 * Best-effort side effects must never be swallowed: the failure is kept as a
 * Sentry breadcrumb (attached to the next event) and logged in development.
 */
export function reportSilent(scope: string, err: unknown, data?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err);
  if (__DEV__) console.warn(`[${scope}] ${message}`);
  Sentry.addBreadcrumb({ category: scope, level: 'warning', message, data });
}

/** `.catch()` handler that reports the failure instead of dropping it. */
export const swallow = (scope: string) => (err: unknown) => reportSilent(scope, err);

/** `.catch()` handler that reports the failure and yields a fallback value. */
export const fallbackTo =
  <T>(scope: string, value: T) =>
  (err: unknown): T => {
    reportSilent(scope, err);
    return value;
  };
