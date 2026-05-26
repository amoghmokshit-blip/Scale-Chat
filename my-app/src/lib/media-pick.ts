/**
 * Pure validation for picked Document/Video files (Tranche 2.C).
 *
 * Lives in `lib/` (no React / native imports) so it's Jest-testable. The MIME
 * allowlist + size cap are INJECTED by the caller (`chat/[id].tsx` passes the
 * shared `DOCUMENT_CONTENT_TYPES` / `*_MAX_BYTES` from `@scalechat/shared`) —
 * we don't import those constants here because a runtime value-import of
 * `@scalechat/shared` breaks the Jest module graph (it resolves to TS source
 * with `.js` specifiers). Keeping the rules as args also makes the unit tests
 * trivial.
 *
 * The stricter DOCUMENT/VIDEO server validators reject: non-allowlisted MIME,
 * size ≤ 0, size > cap. expo-document-picker / expo-image-picker frequently
 * return a missing or `application/octet-stream` MIME on Android, so we fall
 * back to deriving the MIME from the file extension before rejecting.
 */

export type MediaPickRules = {
  /** Allowed MIME types (the shared per-kind allowlist). */
  allowedMimes: readonly string[];
  /** Max size in bytes (the shared per-kind cap). */
  maxBytes: number;
};

export type MediaPickInput = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
};

export type MediaPickResult =
  | { ok: true; mimeType: string; sizeBytes: number }
  | { ok: false; reason: 'unsupported_type' | 'empty' | 'too_large' };

/** Extension → MIME fallback for the kinds 2.C supports, used only when the
 *  picker omits/garbles the MIME. Kept narrow (not a general mime-db). */
const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

function extensionOf(nameOrUri: string): string | null {
  const clean = nameOrUri.split('?')[0]!.split('#')[0]!;
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return null;
  return clean.slice(dot + 1).toLowerCase();
}

/** Resolve a usable, allowlisted MIME for a picked file, or null if none fits. */
export function resolveMime(input: MediaPickInput, allowedMimes: readonly string[]): string | null {
  const reported = input.mimeType?.toLowerCase();
  if (reported && reported !== 'application/octet-stream' && allowedMimes.includes(reported)) {
    return reported;
  }
  const ext = extensionOf(input.fileName ?? input.uri);
  const fromExt = ext ? EXT_TO_MIME[ext] : undefined;
  if (fromExt && allowedMimes.includes(fromExt)) return fromExt;
  return null;
}

export function validateMediaPick(input: MediaPickInput, rules: MediaPickRules): MediaPickResult {
  const mimeType = resolveMime(input, rules.allowedMimes);
  if (!mimeType) return { ok: false, reason: 'unsupported_type' };
  const sizeBytes = input.sizeBytes ?? 0;
  if (sizeBytes <= 0) return { ok: false, reason: 'empty' };
  if (sizeBytes > rules.maxBytes) return { ok: false, reason: 'too_large' };
  return { ok: true, mimeType, sizeBytes };
}

/** Truncate a filename to `max` chars while preserving its extension. The
 *  server caps `documentTitle` at 255 — a longer name would 400. */
export function truncateFileName(name: string, max = 255): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name.slice(0, max);
  const ext = name.slice(dot); // includes the dot
  if (ext.length >= max) return name.slice(0, max);
  return name.slice(0, max - ext.length) + ext;
}
