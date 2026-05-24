import { z } from 'zod';

/** OTP length used across the auth flow. Mirror of `OTP_LENGTH` in the mobile app. */
export const OTP_DIGITS = 4;

const e164India = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile in E.164 form');

export const OtpRequestSchema = z.object({
  phoneE164: e164India,
});
export type OtpRequestBody = z.infer<typeof OtpRequestSchema>;

export const OtpRequestResponseSchema = z.object({
  requestId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  /** ms left in the per-phone rate-limit window. */
  cooldownMs: z.number().int().nonnegative(),
});
export type OtpRequestResponse = z.infer<typeof OtpRequestResponseSchema>;

export const OtpVerifySchema = z.object({
  phoneE164: e164India,
  code: z.string().regex(new RegExp(`^\\d{${OTP_DIGITS}}$`), `OTP must be ${OTP_DIGITS} digits`),
  /** Device fingerprint (UUID generated client-side, persisted to MMKV). */
  deviceId: z.string().min(8).max(128),
});
export type OtpVerifyBody = z.infer<typeof OtpVerifySchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access token TTL in seconds — clients use this to schedule pre-emptive refresh. */
  accessExpiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(16),
});
export type RefreshBody = z.infer<typeof RefreshBodySchema>;
