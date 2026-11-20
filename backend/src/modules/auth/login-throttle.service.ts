import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

/**
 * Per-account login throttle backed by Redis. Blunts distributed brute-force
 * and credential-stuffing (which the per-IP rate limit can't catch when the
 * attacker rotates IPs) and, by rejecting before the argon2 verify, removes
 * the CPU-exhaustion vector of hammering one account with wrong passwords. It
 * also bounds TOTP guessing, since a 6-digit code is only 10^6 possibilities.
 *
 * Keyed by email so the same uniform failure is produced whether or not the
 * account exists — no user-enumeration signal. Fail-open on Redis errors:
 * authentication must not go down because the throttle store is unavailable.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  private static readonly MAX_FAILURES = 10;
  private static readonly WINDOW_SECONDS = 15 * 60;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(email: string): string {
    return `login:fail:${email.trim().toLowerCase()}`;
  }

  /**
   * True when the account is currently locked. The caller throws its own
   * uniform "Invalid credentials" error so a locked account is indistinguishable
   * from a wrong password. Fail-open: a Redis read error never locks anyone out.
   */
  async isLocked(email: string): Promise<boolean> {
    try {
      const count = await this.redis.get(this.key(email));
      return count !== null && Number(count) >= LoginThrottleService.MAX_FAILURES;
    } catch (err) {
      this.logger.warn(`login throttle read failed, allowing: ${String(err)}`);
      return false;
    }
  }

  /** Records a failed attempt on a sliding 15-minute window. */
  async recordFailure(email: string): Promise<void> {
    try {
      const k = this.key(email);
      const count = await this.redis.incr(k);
      if (count === 1) {
        await this.redis.expire(k, LoginThrottleService.WINDOW_SECONDS);
      }
    } catch (err) {
      this.logger.warn(`login throttle increment failed: ${String(err)}`);
    }
  }

  /** Clears the counter after a successful login. */
  async reset(email: string): Promise<void> {
    try {
      await this.redis.del(this.key(email));
    } catch (err) {
      this.logger.warn(`login throttle reset failed: ${String(err)}`);
    }
  }
}
