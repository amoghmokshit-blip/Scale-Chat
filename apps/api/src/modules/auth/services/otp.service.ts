import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import type { Env } from '../../../config/env';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RateLimitService } from '../../../common/rate-limit/rate-limit.service';
import { CountryAllowList } from './providers/country-allow-list';
import {
  OTP_VERIFICATION_PROVIDER,
  type OtpVerificationProvider,
} from './providers/otp-verification.provider';

export type OtpRequestOutcome =
  | {
      ok: true;
      requestId: string;
      expiresAt: Date;
      cooldownMs: number;
    }
  | {
      ok: false;
      reason: 'rate_limited_phone' | 'rate_limited_ip' | 'provider_error' | 'country_not_supported';
      retryAfterMs?: number;
    };

const HOUR_MS = 60 * 60 * 1_000;

/**
 * Provider-agnostic OTP orchestration.
 *
 * Owns:
 *   - country allow-list (SMS-pumping defense — rejects before any provider call)
 *   - per-phone + per-IP rate limits
 *   - `otp_requests` audit row + `providerRef` + `provider` correlation
 *   - security events (rate-limit hits, max-attempts hits, country rejects)
 *   - User upsert on successful verify
 *
 * Delegates to `OtpVerificationProvider`:
 *   - code generation, hashing, storage, SMS send, attempts counter
 *
 * The audit row's `requestId` is reused as the provider's `sessionRef`,
 * so on a check we look the row back up by `requestId` (unique).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly allowList: CountryAllowList;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    @Inject(OTP_VERIFICATION_PROVIDER) private readonly provider: OtpVerificationProvider,
  ) {
    this.allowList = new CountryAllowList(this.config.get('OTP_ALLOWED_COUNTRIES', { infer: true }));
    if (this.allowList.enforced) {
      this.logger.log({ enforced: true }, 'otp country allow-list enforced');
    } else if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      this.logger.warn(
        'OTP_ALLOWED_COUNTRIES is empty in production — all destinations accepted. ' +
          'Set the env to your launched markets to enable SMS-pumping defense.',
      );
    }
  }

  async request(args: {
    phoneE164: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<OtpRequestOutcome> {
    const { phoneE164, ipAddress, userAgent } = args;

    // 1. Country allow-list — rejects BEFORE any provider call (AIT defense).
    const countryReject = this.allowList.rejectionReasonFor(phoneE164);
    if (countryReject !== null) {
      await this.recordSecurityEvent('OTP_COUNTRY_BLOCKED', { phoneE164, ipAddress, country: countryReject });
      return { ok: false, reason: 'country_not_supported' };
    }

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

    const requestId = randomUUID();
    const ttlSeconds = this.config.get('OTP_TTL_SECONDS', { infer: true });
    const maxAttempts = this.config.get('OTP_VERIFY_MAX_ATTEMPTS', { infer: true });

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
        expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
      },
      select: { id: true },
    });

    const started = await this.provider.start({
      phoneE164,
      sessionRef: requestId,
      ttlSeconds,
      maxAttempts,
    });

    if (!started.ok) {
      await this.prisma.otpRequest.update({
        where: { id: otpRow.id },
        data: { status: 'FAILED' },
      });
      return { ok: false, reason: 'provider_error' };
    }

    await this.prisma.otpRequest.update({
      where: { id: otpRow.id },
      data: { providerRef: started.providerRef, provider: started.providerName },
    });

    return {
      ok: true,
      requestId,
      expiresAt: started.expiresAt,
      cooldownMs: HOUR_MS / phoneLimit,
    };
  }

  async verify(args: {
    phoneE164: string;
    code: string;
  }): Promise<
    | { ok: true; userId: string; isNewUser: boolean }
    | { ok: false; reason: 'invalid_code' | 'expired' | 'attempts_exceeded' }
  > {
    const { phoneE164, code } = args;

    const checked = await this.provider.check({ phoneE164, code });

    if (!checked.ok) {
      if (checked.reason !== 'expired') {
        // Build the audit-row update conditionally — Twilio doesn't expose its
        // own attempt counter, so `attempts` is optional on the result.
        const update = {
          ...(checked.reason === 'attempts_exceeded' ? { status: 'FAILED' as const } : {}),
          ...(checked.attempts !== undefined ? { attempts: checked.attempts } : {}),
        };
        if (Object.keys(update).length > 0) {
          await this.prisma.otpRequest
            .update({ where: { requestId: checked.sessionRef }, data: update })
            .catch((err) => {
              this.logger.warn({ err }, 'otp.verify: attempt counter update failed (non-fatal)');
            });
        }
        if (checked.reason === 'attempts_exceeded') {
          await this.recordSecurityEvent('OTP_MAX_ATTEMPTS_HIT', {
            phoneE164,
            requestId: checked.sessionRef,
          });
        }
      }
      return { ok: false, reason: checked.reason };
    }

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

    await this.prisma.otpRequest
      .update({
        where: { requestId: checked.sessionRef },
        data: { status: 'VERIFIED', verifiedAt: new Date(), userId: user.id },
      })
      .catch((err) => {
        // Audit failure is non-fatal — the user is verified, we just lost a row update.
        this.logger.error({ err }, 'otp.verify: otp_requests update failed (non-fatal)');
      });

    return { ok: true, userId: user.id, isNewUser };
  }

  private async recordSecurityEvent(
    kind: 'OTP_RATE_LIMIT_HIT' | 'OTP_MAX_ATTEMPTS_HIT' | 'OTP_COUNTRY_BLOCKED',
    metadata: Record<string, unknown>,
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
