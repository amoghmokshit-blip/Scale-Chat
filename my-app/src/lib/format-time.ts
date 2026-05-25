/**
 * Date/time formatting helpers — India-first defaults per CLAUDE.md §3.
 * - 24-hour `HH:mm` for in-day timestamps.
 * - `Yesterday` / `DD/MM/YY` for older messages (matches Figma chat list).
 */

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** "18:27" style for individual message timestamps. */
export function formatBubbleTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Chat-list timestamps:
 *   - Today        → "9:38 PM" (12-hour, leading-zero stripped)
 *   - Yesterday    → "Yesterday"
 *   - Older same week → weekday short name ("Mon")
 *   - Otherwise    → "DD/MM/YY"
 */
export function formatThreadRowTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const dayDiff = Math.floor(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000
  );
  if (dayDiff <= 0) {
    let hours = d.getHours();
    const minutes = pad(d.getMinutes());
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${hours}:${minutes} ${ampm}`;
  }
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) {
    return d.toLocaleDateString('en-IN', { weekday: 'short' });
  }
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

/** "Today" / "Yesterday" / "12 May" day-divider label inside a chat thread. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const dayDiff = Math.floor(
    (startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000
  );
  if (dayDiff <= 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** "0:39" — used for voice notes. Clamps negatives so a stray clock-skew or
 *  null-coalesced default never renders as "-1:59" in a bubble. */
export function formatDuration(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped - m * 60);
  return `${m}:${pad(s)}`;
}
