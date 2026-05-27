import { z } from 'zod';

/**
 * Runtime env schema. Validated once at startup — fail-fast on misconfig.
 * Every env var the app reads must be declared here; if it isn't here, it isn't used.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_PRIVATE_KEY_B64: z.string().min(1, 'JWT_PRIVATE_KEY_B64 is required (base64 PEM)'),
  JWT_PUBLIC_KEY_B64: z.string().min(1, 'JWT_PUBLIC_KEY_B64 is required (base64 PEM)'),
  JWT_ISSUER: z.string().default('scalechat'),
  JWT_AUDIENCE: z.string().default('scalechat-mobile'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  MSG91_AUTH_KEY: z.string().optional().default(''),
  MSG91_SENDER_ID: z.string().default('SCLCHT'),
  MSG91_TEMPLATE_ID: z.string().optional().default(''),
  MSG91_BASE_URL: z.string().url().default('https://control.msg91.com'),

  OTP_REQUEST_PER_PHONE_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_REQUEST_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(20),
  OTP_VERIFY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  ENABLE_DEV_OTP: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'))
    .default(false),
  DEV_OTP_CODE: z.string().regex(/^\d{4}$/).default('1234'),

  ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    ),

  // ─── Cloudflare R2 object storage (chat media) ────────────────────────────
  //
  // Backs the `/media/upload-url` endpoint. Clients PUT raw bytes directly to
  // the presigned URL — the API never touches media bytes. Optional in dev so
  // local devs can boot without provisioning a bucket; the media controller
  // returns 503 when these are unset.
  R2_ENDPOINT: z.string().url().optional(),
  R2_BUCKET: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  // ─── LiveKit (calls provider, Tranche 2.H PR-2) ───────────────────────────
  //
  // Backs `/calls/token` + the LiveKit webhook. All three optional so local
  // devs boot without creds — the calls module then runs in STUB MODE
  // (synthetic rooms + dev tokens not valid against LiveKit; see
  // `livekit.client.ts` + `docs/architecture/calls-provider-poc.md` §8.1).
  // LIVEKIT_URL is the wss client URL (e.g. wss://<project>.livekit.cloud);
  // the server RoomServiceClient converts it to https internally.
  //
  // BULLMQ_RING_TIMEOUT_MS: per-call ring window (30s); tests shorten it so the
  // suite doesn't wait the full window.
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  // ─── Expo push (call wakeup, Tranche 2.I) ─────────────────────────────────
  // Optional: Expo push works without a token for low volume; the access token
  // raises rate limits. APNs slots are iOS-later scaffold (enable when the
  // Apple Developer Program lands — see docs/architecture/ios-enablement-checklist.md).
  EXPO_ACCESS_TOKEN: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_KEY_P8_B64: z.string().optional(),
  BULLMQ_RING_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Decode + validate the process env. Exported as a singleton so the app reads it once.
 * Throws on any validation error — the loader catches it and exits the process.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${formatted}`);
  }
  // Refuse to start prod with dev-OTP enabled — a misconfig that would let anyone log in.
  if (parsed.data.NODE_ENV === 'production' && parsed.data.ENABLE_DEV_OTP) {
    throw new Error('ENABLE_DEV_OTP must be false when NODE_ENV=production');
  }
  return parsed.data;
}
