import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { request } from 'undici';

import type { Env } from '../../../../config/env';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import {
  type OtpCheckArgs,
  type OtpCheckResult,
  type OtpStartArgs,
  type OtpStartResult,
  type OtpVerificationProvider,
} from './otp-verification.provider';

const TWILIO_BASE_URL = 'https://verify.twilio.com/v2';

/** Selected Twilio error codes we map deliberately. Reference: https://www.twilio.com/docs/api/errors */
const TWILIO_ERROR_CODES = {
  /** Max check attempts reached for this verification. */
  MAX_CHECK_ATTEMPTS_REACHED: 60202,
  /** Max send attempts reached on this number (rate-limited at Twilio). */
  MAX_SEND_ATTEMPTS_REACHED: 60203,
  /** Geo-Permissions blocked this destination. */
  GEO_PERMISSION_BLOCKED: 60600,
} as const;

interface TwilioVerificationResponse {
  sid: string;
  status: 'pending' | 'approved' | 'canceled';
  to: string;
  channel: string;
  valid: boolean;
}

interface TwilioErrorResponse {
  code?: number;
  message?: string;
  status?: number;
  more_info?: string;
}

/**
 * Production OTP provider — delegates code generation, storage, delivery,
 * and the attempts counter to Twilio Verify.
 *
 * Twilio is idempotent per (Verify Service, phone): if a verification is
 * already pending, `verifications.create` returns the existing one. The
 * audit row + idempotency guard on our side still trip first via the
 * `OtpService` rate-limit gate.
 *
 * We maintain one extra Redis key (`otp-session:<phoneE164>`) for the
 * lifetime of a verification so `check()` can look the audit row back up
 * by `sessionRef`. The key TTL matches the verification window we
 * advertise to clients; Twilio's own server-side window is longer by
 * default, so both sides expire consistently from the user's POV.
 *
 * Errors:
 *   - 5xx / transport → throws (controller surfaces a 500); rare and
 *     should page on-call.
 *   - 4xx with a Twilio error code → mapped (`expired` / `attempts_exceeded`
 *     / `provider_error`) or logged + treated as `invalid_code`.
 *   - 60202 (max check attempts) → `attempts_exceeded`.
 *   - 60600 (Geo-Permissions blocked) → `provider_error` on `start`. The
 *     country allow-list at `OtpService` should catch this before we ever
 *     hit Twilio; surfacing it from Twilio means the in-console
 *     Geo-Permissions diverged from our env list.
 */
@Injectable()
export class TwilioVerifyProvider implements OtpVerificationProvider {
  private readonly logger = new Logger(TwilioVerifyProvider.name);
  private readonly verifyServiceSid: string;
  private readonly basicAuth: string;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const accountSid = config.get('TWILIO_ACCOUNT_SID', { infer: true });
    const authToken = config.get('TWILIO_AUTH_TOKEN', { infer: true });
    const verifyServiceSid = config.get('TWILIO_VERIFY_SERVICE_SID', { infer: true });

    if (!accountSid || !authToken || !verifyServiceSid) {
      // `AuthModule`'s factory guards this — surfacing it here is defense in depth.
      throw new Error('TwilioVerifyProvider requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID');
    }

