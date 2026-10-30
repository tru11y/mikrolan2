import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { TenantContext } from '../context/tenant-context';

/**
 * Per-vendor throttle for the ticket verifier endpoint.
 *
 * Global @nestjs/throttler keys requests by client IP, which would block
 * two vendors sharing a Wi-Fi uplink against each other. For
 * /ticket-verification/verify we key on req.user.userId instead — populated
 * by JwtAuthGuard, which is an APP_GUARD and runs BEFORE any controller
 * @UseGuards. The ticket code never enters the key.
 *
 * The endpoint uses @SkipThrottle() to disable the global ThrottlerGuard
 * (so a shared IP cannot exhaust the per-IP quota before this guard
 * applies); shouldSkip() is overridden to ensure THIS guard still fires.
 */
@Injectable()
export class VerifierThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(): Promise<boolean> {
    return false;
  }

  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const user = req['user'] as TenantContext | undefined;
    if (user?.userId) return `verify:user:${user.userId}`;
    // Defense in depth: if auth somehow didn't populate req.user, fall back
    // to IP so the endpoint still has a finite rate.
    const ip = typeof req['ip'] === 'string' ? (req['ip'] as string) : 'anon';
    return `verify:anon:${ip}`;
  }
}
