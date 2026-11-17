import { LoginThrottleService } from './login-throttle.service';

function build() {
  const redis = {
    get: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
  };
  const service = new LoginThrottleService(redis as never);
  return { service, redis };
}

describe('LoginThrottleService', () => {
  it('normalizes email into the key', async () => {
    const { service, redis } = build();
    redis.get.mockResolvedValueOnce(null);
    await service.isLocked('  A@B.com ');
    expect(redis.get).toHaveBeenCalledWith('login:fail:a@b.com');
  });

  it('is not locked below the threshold', async () => {
    const { service, redis } = build();
    redis.get.mockResolvedValueOnce('9');
    expect(await service.isLocked('a@b.com')).toBe(false);
  });

  it('is locked at the threshold', async () => {
    const { service, redis } = build();
    redis.get.mockResolvedValueOnce('10');
    expect(await service.isLocked('a@b.com')).toBe(true);
  });

  it('fails open when Redis read throws', async () => {
    const { service, redis } = build();
    redis.get.mockRejectedValueOnce(new Error('down'));
    expect(await service.isLocked('a@b.com')).toBe(false);
  });

  it('sets the window TTL only on the first failure', async () => {
    const { service, redis } = build();
    redis.incr.mockResolvedValueOnce(1);
    await service.recordFailure('a@b.com');
    expect(redis.expire).toHaveBeenCalledWith('login:fail:a@b.com', 900);

    redis.incr.mockResolvedValueOnce(2);
    redis.expire.mockClear();
    await service.recordFailure('a@b.com');
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('reset clears the key', async () => {
    const { service, redis } = build();
    await service.reset('A@b.com');
    expect(redis.del).toHaveBeenCalledWith('login:fail:a@b.com');
  });

  it('recordFailure swallows Redis errors', async () => {
    const { service, redis } = build();
    redis.incr.mockRejectedValueOnce(new Error('down'));
    await expect(service.recordFailure('a@b.com')).resolves.toBeUndefined();
  });
});