    this.verifyServiceSid = verifyServiceSid;
    this.basicAuth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  }

  async start(args: OtpStartArgs): Promise<OtpStartResult> {
    const { phoneE164, sessionRef, ttlSeconds } = args;
    const url = `${TWILIO_BASE_URL}/Services/${encodeURIComponent(this.verifyServiceSid)}/Verifications`;

    const body = new URLSearchParams({ To: phoneE164, Channel: 'sms' }).toString();

    const { statusCode, text } = await this.postForm(url, body);

    if (statusCode < 200 || statusCode >= 300) {
      const err = safeJsonParse<TwilioErrorResponse>(text);
      this.logger.error(
        { statusCode, code: err?.code, message: err?.message, phoneE164 },
        'twilio verifications.create failed',
      );
      return { ok: false, reason: 'provider_error' };
    }

    const parsed = safeJsonParse<TwilioVerificationResponse>(text);
    if (!parsed || parsed.status !== 'pending') {
      this.logger.error({ statusCode, body: text.slice(0, 256) }, 'twilio verifications.create unexpected response');
      return { ok: false, reason: 'provider_error' };
    }

    // Phone → sessionRef mapping so check() can correlate the audit row.
    // TTL matches the OTP window we expose to clients; Twilio's own retention
    // is longer by default, so our window is the user-visible one.
    await this.redis.set(sessionKey(phoneE164), sessionRef, 'EX', ttlSeconds);

    return {
      ok: true,
      providerRef: parsed.sid,
      providerName: 'twilio',
      expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
    };
  }

  async check(args: OtpCheckArgs): Promise<OtpCheckResult> {
    const { phoneE164, code } = args;

    const sessionRef = await this.redis.get(sessionKey(phoneE164));
    if (!sessionRef) {
      // No active verification (or expired on our side). Twilio may still
      // accept the code, but we can't correlate it back to an audit row.
      return { ok: false, reason: 'expired' };
    }

    const url = `${TWILIO_BASE_URL}/Services/${encodeURIComponent(this.verifyServiceSid)}/VerificationCheck`;
    const body = new URLSearchParams({ To: phoneE164, Code: code }).toString();

    const { statusCode, text } = await this.postForm(url, body);

    if (statusCode === 404) {
      // Verification not found — either expired, already approved, or canceled
      // due to max attempts. Twilio surfaces 60202 specifically for max attempts.
      const err = safeJsonParse<TwilioErrorResponse>(text);
      await this.redis.del(sessionKey(phoneE164));
      if (err?.code === TWILIO_ERROR_CODES.MAX_CHECK_ATTEMPTS_REACHED) {
        return { ok: false, reason: 'attempts_exceeded', sessionRef };
      }
      return { ok: false, reason: 'expired' };
    }

    if (statusCode < 200 || statusCode >= 300) {
      const err = safeJsonParse<TwilioErrorResponse>(text);
      this.logger.error(
        { statusCode, code: err?.code, message: err?.message, phoneE164 },
        'twilio verification.check failed',
      );
      if (err?.code === TWILIO_ERROR_CODES.MAX_CHECK_ATTEMPTS_REACHED) {
        await this.redis.del(sessionKey(phoneE164));
        return { ok: false, reason: 'attempts_exceeded', sessionRef };
      }
      // Conservative fallback: treat unknown 4xx as a bad code (user can retry).
      return { ok: false, reason: 'invalid_code', sessionRef };
    }

    const parsed = safeJsonParse<TwilioVerificationResponse>(text);
    if (parsed && parsed.status === 'approved' && parsed.valid === true) {
      await this.redis.del(sessionKey(phoneE164));
      return { ok: true, sessionRef };
    }

    // status='pending' + valid:false → wrong code, more attempts available.
    return { ok: false, reason: 'invalid_code', sessionRef };
  }

  /**
   * Small form-POST helper with basic-auth + timeouts matching `msg91.service`.
   * Throws on transport errors so the controller surfaces a 500 — those are
   * rare and signal that Twilio is unreachable.
   */
  private async postForm(url: string, body: string): Promise<{ statusCode: number; text: string }> {
    try {
      const response = await request(url, {
        method: 'POST',
        headers: {
          authorization: this.basicAuth,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
        bodyTimeout: 10_000,
        headersTimeout: 5_000,
      });
      const text = await response.body.text();
      return { statusCode: response.statusCode, text };
    } catch (err) {
      this.logger.error({ err, url }, 'twilio transport error');
      throw err;
    }
  }
}

function sessionKey(phoneE164: string): string {
  return `otp-session:${phoneE164}`;
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
