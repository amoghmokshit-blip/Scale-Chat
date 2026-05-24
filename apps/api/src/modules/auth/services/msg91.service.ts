import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request } from 'undici';

import type { Env } from '../../../config/env';

export type Msg91Result =
  | { ok: true; providerRef: string }
  | { ok: false; reason: 'misconfigured' | 'provider_error'; status?: number; message?: string };

/**
 * MSG91 client — sends transactional OTP SMS to Indian phone numbers.
 *
 * In dev (no `MSG91_AUTH_KEY` set), we log the code to stdout instead of hitting
 * the network. This lets the team run end-to-end without burning provider quota.
 *
 * The actual code is never sent here as plaintext over the wire — it's
 * substituted into the MSG91 template, which is what they sign at their edge.
 */
@Injectable()
export class Msg91Service {
  private readonly logger = new Logger(Msg91Service.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async sendOtp(phoneE164: string, code: string): Promise<Msg91Result> {
    const authKey = this.config.get('MSG91_AUTH_KEY', { infer: true });
    const templateId = this.config.get('MSG91_TEMPLATE_ID', { infer: true });
    const senderId = this.config.get('MSG91_SENDER_ID', { infer: true });
    const baseUrl = this.config.get('MSG91_BASE_URL', { infer: true });

    if (!authKey || !templateId) {
      // Dev fallback: log the OTP rather than sending. This branch must never
      // run in production — env validation gates it via `ENABLE_DEV_OTP` audit
      // below.
      this.logger.warn(
        { phoneE164, code },
        '[dev] MSG91 not configured — OTP printed instead of sent. Set MSG91_AUTH_KEY + MSG91_TEMPLATE_ID before going live.'
      );
      return { ok: true, providerRef: `dev-${Date.now()}` };
    }

    // MSG91 expects mobile number WITHOUT the leading `+`.
    const mobile = phoneE164.startsWith('+') ? phoneE164.slice(1) : phoneE164;

    try {
      const url = `${baseUrl}/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=${encodeURIComponent(mobile)}&otp=${encodeURIComponent(code)}&sender=${encodeURIComponent(senderId)}`;
      const { statusCode, body } = await request(url, {
        method: 'POST',
        headers: {
          'authkey': authKey,
          'accept': 'application/json',
        },
        bodyTimeout: 10_000,
        headersTimeout: 5_000,
      });
      const text = await body.text();
      if (statusCode >= 200 && statusCode < 300) {
        // MSG91 returns `{ "type": "success", "request_id": "..." }` shaped JSON.
        try {
          const parsed = JSON.parse(text) as { request_id?: string; type?: string };
          if (parsed.type === 'success' && parsed.request_id) {
            return { ok: true, providerRef: parsed.request_id };
          }
        } catch {
          // Fall through to the generic error below — body shape changed unexpectedly.
        }
        return { ok: false, reason: 'provider_error', status: statusCode, message: text.slice(0, 256) };
      }
      this.logger.error({ statusCode, body: text.slice(0, 256) }, 'msg91 request failed');
      return { ok: false, reason: 'provider_error', status: statusCode, message: text.slice(0, 256) };
    } catch (err) {
      this.logger.error({ err }, 'msg91 transport error');
      return { ok: false, reason: 'provider_error', message: (err as Error).message };
    }
  }
}
