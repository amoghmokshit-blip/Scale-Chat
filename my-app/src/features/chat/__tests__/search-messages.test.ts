/**
 * searchMessages pure-logic tests (P2-Search).
 *
 * Tests the `searchMessages` helper from `search-message-utils.ts` — the same
 * logic the mock repository delegates to. No RN render, no MMKV, no native
 * modules (mirrors the `poll-vote-math.test.ts` pattern).
 *
 * Covers:
 *   - Case-insensitive substring match
 *   - Excludes deleted messages
 *   - Respects `limit`
 *   - Returns correct `{ items, meta }` shape
 *   - Cursor-based pagination
 *   - Each hit carries the required fields
 *   - Results sorted by sequence descending
 */

import { makeSnippet, searchMessages } from '@/features/chat/data/search-message-utils';
import type { SearchableMessage } from '@/features/chat/data/search-message-utils';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

function msg(
  overrides: Partial<SearchableMessage> & Pick<SearchableMessage, 'id' | 'sequence' | 'text'>,
): SearchableMessage {
  return {
    type: 'text',
    senderId: 'me',
    createdAt: new Date(2026, 0, overrides.sequence, 10, 0, 0).toISOString(),
    deletedAt: null,
    ...overrides,
  };
}

const MESSAGES: SearchableMessage[] = [
  msg({ id: 'm1', sequence: 1, text: 'Hey! How\'s it going?', senderId: 'c-peer' }),
  msg({ id: 'm2', sequence: 2, text: 'Nothing much. Just scrolling.' }),
  msg({ id: 'm3', sequence: 3, text: 'Same here. Had lunch?', senderId: 'c-peer' }),
  msg({ id: 'm4', sequence: 4, text: 'Yeah, late one 😅 You?' }),
  msg({ id: 'm5', sequence: 5, text: 'Skipped it. Coffee saved me.', senderId: 'c-peer' }),
  msg({ id: 'm6', sequence: 6, text: 'Sure. Ping me.' }),
  // Deleted — should be excluded even if it matches the query.
  msg({ id: 'm7', sequence: 7, text: 'This is deleted content — hey there', deletedAt: new Date().toISOString() }),
  // Non-text — should be excluded (type is not 'text').
  { id: 'm8', sequence: 8, type: 'voice', senderId: 'me', createdAt: new Date().toISOString(), deletedAt: null },
];

// ─── makeSnippet ────────────────────────────────────────────────────────────────

describe('makeSnippet', () => {
  it('returns the text when it fits within 40 chars and no match found', () => {
    const out = makeSnippet('Short text', 'NOTFOUND');
    expect(out).toBe('Short text');
  });

  it('returns a window ±20 chars around the first match', () => {
    const text = 'A'.repeat(30) + 'hello' + 'B'.repeat(30);
    const snippet = makeSnippet(text, 'hello');
    expect(snippet).toContain('hello');
    expect(snippet.length).toBeLessThan(text.length);
  });

  it('adds leading ellipsis when the match is not at the start', () => {
    const text = 'XXXXXXXXXXXXXXXXXXXXXXXXHEY there';
    const snippet = makeSnippet(text, 'hey');
    expect(snippet.startsWith('…')).toBe(true);
  });

  it('adds trailing ellipsis when the match is not at the end', () => {
    const text = 'HEY' + 'X'.repeat(30);
    const snippet = makeSnippet(text, 'HEY');
    expect(snippet.endsWith('…')).toBe(true);
  });
});

// ─── searchMessages ────────────────────────────────────────────────────────────

