/**
 * Human-readable file size for Document/Video bubbles (Tranche 2.C).
 * Pure + Jest-testable; lives in `lib/` (logic, not a string — so not `copy.ts`).
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
