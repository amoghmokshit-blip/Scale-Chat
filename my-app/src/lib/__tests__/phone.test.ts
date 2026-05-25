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
