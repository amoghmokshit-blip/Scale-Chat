import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.module';

export type RateLimitResult = {
  /** True when the call was *within* the limit (i.e. allowed). */
  allowed: boolean;
  /** How many calls inside the current window after this one. */
  count: number;
  /** Configured ceiling. */
  limit: number;
  /** Window length in ms (echoed back so callers don't have to re-derive). */
  windowMs: number;
  /** Milliseconds until the soonest in-window entry ages out. */
  resetInMs: number;
};

/**
 * Redis-backed sliding-window rate limiter. We use a ZSET keyed by
 * `ratelimit:<key>` with score = epoch ms. A pipeline does:
 *
 *   1. `ZREMRANGEBYSCORE … 0 (now-windowMs)`  — purge expired entries
 *   2. `ZADD now now:nonce`                   — record this call
 *   3. `ZCARD …`                              — read current count
 *   4. `PEXPIRE …, windowMs`                  — keep TTL fresh
 *
 * This is *fail-open* on Redis errors — the alternative is hard-failing every
 * call when Redis blips. The Anomaly detector picks up sustained Redis loss
 * via the health check separately.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - windowMs;
    const member = `${now}:${cryptoRandom()}`;

    try {
      const [, , countResult] = (await this.redis
        .multi()
        .zremrangebyscore(`ratelimit:${key}`, 0, cutoff)
        .zadd(`ratelimit:${key}`, now, member)
        .zcard(`ratelimit:${key}`)
        .pexpire(`ratelimit:${key}`, windowMs)
        .exec()) as [Error | null, unknown][];

      const count = Number(countResult?.[1] ?? 0);
      const oldest = await this.redis.zrange(`ratelimit:${key}`, 0, 0, 'WITHSCORES');
      const oldestMs = oldest.length === 2 ? Number(oldest[1]) : now;
      const resetInMs = Math.max(0, oldestMs + windowMs - now);

      return {
        allowed: count <= limit,
        count,
        limit,
        windowMs,
        resetInMs,
      };
    } catch {
      // Fail-open. We log via the caller, since they know the business context.
      return { allowed: true, count: 0, limit, windowMs, resetInMs: 0 };
    }
  }
}

function cryptoRandom(): string {
  // Avoid `crypto.randomUUID()` so we don't import node:crypto in every limiter call.
  return Math.random().toString(36).slice(2, 10);
}
