import { resolveMime, truncateFileName, validateMediaPick } from '@/lib/media-pick';

// Mirrors the shared DOCUMENT/VIDEO allowlists + caps the caller injects.
const DOC_MIMES = [
  'application/pdf',
  'application/msword',
  'text/csv',
  'application/zip',
] as const;
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
const DOC_MAX = 100 * 1024 * 1024;
const VIDEO_MAX = 80 * 1024 * 1024;

describe('resolveMime', () => {
  it('keeps a reported MIME that is in the allowlist', () => {
    expect(resolveMime({ uri: 'f.pdf', mimeType: 'application/pdf' }, DOC_MIMES)).toBe('application/pdf');
  });

  it('falls back to the extension when MIME is missing', () => {
    expect(resolveMime({ uri: 'file:///x/report.pdf', mimeType: null }, DOC_MIMES)).toBe('application/pdf');
  });

  it('falls back to the extension when MIME is generic octet-stream', () => {
    expect(
      resolveMime({ uri: 'a.mp4', mimeType: 'application/octet-stream', fileName: 'clip.mp4' }, VIDEO_MIMES),
    ).toBe('video/mp4');
  });

  it('maps .mov to video/quicktime (the picker rarely emits that string)', () => {
    expect(resolveMime({ uri: 'a.mov', mimeType: undefined }, VIDEO_MIMES)).toBe('video/quicktime');
  });

  it('returns null when neither MIME nor extension is allowlisted', () => {
    expect(resolveMime({ uri: 'a.exe', mimeType: 'application/x-msdownload' }, DOC_MIMES)).toBeNull();
    expect(resolveMime({ uri: 'a.gif', mimeType: 'image/gif' }, VIDEO_MIMES)).toBeNull();
  });
});

describe('validateMediaPick', () => {
  const rules = { allowedMimes: DOC_MIMES, maxBytes: DOC_MAX };

  it('accepts a valid document', () => {
    expect(validateMediaPick({ uri: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 248_000 }, rules)).toEqual({
      ok: true,
      mimeType: 'application/pdf',
      sizeBytes: 248_000,
    });
  });

  it('rejects unsupported type', () => {
    expect(validateMediaPick({ uri: 'a.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 }, rules)).toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
  });

  it('rejects a 0-byte / missing-size file (server requires positive size)', () => {
    expect(validateMediaPick({ uri: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 0 }, rules).ok).toBe(false);
    expect(validateMediaPick({ uri: 'r.pdf', mimeType: 'application/pdf' }, rules)).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('rejects an over-cap file', () => {
    expect(
      validateMediaPick({ uri: 'big.mp4', mimeType: 'video/mp4', sizeBytes: VIDEO_MAX + 1 }, { allowedMimes: VIDEO_MIMES, maxBytes: VIDEO_MAX }),
    ).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('truncateFileName', () => {
  it('leaves short names unchanged', () => {
    expect(truncateFileName('report.pdf')).toBe('report.pdf');
  });

  it('truncates a long name while preserving the extension + staying ≤ max', () => {
    const long = `${'a'.repeat(300)}.pdf`;
    const out = truncateFileName(long, 255);
    expect(out.length).toBeLessThanOrEqual(255);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});
