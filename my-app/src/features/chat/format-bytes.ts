/**
 * Human-readable byte count for storage totals (Manage Storage screen).
 * Handles 0 B / KB / MB / GB — unlike `lib/format-size` which is tailored
 * to file-size labels (KB minimum, no GB). Pure + Jest-testable; no RN deps.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}
