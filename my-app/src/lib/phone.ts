import { parsePhoneNumberFromString } from 'libphonenumber-js';

const IN_REGION = 'IN' as const;

/** Strip all non-digits from raw user input. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Reduce any common Indian phone-input shape to exactly 10 local digits.
 *
 * Handles the formats that real device address books produce — users save
 * their contacts as:
 *   • "9876543210"          → "9876543210"  (bare local)
 *   • "98765 43210"         → "9876543210"  (formatted local)
 *   • "+91 98765 43210"     → "9876543210"  (E.164 with country code)
 *   • "+91-98765-43210"     → "9876543210"  (E.164 with separators)
 *   • "919876543210"        → "9876543210"  (country code, no plus)
 *   • "09876543210"         → "9876543210"  (legacy STD prefix)
 *
 * Returns the 10-digit slice when recognisable, else the raw cleaned digits
 * so the caller's length check can still reject it.
 */
function toLocalDigits(value: string): string {
  let cleaned = digitsOnly(value);
  // E.164 / country-code prefix: 12 digits starting with "91"
  if (cleaned.length === 12 && cleaned.startsWith('91')) cleaned = cleaned.slice(2);
  // Legacy STD prefix: 11 digits starting with "0"
  else if (cleaned.length === 11 && cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  return cleaned;
}

/** True when the input resolves to a valid Indian mobile (mobile-only, not landline). */
export function isValidIndianMobile(localDigits: string): boolean {
  const cleaned = toLocalDigits(localDigits);
  if (cleaned.length !== 10) return false;
  // Indian mobile numbers start with 6, 7, 8, or 9.
  if (!/^[6-9]/.test(cleaned)) return false;
  const parsed = parsePhoneNumberFromString(`+91${cleaned}`, IN_REGION);
  return parsed?.isValid() === true;
}

/** Format 10 local digits as "+91 XXXXX XXXXX" for display. */
export function formatIndianMobile(localDigits: string): string {
  const cleaned = digitsOnly(localDigits).slice(0, 10);
  if (cleaned.length <= 5) return `+91 ${cleaned}`;
  return `+91 ${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
}

/** Return E.164 form for any Indian-mobile input (see `toLocalDigits`), or null. */
export function toE164India(localDigits: string): string | null {
  if (!isValidIndianMobile(localDigits)) return null;
  return `+91${toLocalDigits(localDigits)}`;
}

/** Pull the 10 local digits out of an E.164 +91 number. */
export function localDigitsFromE164(e164: string): string {
  if (e164.startsWith('+91')) return e164.slice(3);
  return digitsOnly(e164);
}

/** The server's CONTACT_CARD E.164 contract (`packages/shared` messages.ts). */
const E164_RE = /^\+[1-9]\d{7,14}$/;

/**
 * Normalize an arbitrary device-contact phone string to E.164, or null if it
 * can't be made valid. Unlike `toE164India` this is NOT India-only: a bare
 * local number defaults to the IN region (→ `+91…`), but an already-
 * international number (`+1…`, `+44…`) is preserved. Used by the CONTACT_CARD
 * picker — gated on the server's E.164 regex so we never send a number the
 * backend validator would reject with 400. (`toE164India` is intentionally
 * stricter — Indian mobiles only — so it must NOT be used here.)
 */
export function toE164Loose(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw, IN_REGION);
  if (!parsed || !parsed.isValid()) return null;
  const e164 = parsed.number;
  return E164_RE.test(e164) ? e164 : null;
}
