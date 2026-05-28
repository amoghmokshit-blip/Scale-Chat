import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import type { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { Msg91Service } from '../msg91.service';
import {
  type OtpCheckArgs,
  type OtpCheckResult,
  type OtpStartArgs,
  type OtpStartResult,
  type OtpVerificationProvider,
} from './otp-verification.provider';

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP minimum
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Self-managed OTP provider — the path that ships in Phase 1.
 *
 * Generates a 4-digit code, argon2id-hashes it, stores
 * `{ hash, sessionRef, attempts, maxAttempts }` at `otp:<phoneE164>` in
 * Redis with the configured TTL, then sends via MSG91 (or logs it in dev
 * when creds are absent). Verifies by argon2-compare; preserves the TTL
 * across failed attempts so a slow attacker can't reset the clock; burns
 * the key on success.
 *
 * In Phase 2 this stays around as the offline/e2e fallback so tests run
 * without hitting the network.
 */
@Injectable()
export class DevVerifyProvider implements OtpVerificationProvider {
  private readonly logger = new Logger(DevVerifyProvider.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly msg91: Msg91Service,
  ) {}

  async start(args: OtpStartArgs): Promise<OtpStartResult> {
    const { phoneE164, sessionRef, ttlSeconds, maxAttempts } = args;

    const code = generateOtp();
    const hash = await argon2.hash(code, ARGON2_OPTS);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);

    await this.redis.set(
      keyFor(phoneE164),
      JSON.stringify({ hash, sessionRef, attempts: 0, maxAttempts }),
      'EX',
      ttlSeconds,
    );

    const send = await this.msg91.sendOtp(phoneE164, code);
    if (!send.ok) {
      await this.redis.del(keyFor(phoneE164));
      return { ok: false, reason: 'provider_error' };
    }

    return { ok: true, providerRef: send.providerRef, providerName: 'dev-msg91', expiresAt };
  }

  async check(args: OtpCheckArgs): Promise<OtpCheckResult> {
    const { phoneE164, code } = args;
    const key = keyFor(phoneE164);

    const raw = await this.redis.get(key);
    if (!raw) return { ok: false, reason: 'expired' };

    let state: { hash: string; sessionRef: string; attempts: number; maxAttempts: number };
    try {
      state = JSON.parse(raw);
    } catch {
      // Corrupt key — best-effort cleanup and treat as expired.
      await this.redis.del(key);
      return { ok: false, reason: 'expired' };
    }

    const nextAttempts = state.attempts + 1;

    if (nextAttempts > state.maxAttempts) {
      // Defensive: already exceeded on a prior call; void to be safe.
      await this.redis.del(key);
      return {
        ok: false,
        reason: 'attempts_exceeded',
        sessionRef: state.sessionRef,
        attempts: state.attempts,
      };
    }

    const matches = await argon2.verify(state.hash, code);
    if (!matches) {
      if (nextAttempts >= state.maxAttempts) {
        await this.redis.del(key);
        return {
          ok: false,
          reason: 'attempts_exceeded',
          sessionRef: state.sessionRef,
          attempts: nextAttempts,
        };
      }
      // Persist the consumed attempt so brute force still spends budget.
      // Preserve the original TTL — otherwise a slow attacker resets the clock.
      const remainingMs = await this.redis.pttl(key);
      const payload = JSON.stringify({ ...state, attempts: nextAttempts });
      if (remainingMs > 0) {
        await this.redis.set(key, payload, 'PX', remainingMs);
      } else {
        await this.redis.del(key);
      }
      return {
        ok: false,
        reason: 'invalid_code',
        sessionRef: state.sessionRef,
        attempts: nextAttempts,
      };
    }

    // Success path: burn first to make it impossible to replay even on a
    // slow user-upsert downstream.
    await this.redis.del(key);
    return { ok: true, sessionRef: state.sessionRef };
  }
}

function keyFor(phoneE164: string): string {
  return `otp:${phoneE164}`;
}

/** Cryptographically uniform 4-digit OTP, leading zeros preserved. */
function generateOtp(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}
