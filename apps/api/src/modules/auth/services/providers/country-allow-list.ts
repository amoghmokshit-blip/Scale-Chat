import { Logger } from '@nestjs/common';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

const logger = new Logger('CountryAllowList');

/**
 * Phase-2 country gate for the OTP request endpoint.
 *
 * Why: an unauthenticated worldwide OTP `send` is the prime target for
 * SMS-pumping / Artificially Inflated Traffic — bad actors collude with
 * carriers to drive OTPs to premium-rate numbers. A country allow-list is
 * the highest-leverage defense because it rejects *before any provider
 * spend*. (Twilio Fraud Guard + Geo-Permissions are the belt-and-suspenders
 * layer — configured in the Twilio console.)
 *
 * Empty list = allow all (the dev/test default). Set
 * `OTP_ALLOWED_COUNTRIES=IN,US,GB` in prod to enforce.
 *
 * The list values are ISO 3166-1 alpha-2 codes (matches libphonenumber-js).
 */
export class CountryAllowList {
  private readonly allowed: ReadonlySet<CountryCode>;
  readonly enforced: boolean;

  constructor(raw: string) {
    const parsed = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) as CountryCode[];
    this.allowed = new Set(parsed);
    this.enforced = this.allowed.size > 0;
  }

  /**
   * `null` ⇒ allowed (either list is empty, or phone parses + country is on the list).
   * `string` ⇒ a short tag explaining the rejection (`unparseable` | the disallowed ISO code).
   */
  rejectionReasonFor(phoneE164: string): string | null {
    if (!this.enforced) return null;

    const parsed = parsePhoneNumberFromString(phoneE164);
    if (!parsed || !parsed.country) {
      logger.warn({ phoneE164 }, 'country-allow-list: could not derive country from phone');
      return 'unparseable';
    }
    if (!this.allowed.has(parsed.country)) {
      return parsed.country;
    }
    return null;
  }
}
