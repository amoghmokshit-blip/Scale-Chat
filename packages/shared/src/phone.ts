import type { E164Phone } from './branded.js';

/**
 * India-first phone helpers used by both client and server. Pure functions only
 * so this module remains zero-cost in both runtimes.
 */

const INDIA_MOBILE_E164 = /^\+91[6-9]\d{9}$/;

export function isValidIndianMobileE164(value: string): value is E164Phone {
  return INDIA_MOBILE_E164.test(value);
}

/** Throwing parser for cases where the caller already knows it should be valid. */
export function assertIndianMobileE164(value: string): E164Phone {
  if (!isValidIndianMobileE164(value)) {
    throw new Error(`Invalid Indian mobile (E.164): ${value}`);
  }
  return value;
}

/** Format an E.164 +91 number as "+91 XXXXX XXXXX" for display. */
export function formatIndianMobile(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  const local = digits.startsWith('91') ? digits.slice(2) : digits;
  if (local.length !== 10) return e164;
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}
