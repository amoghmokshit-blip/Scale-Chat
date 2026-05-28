/**
 * Pure search helpers for the mock `searchMessages` implementation (P2-Search).
 *
 * Extracted into its own file (parallel to `poll-vote-math.ts`) so the unit
 * tests can import this without pulling in MMKV / `@scalechat/shared` values /
 * native modules — Jest's `node` environment can't load those.
 */

export type SearchableMessage = {
  id: string;
  sequence: number;
  createdAt: string;
  senderId: string;
  type: string;
  text?: string;
  deletedAt?: string | null;
};

export type SearchHit = {
  messageId: string;
  sequence: string;
  snippet: string;
  createdAt: string;
  senderUserId: string;
};

export type SearchPage = {
  items: SearchHit[];
  meta: { nextCursor: string | null; hasMore: boolean };
};

/** Build a short snippet with ±20 chars around the first match. */
export function makeSnippet(text: string, keyword: string): string {
  const lKeyword = keyword.toLowerCase();
  const idx = text.toLowerCase().indexOf(lKeyword);
  if (idx < 0) return text.slice(0, 40);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + keyword.length + 20);
  const snippet = text.slice(start, end);
  return `${start > 0 ? '…' : ''}${snippet}${end < text.length ? '…' : ''}`;
}

/**
 * Run a case-insensitive substring search over `messages`.
 *
 * @param messages   All messages for the thread (from mock state).
 * @param q          Search keyword.
 * @param opts.cursor  Exclusive upper-bound on sequence (for pagination).
 * @param opts.limit   Page size (default 20).
 * @param myId       The local user's id so we can set senderUserId correctly.
 */
export function searchMessages(
  messages: SearchableMessage[],
  q: string,
  opts: { cursor?: string; limit?: number } = {},
  myId = 'mock-me-id',
): SearchPage {
  const lq = q.toLowerCase();
  const limit = opts.limit ?? 20;

  // Filter: text-only, not deleted, case-insensitive substring match.
  const matched = messages.filter(
    (m) => !m.deletedAt && m.type === 'text' && (m.text ?? '').toLowerCase().includes(lq),
  );

  // Sort newest first (sequence DESC).
  const sorted = [...matched].sort((a, b) => b.sequence - a.sequence);

  // Cursor: sequence of the last item in the previous page — exclude everything ≥ it.
  const cursorSeq = opts.cursor ? Number(opts.cursor) : null;
  const afterCursor = cursorSeq !== null
    ? sorted.filter((m) => m.sequence < cursorSeq)
    : sorted;

  const page = afterCursor.slice(0, limit);
  const hasMore = afterCursor.length > limit;
  const lastItem = page[page.length - 1];
  const nextCursor = hasMore && lastItem ? String(lastItem.sequence) : null;

  const items: SearchHit[] = page.map((m) => ({
    messageId: m.id,
    sequence: String(m.sequence),
    snippet: makeSnippet(m.text ?? '', q),
    createdAt: m.createdAt,
    senderUserId: m.senderId === 'me' ? myId : m.senderId,
  }));

  return { items, meta: { nextCursor, hasMore } };
}