describe('searchMessages', () => {
  it('returns a { items, meta } shaped page', () => {
    const page = searchMessages(MESSAGES, 'hey');
    expect(page).toHaveProperty('items');
    expect(page).toHaveProperty('meta');
    expect(page.meta).toHaveProperty('hasMore');
    expect(page.meta).toHaveProperty('nextCursor');
    expect(Array.isArray(page.items)).toBe(true);
  });

  it('matches case-insensitively', () => {
    const lower = searchMessages(MESSAGES, 'hey');
    const upper = searchMessages(MESSAGES, 'HEY');
    expect(lower.items.length).toBe(upper.items.length);
    expect(lower.items.length).toBeGreaterThan(0);
  });

  it('returns only text messages that contain the query', () => {
    const page = searchMessages(MESSAGES, 'scrolling');
    expect(page.items.length).toBeGreaterThan(0);
    for (const hit of page.items) {
      expect(hit.snippet.toLowerCase()).toContain('scroll');
    }
  });

  it('returns empty items when no messages match', () => {
    const page = searchMessages(MESSAGES, 'zzznomatch123');
    expect(page.items).toHaveLength(0);
    expect(page.meta.hasMore).toBe(false);
    expect(page.meta.nextCursor).toBeNull();
  });

  it('excludes deleted messages', () => {
    // m7 is deleted and contains "hey" — it should not appear.
    const page = searchMessages(MESSAGES, 'hey');
    const ids = page.items.map((h) => h.messageId);
    expect(ids).not.toContain('m7');
  });

  it('excludes non-text messages', () => {
    // m8 is a voice message — should never appear even for a broad query.
    const page = searchMessages(MESSAGES, 'e');
    const ids = page.items.map((h) => h.messageId);
    expect(ids).not.toContain('m8');
  });

  it('respects the limit option', () => {
    const page = searchMessages(MESSAGES, 'e', { limit: 2 });
    expect(page.items.length).toBeLessThanOrEqual(2);
  });

  it('sets hasMore=true and nextCursor when there are more results', () => {
    // limit=1 with a broad query ('e' matches most messages).
    const page = searchMessages(MESSAGES, 'e', { limit: 1 });
    expect(page.meta.hasMore).toBe(true);
    expect(page.meta.nextCursor).not.toBeNull();
  });

  it('sets hasMore=false and nextCursor=null when all results fit in the page', () => {
    const page = searchMessages(MESSAGES, 'scrolling');
    expect(page.meta.hasMore).toBe(false);
    expect(page.meta.nextCursor).toBeNull();
  });

  it('each hit carries messageId, sequence, snippet, createdAt, senderUserId', () => {
    const page = searchMessages(MESSAGES, 'hey');
    expect(page.items.length).toBeGreaterThan(0);
    for (const hit of page.items) {
      expect(typeof hit.messageId).toBe('string');
      expect(hit.messageId.length).toBeGreaterThan(0);
      expect(typeof hit.sequence).toBe('string');
      expect(/^\d+$/.test(hit.sequence)).toBe(true);
      expect(typeof hit.snippet).toBe('string');
      expect(hit.snippet.length).toBeGreaterThan(0);
      expect(typeof hit.createdAt).toBe('string');
      expect(typeof hit.senderUserId).toBe('string');
    }
  });

  it('returns results sorted by sequence descending (newest first)', () => {
    const page = searchMessages(MESSAGES, 'e', { limit: 20 });
    const seqs = page.items.map((h) => Number(h.sequence));
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i - 1]).toBeGreaterThanOrEqual(seqs[i]!);
    }
  });

  it('cursor-based pagination: second page excludes first-page items', () => {
    const first = searchMessages(MESSAGES, 'e', { limit: 2 });
    expect(first.meta.hasMore).toBe(true);
    expect(first.meta.nextCursor).not.toBeNull();

    const second = searchMessages(MESSAGES, 'e', {
      limit: 2,
      cursor: first.meta.nextCursor!,
    });

    const firstIds = new Set(first.items.map((h) => h.messageId));
    for (const hit of second.items) {
      expect(firstIds.has(hit.messageId)).toBe(false);
    }
  });

  it('maps senderId "me" to the provided myId', () => {
    const page = searchMessages(MESSAGES, 'scrolling', {}, 'user-uuid-abc');
    // m2 is sent by 'me', so senderUserId should be replaced.
    expect(page.items[0]?.senderUserId).toBe('user-uuid-abc');
  });
});
