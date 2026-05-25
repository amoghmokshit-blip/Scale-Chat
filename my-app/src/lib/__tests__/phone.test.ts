import {
  digitsOnly,
  formatIndianMobile,
  isValidIndianMobile,
  localDigitsFromE164,
  toE164India,
} from '@/lib/phone';

/**
 * phone tests — India-first validation/formatting (CLAUDE.md §3).
 *
 * Covers:
 *   • the +91 happy path on display + E.164 round-trip
 *   • rejection of landlines, foreign numbers, wrong-length input
 *   • the digitsOnly / localDigitsFromE164 sanitisers used by the OTP screen
 */

describe('digitsOnly', () => {
  it('strips spaces, parens, hyphens, dots', () => {
    expect(digitsOnly('+91 (90000) 12345')).toBe('919000012345');
    expect(digitsOnly('98765-43210')).toBe('9876543210');
    expect(digitsOnly('98.76.54.32.10')).toBe('9876543210');
  });

  it('returns empty for non-digit input', () => {
    expect(digitsOnly('')).toBe('');
    expect(digitsOnly('abc')).toBe('');
  });
});

describe('isValidIndianMobile', () => {
  it('accepts 10-digit mobile numbers starting with 6-9', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('8000012345')).toBe(true);
    expect(isValidIndianMobile('7400012345')).toBe(true);
    expect(isValidIndianMobile('6000012345')).toBe(true);
  });

  it('rejects landline prefixes (0-5)', () => {
    expect(isValidIndianMobile('0000012345')).toBe(false);
    expect(isValidIndianMobile('1234567890')).toBe(false);
    expect(isValidIndianMobile('5678901234')).toBe(false);
  });

  it('rejects wrong-length input', () => {
    expect(isValidIndianMobile('98765')).toBe(false);
    expect(isValidIndianMobile('98765432100')).toBe(false); // 11 digits
    expect(isValidIndianMobile('')).toBe(false);
  });

  it('tolerates user-typed formatting (spaces, dashes) during validation', () => {
    expect(isValidIndianMobile('98765 43210')).toBe(true);
    expect(isValidIndianMobile('98765-43210')).toBe(true);
  });

  // PR 6 — device-contacts feed via expo-contacts returns numbers in the format
  // users saved them, which on Indian phones is almost always E.164-prefixed.
  // toLocalDigits() strips +91/91 country codes and a legacy STD '0' prefix.
  it('accepts E.164-prefixed input from address books', () => {
    expect(isValidIndianMobile('+91 98765 43210')).toBe(true);
    expect(isValidIndianMobile('+91-98765-43210')).toBe(true);
    expect(isValidIndianMobile('+919876543210')).toBe(true);
    expect(isValidIndianMobile('919876543210')).toBe(true); // no leading +
  });

  it('strips the legacy STD "0" prefix Indian users sometimes save', () => {
    expect(isValidIndianMobile('09876543210')).toBe(true);
    expect(isValidIndianMobile('0 98765 43210')).toBe(true);
  });

  it('still rejects foreign or malformed E.164 input', () => {
    expect(isValidIndianMobile('+1 555 123 4567')).toBe(false); // US number
    expect(isValidIndianMobile('+91 12345 67890')).toBe(false); // 11 local digits, starts with 1
    expect(isValidIndianMobile('+91 ')).toBe(false); // empty after prefix
    // Note: "+91 1234 5678" (8 local digits) is intentionally NOT tested —
    // after digit-stripping it becomes "9112345678" (10 digits, mobile range),
    // ambiguous with a real 10-digit local. Better to accept than to falsely
    // reject every number that happens to start with 911234...
  });
});

describe('formatIndianMobile', () => {
  it('formats progressively as the user types', () => {
    expect(formatIndianMobile('9')).toBe('+91 9');
    expect(formatIndianMobile('98765')).toBe('+91 98765');
    expect(formatIndianMobile('987654')).toBe('+91 98765 4');
    expect(formatIndianMobile('9876543210')).toBe('+91 98765 43210');
  });

  it('drops anything past 10 digits', () => {
    expect(formatIndianMobile('98765432101234')).toBe('+91 98765 43210');
  });

  it('strips non-digit characters in input', () => {
    expect(formatIndianMobile('(98) 76-54-32 10')).toBe('+91 98765 43210');
  });
});

describe('toE164India', () => {
  it('returns +91XXXXXXXXXX for valid mobile numbers', () => {
    expect(toE164India('9876543210')).toBe('+919876543210');
    expect(toE164India('98765 43210')).toBe('+919876543210');
  });

  it('returns null for invalid input', () => {
    expect(toE164India('1234567890')).toBeNull(); // landline prefix
    expect(toE164India('98765')).toBeNull(); // too short
    expect(toE164India('')).toBeNull();
  });

  // PR 6 — every shape that device address books realistically produce
  // must round-trip to the same canonical `+919876543210` output.
  it('normalises every address-book shape to one canonical E.164', () => {
    const canonical = '+919876543210';
    expect(toE164India('+91 98765 43210')).toBe(canonical);
    expect(toE164India('+91-98765-43210')).toBe(canonical);
    expect(toE164India('+919876543210')).toBe(canonical); // already E.164
    expect(toE164India('919876543210')).toBe(canonical); // no plus
    expect(toE164India('09876543210')).toBe(canonical); // STD '0' prefix
    expect(toE164India('(+91) 98765-43210')).toBe(canonical); // parens
  });

  it('rejects foreign E.164 numbers', () => {
    expect(toE164India('+1 555 123 4567')).toBeNull();
    expect(toE164India('+44 7911 123456')).toBeNull();
  });
});

describe('localDigitsFromE164', () => {
  it('strips +91 prefix for display', () => {
    expect(localDigitsFromE164('+919876543210')).toBe('9876543210');
  });

  it('falls back to digit extraction for non-+91 inputs', () => {
    expect(localDigitsFromE164('+15551234567')).toBe('15551234567');
    expect(localDigitsFromE164('9876543210')).toBe('9876543210');
  });
});
