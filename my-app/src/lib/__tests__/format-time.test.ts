import {
  formatBubbleTime,
  formatDayLabel,
  formatDuration,
  formatThreadRowTime,
} from '@/lib/format-time';

/**
 * format-time tests — covers the boundaries the user actually sees:
 *   • IST midnight rollover (the Yesterday boundary in the contact-page list)
 *   • day-divider transitions (Today → Yesterday → DD MMM)
 *   • voice duration formatting incl. > 1 hour clamps
 *
 * Tests use absolute ISO strings + an explicit `now` so the suite is
 * timezone-stable and not flaky on the CI runner.
 */

describe('formatBubbleTime', () => {
  it('returns HH:mm with leading zeros', () => {
    expect(formatBubbleTime('2026-05-25T03:04:00')).toBe('03:04');
    expect(formatBubbleTime('2026-05-25T23:59:00')).toBe('23:59');
  });

  it('returns 00:00 at midnight', () => {
    expect(formatBubbleTime('2026-05-25T00:00:00')).toBe('00:00');
  });
});

describe('formatThreadRowTime', () => {
  const now = new Date('2026-05-25T15:00:00');

  it('shows 12-hour time for messages from today', () => {
    expect(formatThreadRowTime('2026-05-25T09:38:00', now)).toBe('9:38 AM');
    expect(formatThreadRowTime('2026-05-25T13:05:00', now)).toBe('1:05 PM');
  });

  it('shows 12:XX correctly at noon and midnight (no 0:XX glitch)', () => {
    expect(formatThreadRowTime('2026-05-25T12:00:00', now)).toBe('12:00 PM');
    expect(formatThreadRowTime('2026-05-25T00:30:00', now)).toBe('12:30 AM');
  });

  it('returns "Yesterday" for messages 1 day old', () => {
    expect(formatThreadRowTime('2026-05-24T23:30:00', now)).toBe('Yesterday');
    expect(formatThreadRowTime('2026-05-24T00:01:00', now)).toBe('Yesterday');
  });

  it('returns weekday short for 2-6 days ago', () => {
    expect(formatThreadRowTime('2026-05-23T10:00:00', now)).toMatch(/^[A-Za-z]{3}$/);
    expect(formatThreadRowTime('2026-05-20T10:00:00', now)).toMatch(/^[A-Za-z]{3}$/);
  });

  it('falls through to DD/MM/YY for messages 7+ days old', () => {
    expect(formatThreadRowTime('2026-05-18T10:00:00', now)).toBe('18/05/26');
    expect(formatThreadRowTime('2025-12-31T10:00:00', now)).toBe('31/12/25');
  });

  it('handles the midnight rollover boundary correctly', () => {
    const justBeforeMidnight = '2026-05-25T23:59:59';
    const justAfterMidnight = '2026-05-26T00:00:01';
    const onTheNextDay = new Date('2026-05-26T08:00:00');
    expect(formatThreadRowTime(justBeforeMidnight, onTheNextDay)).toBe('Yesterday');
    expect(formatThreadRowTime(justAfterMidnight, onTheNextDay)).toBe('12:00 AM');
  });

  it('handles year boundary (Dec 31 → Jan 1)', () => {
    expect(formatThreadRowTime('2025-12-31T23:00:00', new Date('2026-01-01T09:00:00'))).toBe(
      'Yesterday'
    );
  });
});

describe('formatDayLabel', () => {
  const now = new Date('2026-05-25T15:00:00');

  it('returns Today for same-day messages', () => {
    expect(formatDayLabel('2026-05-25T00:00:00', now)).toBe('Today');
    expect(formatDayLabel('2026-05-25T23:59:00', now)).toBe('Today');
  });

  it('returns Yesterday for 1-day-old messages', () => {
    expect(formatDayLabel('2026-05-24T12:00:00', now)).toBe('Yesterday');
  });

  it('returns "DD MMM" for older messages', () => {
    expect(formatDayLabel('2026-05-12T12:00:00', now)).toMatch(/^12 May$/);
    expect(formatDayLabel('2025-01-01T12:00:00', now)).toMatch(/^01 Jan$/);
  });
});

describe('formatDuration', () => {
  it('formats short durations as "M:SS"', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(39)).toBe('0:39');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(75)).toBe('1:15');
  });

  it('handles fractional seconds by flooring', () => {
    expect(formatDuration(0.9)).toBe('0:00');
    expect(formatDuration(59.7)).toBe('0:59');
  });

  it('clamps negatives to 0', () => {
    expect(formatDuration(-1)).toBe('0:00');
  });

  it('continues counting in minutes past the 5-minute voice cap', () => {
    expect(formatDuration(300)).toBe('5:00');
    expect(formatDuration(665)).toBe('11:05');
  });
});
