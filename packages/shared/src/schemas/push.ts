import { z } from 'zod';

/**
 * Push device registration (Tranche 2.I — call wakeup).
 *
 * The mobile client registers its Expo push token on app start so the backend
 * can wake a backgrounded callee on `call:ring`. Platform drives nothing on the
 * server today (Expo's push service fans out to FCM/APNs) but is stored for
 * future per-platform tuning + diagnostics.
 *
 *   - POST   /push/tokens          body: RegisterPushTokenBody → 204
 *   - DELETE /push/tokens/:token   (logout cleanup) → 204
 */

export const DevicePlatformEnum = z.enum(['IOS', 'ANDROID']);
export type DevicePlatform = z.infer<typeof DevicePlatformEnum>;

export const RegisterPushTokenSchema = z.object({
  // Expo push tokens look like `ExponentPushToken[xxxxxxxx]`; keep the bound
  // loose (LiveKit/Expo formats evolve) but cap to the VarChar(200) column.
  expoPushToken: z.string().min(1).max(200),
  platform: DevicePlatformEnum,
});
export type RegisterPushTokenBody = z.infer<typeof RegisterPushTokenSchema>;
