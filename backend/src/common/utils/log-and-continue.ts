import type { Logger } from '@nestjs/common';

/** `.catch()` handler for best-effort side effects: the failure is logged, never swallowed. */
export function logAndContinue<T = void>(logger: Logger, what: string, fallback?: T) {
  return (err: unknown): T => {
    logger.warn(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
    return fallback as T;
  };
}
