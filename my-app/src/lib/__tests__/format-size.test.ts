import { formatFileSize } from '@/lib/format-size';

describe('formatFileSize', () => {
  it('renders 0/invalid as "0 KB"', () => {
    expect(formatFileSize(0)).toBe('0 KB');
    expect(formatFileSize(-5)).toBe('0 KB');
    expect(formatFileSize(NaN)).toBe('0 KB');
  });

  it('renders small files in KB (min 1)', () => {
    expect(formatFileSize(500)).toBe('1 KB');
    expect(formatFileSize(248_000)).toBe('242 KB');
  });

  it('renders MB with one decimal under 10 MB', () => {
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('renders MB with no decimal at/above 10 MB', () => {
    expect(formatFileSize(42 * 1024 * 1024)).toBe('42 MB');
  });
});
