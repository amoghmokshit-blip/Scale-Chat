/**
 * Provider seam for OTP generation + delivery + verification.
 *
 *   - `DevVerifyProvider` owns argon2 hash + Redis state + MSG91 send.
 *     Used in development and e2e tests; remains the path when Twilio creds
 *     are absent so local devs boot without provisioning a Twilio account.
 *   - `TwilioVerifyProvider` calls Twilio Verify (managed). Used in production
 *     when `TWILIO_*` env vars are set. Twilio owns code generation, storage,
 *     attempts counter, and SMS routing.
 *
 * Selection happens at `AuthModule` bind time via a `useFactory`.
 *
 * `sessionRef` is the audit row's `requestId` (unique). Each provider stores
 * a phone → sessionRef mapping for the lifetime of one verification so the
 * check call can hand the ref back to OtpService for audit-row lookups.
 *
 * `providerName` is recorded on the `otp_requests.provider` column for audit
 * correlation across provider migrations.
 */

export type OtpStartResult =
  | { ok: true; providerRef: string; providerName: string; expiresAt: Date }
  | { ok: false; reason: 'provider_error' };

export type OtpCheckResult =
  | { ok: true; sessionRef: string }
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'invalid_code'; sessionRef: string; attempts?: number }
  | { ok: false; reason: 'attempts_exceeded'; sessionRef: string; attempts?: number };

export interface OtpStartArgs {
  phoneE164: string;
  sessionRef: string;
  ttlSeconds: number;
  maxAttempts: number;
}

export interface OtpCheckArgs {
  phoneE164: string;
  code: string;
}

export const OTP_VERIFICATION_PROVIDER = Symbol('OTP_VERIFICATION_PROVIDER');

export interface OtpVerificationProvider {
  start(args: OtpStartArgs): Promise<OtpStartResult>;
  check(args: OtpCheckArgs): Promise<OtpCheckResult>;
}
