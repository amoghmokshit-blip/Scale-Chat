import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { type Redis } from 'ioredis';

import type { Env } from '../../config/env';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Global Redis module. Provides a single `ioredis` instance via the `REDIS_CLIENT`
 * token. Used by the OTP store, rate limiter, and (future) Socket.IO adapter.
 *
 * Connection params are tuned for Upstash:
 *   - `maxRetriesPerRequest: null` — required when this client is reused as the
 *     BullMQ blocking connection.
 *   - `enableReadyCheck: false` — Upstash doesn't advertise `INFO`.
 *   - `tls` is inferred from a `rediss://` URL.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Redis => {
        const url = config.get('REDIS_URL', { infer: true });
        const client = new IORedis(url, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          lazyConnect: false,
          retryStrategy(times) {
            return Math.min(times * 100, 2_000);
          },
        });
        client.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error('[redis] error', err);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
