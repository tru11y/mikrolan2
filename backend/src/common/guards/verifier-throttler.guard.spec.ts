import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerModuleOptions,
  ThrottlerStorage,
  ThrottlerStorageService,
  seconds,
} from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { VerifierThrottlerGuard } from './verifier-throttler.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  // Minimal shape the guard reads from ThrottlerGuard's internals.
  const res = { header: () => undefined } as unknown as Record<string, unknown>;
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => (function h(): void {}) as unknown as (...args: unknown[]) => unknown,
    getClass: () => (class H {}) as unknown as new (...args: unknown[]) => unknown,
  } as unknown as ExecutionContext;
}

async function makeGuard(
  storage?: ThrottlerStorage,
): Promise<VerifierThrottlerGuard> {
  const opts: ThrottlerModuleOptions = {
    throttlers: [{ name: 'default', limit: 20, ttl: seconds(60) }],
  };
  const reflector = new Reflector();
  const guard = new VerifierThrottlerGuard(
    opts,
    storage ?? new ThrottlerStorageService(),
    reflector,
  );
  // ThrottlerGuard initializes `this.throttlers` from the module options
  // during onModuleInit — not auto-called outside Nest's DI lifecycle.
  await (guard as unknown as { onModuleInit: () => Promise<void> }).onModuleInit();
  return guard;
}

describe('VerifierThrottlerGuard — per-vendor keying', () => {
  describe('getTracker (unit)', () => {
    let g: VerifierThrottlerGuard;
    beforeAll(async () => {
      g = await makeGuard();
    });
    const call = (
      req: Record<string, unknown>,
    ): Promise<string> =>
      (g as unknown as {
        getTracker: (r: Record<string, unknown>) => Promise<string>;
      }).getTracker(req);

    it('keys on the authenticated userId, not on the request IP', async () => {
      const user = { userId: 'U1', tenantId: 'T1', role: UserRole.TICKET_VERIFIER };
      // Same user, two different IPs → same tracker key.
      const k1 = await call({ user, ip: '10.0.0.1' });
      const k2 = await call({ user, ip: '203.0.113.9' });
      expect(k1).toBe(k2);
      expect(k1).toBe('verify:user:U1');
    });

    it('two different vendors behind the same IP get DIFFERENT keys', async () => {
      const sameIp = '10.0.0.1';
      const kA = await call({
        user: { userId: 'UA', tenantId: 'T1', role: UserRole.TICKET_VERIFIER },
        ip: sameIp,
      });
      const kB = await call({
        user: { userId: 'UB', tenantId: 'T1', role: UserRole.TICKET_VERIFIER },
        ip: sameIp,
      });
      expect(kA).not.toBe(kB);
      expect(kA).toBe('verify:user:UA');
      expect(kB).toBe('verify:user:UB');
    });

    it('never includes the request body (ticketCode) in the key', async () => {
      const user = { userId: 'U1', tenantId: 'T1', role: UserRole.TICKET_VERIFIER };
      const k1 = await call({ user, ip: '1.1.1.1', body: { ticketCode: 'ABC' } });
      const k2 = await call({ user, ip: '1.1.1.1', body: { ticketCode: 'XYZ' } });
      expect(k1).toBe(k2);
      expect(k1).not.toContain('ABC');
      expect(k1).not.toContain('XYZ');
    });

    it('falls back to IP if req.user is missing (defense in depth)', async () => {
      const k = await call({ ip: '198.51.100.4' });
      expect(k).toBe('verify:anon:198.51.100.4');
    });

    it('fallback never includes a JWT or secret', async () => {
      const k = await call({
        ip: '1.2.3.4',
        headers: { authorization: 'Bearer SECRET-JWT' },
      });
      expect(k).not.toContain('SECRET-JWT');
      expect(k).not.toMatch(/Bearer/i);
    });
  });

  describe('canActivate against real in-memory storage', () => {
    it('allows exactly 20 verifications for a single vendor, blocks the 21st (429)', async () => {
      const storage = new ThrottlerStorageService();
      const guard = await makeGuard(storage);
      const req = {
        user: { userId: 'U-STRESS', tenantId: 'T1', role: UserRole.TICKET_VERIFIER },
        ip: '10.0.0.1',
      };
      for (let i = 0; i < 20; i++) {
        await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
      }
      await expect(guard.canActivate(ctx(req))).rejects.toThrow();
    });

    it('two vendors behind the same IP keep INDEPENDENT quotas', async () => {
      const storage = new ThrottlerStorageService();
      const guard = await makeGuard(storage);
      const sharedIp = '10.0.0.1';
      const uA = { userId: 'U-A', tenantId: 'T1', role: UserRole.TICKET_VERIFIER };
      const uB = { userId: 'U-B', tenantId: 'T1', role: UserRole.TICKET_VERIFIER };
      // Vendor A exhausts their quota.
      for (let i = 0; i < 20; i++) {
        await expect(
          guard.canActivate(ctx({ user: uA, ip: sharedIp })),
        ).resolves.toBe(true);
      }
      await expect(
        guard.canActivate(ctx({ user: uA, ip: sharedIp })),
      ).rejects.toThrow();
      // Vendor B on the same IP is unaffected.
      await expect(
        guard.canActivate(ctx({ user: uB, ip: sharedIp })),
      ).resolves.toBe(true);
    });

    it('the same vendor cannot reset their quota by switching IPs', async () => {
      const storage = new ThrottlerStorageService();
      const guard = await makeGuard(storage);
      const user = { userId: 'U-ROAM', tenantId: 'T1', role: UserRole.TICKET_VERIFIER };
      for (let i = 0; i < 20; i++) {
        await expect(
          guard.canActivate(ctx({ user, ip: '10.0.0.1' })),
        ).resolves.toBe(true);
      }
      // Change the IP: quota must still be exhausted.
      await expect(
        guard.canActivate(ctx({ user, ip: '203.0.113.9' })),
      ).rejects.toThrow();
      await expect(
        guard.canActivate(ctx({ user, ip: '198.51.100.9' })),
      ).rejects.toThrow();
    });
  });

  describe('ignores @SkipThrottle on the handler', () => {
    it('shouldSkip() always returns false (local guard must not be skipped)', async () => {
      const g = await makeGuard();
      const skip = await (
        g as unknown as { shouldSkip: () => Promise<boolean> }
      ).shouldSkip();
      expect(skip).toBe(false);
    });
  });
});
