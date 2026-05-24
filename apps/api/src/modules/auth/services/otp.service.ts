import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

import type { Env } from '../../../config/env';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RateLimitService } from '../../../common/rate-limit/rate-limit.service';
import { Msg91Service } from './msg91.service';

export type OtpRequestOutcome =
  | {
      ok: true;
      requestId: string;
      expiresAt: Date;
      cooldownMs: number;
    }
  | {
      ok: false;
      reason: 'rate_limited_phone' | 'rate_limited_ip' | 'provider_error';
      retryAfterMs?: number;
    };

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP minimum
  timeCost: 2,
  parallelism: 1,
} as const;

const HOUR_MS = 60 * 60 * 1_000;

/**
 * Stateful service handling OTP issuance + (eventual) verification.
 *
 * Storage:
 *   - Redis key `otp:<phoneE164>` stores `{ hash, requestId, attempts, otpRequestRowId }`
 *     with the configured TTL (default 300s).
 *   - Postgres `otp_requests` row is created in parallel so we have a durable audit
 *     trail even after Redis expires the key.
 *
 * Rate limits:
 *   - per phone: configurable, default 5/hour
 *   - per IP:    configurable, default 20/hour
 *   - verify attempts: hard cap of 5 (configurable), then the OTP is voided.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly rateLimit: RateLimitService,
    private readonly msg91: Msg91Service,
  ) {}

  async request(args: {
    phoneE164: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<OtpRequestOutcome> {
    const { phoneE164, ipAddress, userAgent } = args;

    const phoneLimit = this.config.get('OTP_REQUEST_PER_PHONE_PER_HOUR', { infer: true });
    const ipLimit = this.config.get('OTP_REQUEST_PER_IP_PER_HOUR', { infer: true });

    const phoneCheck = await this.rateLimit.consume(`otp:phone:${phoneE164}`, phoneLimit, HOUR_MS);
    if (!phoneCheck.allowed) {
      await this.recordSecurityEvent('OTP_RATE_LIMIT_HIT', { phoneE164, ipAddress, scope: 'phone' });
      return { ok: false, reason: 'rate_limited_phone', retryAfterMs: phoneCheck.resetInMs };
    }

    if (ipAddress) {
      const ipCheck = await this.rateLimit.consume(`otp:ip:${ipAddress}`, ipLimit, HOUR_MS);
      if (!ipCheck.allowed) {
        await this.recordSecurityEvent('OTP_RATE_LIMIT_HIT', { phoneE164, ipAddress, scope: 'ip' });
        return { ok: false, reason: 'rate_limited_ip', retryAfterMs: ipCheck.resetInMs };
      }
    }

    const code = generateOtp();
    const hash = await argon2.hash(code, ARGON2_OPTS);
    const requestId = randomUUID();
    const ttlSeconds = this.config.get('OTP_TTL_SECONDS', { infer: true });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);

    // Look up the user if they already exist — informs the audit row.
    const user = await this.prisma.user.findUnique({
      where: { phoneE164 },
      select: { id: true },
    });

    const otpRow = await this.prisma.otpRequest.create({
      data: {
        phoneE164,
        userId: user?.id ?? null,
        requestId,
        ipAddress: ipAddress?.slice(0, 64) ?? null,
        userAgent: userAgent?.slice(0, 256) ?? null,
        expiresAt,
      },
      select: { id: true },
    });

    await this.redis.set(
      `otp:${phoneE164}`,
      JSON.stringify({ hash, requestId, attempts: 0, otpRequestRowId: otpRow.id }),
      'EX',
      ttlSeconds
    );

    const send = await this.msg91.sendOtp(phoneE164, code);
    if (!send.ok) {
      // Roll back state so the user can retry without the limiter counting it.
      await this.redis.del(`otp:${phoneE164}`);
      await this.prisma.otpRequest.update({
        where: { id: otpRow.id },
        data: { status: 'FAILED' },
      });
      return { ok: false, reason: 'provider_error' };
    }

    await this.prisma.otpRequest.update({
      where: { id: otpRow.id },
      data: { providerRef: send.providerRef },
    });

    return {
      ok: true,
      requestId,
      expiresAt,
      cooldownMs: HOUR_MS / phoneLimit,
    };
  }

  /**
   * Verify an OTP code presented by the client.
   *
   * Flow:
   *   1. Read `otp:<phoneE164>` from Redis — absent means the OTP either
   *      expired (TTL) or was already burned. Either way → `expired`.
   *   2. Increment attempts atomically. If >= configured cap, void the OTP
   *      key, log a security event, and refuse with `attempts_exceeded`.
   *   3. argon2-verify the provided code against the stored hash. Wrong code →
   *      `invalid_code` (the increment from step 2 still stands, so brute force
   *      consumes the attempt budget).
   *   4. Burn the OTP (`DEL`) so it can't be replayed even within its TTL.
   *   5. Upsert the User row (create on first verify) and mark the OtpRequest
   *      row VERIFIED with `verifiedAt`. Return `userId` + `isNewUser` so the
   *      controller can decide whether to surface a "complete your profile" hint.
   */
  async verify(args: {
    phoneE164: string;
    code: string;
  }): Promise<
    | { ok: true; userId: string; isNewUser: boolean }
    | { ok: false; reason: 'invalid_code' | 'expired' | 'attempts_exceeded' }
  > {
    const { phoneE164, code } = args;
    const key = `otp:${phoneE164}`;

    const raw = await this.redis.get(key);
    if (!raw) return { ok: false, reason: 'expired' };

    let state: { hash: string; requestId: string; attempts: number; otpRequestRowId: string };
    try {
      state = JSON.parse(raw);
    } catch {
      // Corrupt key — best-effort cleanup and treat as expired.
      await this.redis.del(key);
      return { ok: false, reason: 'expired' };
    }

    const maxAttempts = this.config.get('OTP_VERIFY_MAX_ATTEMPTS', { infer: true });
    const nextAttempts = state.attempts + 1;

    if (nextAttempts > maxAttempts) {
      // Already exceeded on a prior call; void to be safe.
      await this.redis.del(key);
      return { ok: false, reason: 'attempts_exceeded' };
    }

    const matches = await argon2.verify(state.hash, code);
    if (!matches) {
      if (nextAttempts >= maxAttempts) {
        await this.redis.del(key);
        await this.prisma.otpRequest.update({
          where: { id: state.otpRequestRowId },
          data: { status: 'FAILED', attempts: nextAttempts },
        });
        await this.recordSecurityEvent('OTP_MAX_ATTEMPTS_HIT', { phoneE164, requestId: state.requestId });
        return { ok: false, reason: 'attempts_exceeded' };
      }
      // Persist the consumed attempt so brute force still spends budget.
      // Preserve the original TTL (otherwise a slow attacker resets the clock).
      const remainingMs = await this.redis.pttl(key);
      const payload = JSON.stringify({ ...state, attempts: nextAttempts });
      if (remainingMs > 0) {
        await this.redis.set(key, payload, 'PX', remainingMs);
      } else {
        // TTL gone — treat as expired and burn.
        await this.redis.del(key);
      }
      await this.prisma.otpRequest.update({
        where: { id: state.otpRequestRowId },
        data: { attempts: nextAttempts },
      }).catch((err) => {
        this.logger.warn({ err }, 'otp.verify: attempt counter update failed (non-fatal)');
      });
      return { ok: false, reason: 'invalid_code' };
    }

    // Success path: burn first to make it impossible to replay even on a slow upsert.
    await this.redis.del(key);

    const before = await this.prisma.user.findUnique({
      where: { phoneE164 },
      select: { id: true },
    });
    const isNewUser = before === null;

    const user = await this.prisma.user.upsert({
      where: { phoneE164 },
      create: { phoneE164, fullName: '' },
      update: {},
      select: { id: true },
    });

    await this.prisma.otpRequest.update({
      where: { id: state.otpRequestRowId },
      data: { status: 'VERIFIED', verifiedAt: new Date(), attempts: nextAttempts, userId: user.id },
    }).catch((err) => {
      // Audit failure is non-fatal — the user is verified, we just lost a row update.
      this.logger.error({ err }, 'otp.verify: otp_requests update failed (non-fatal)');
    });

    return { ok: true, userId: user.id, isNewUser };
  }

  private async recordSecurityEvent(
    kind:
      | 'OTP_RATE_LIMIT_HIT'
      | 'OTP_MAX_ATTEMPTS_HIT',
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.prisma.securityEvent.create({
        data: {
          kind,
          phoneE164: typeof metadata.phoneE164 === 'string' ? metadata.phoneE164 : null,
          ipAddress: typeof metadata.ipAddress === 'string' ? metadata.ipAddress : null,
          metadata: metadata as object,
        },
      });
    } catch (err) {
      // Audit log failure must not break the user flow — but we want to know.
      this.logger.error({ err, kind, metadata }, 'failed to record security event');
    }
  }
}

/** Cryptographically uniform 4-digit OTP, leading zeros preserved. */
function generateOtp(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}
