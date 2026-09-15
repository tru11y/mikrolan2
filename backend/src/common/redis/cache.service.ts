import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class CacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const val = await this.redis.get(key);
    if (!val) return null;
    return JSON.parse(val) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    const keys = await this.redis.keys(`${prefix}*`);
    if (keys.length) await this.redis.del(...keys);
  }
}
