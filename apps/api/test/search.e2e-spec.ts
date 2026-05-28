/**
 * P2-Search — GET /chats/:chatId/messages/search e2e suite.
 *
 * 6 cases:
 *   1. Match found, case-insensitive
 *   2. Tombstoned message excluded (DELETE ?scope=everyone)
 *   3. Message before clear excluded; message after clear included
 *   4. Non-member → 403 not_a_member
 *   5. Empty q → 400
 *   6. Cross-page cursor pagination — keyset correctness (25 messages, page 20 + page 5)
 */
import {
  authedInject,
  seedUser,
  setupTestApp,
  teardownTestApp,
  truncateAll,
  type SeededUser,
  type TestApp,
} from './setup-e2e';

let cliSeq = 0;
function cli(): string {
  return `search-cli-${Date.now()}-${(cliSeq += 1)}`;
}

describe('GET /chats/:chatId/messages/search', () => {
  let testApp: TestApp;
  let alice: SeededUser;
  let bob: SeededUser;
  let mallory: SeededUser;

  beforeAll(async () => {
    testApp = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await truncateAll(testApp.prisma);
    alice = await seedUser(testApp, { fullName: 'Alice', phoneE164: '+919111110001' });
    bob = await seedUser(testApp, { fullName: 'Bob', phoneE164: '+919111110002' });
    mallory = await seedUser(testApp, { fullName: 'Mallory', phoneE164: '+919111110003' });
  });

  /** Helper — create a 1-on-1 chat between alice and bob, return chatId. */
  async function openChat(initiator: SeededUser, peer: SeededUser): Promise<string> {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: initiator.accessToken,
      payload: { contactUserId: peer.id },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ chatId: string }>().chatId;
  }

  /** Helper — send a TEXT message, return the message id. */
  async function sendText(
    sender: SeededUser,
    chatId: string,
    text: string,
  ): Promise<string> {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: sender.accessToken,
      payload: { kind: 'TEXT', text, clientMessageId: cli() },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  // ─── Case 1 — match found, case-insensitive ─────────────────────────────

  it('Case 1 — returns hits case-insensitively, correct shape', async () => {
    const chatId = await openChat(alice, bob);
    await sendText(alice, chatId, 'Hello world');
    await sendText(bob, chatId, 'HELLO there');
    await sendText(alice, chatId, 'nothing matches');

    const res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages/search?q=hello`,
      token: alice.accessToken,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      items: Array<{
        messageId: string;
        sequence: string;
        snippet: string;
        createdAt: string;
        senderUserId: string;
      }>;
      meta: { nextCursor: string | null; hasMore: boolean };
    }>();

    // Both messages containing "hello" (case-insensitive) must appear.
    expect(body.items).toHaveLength(2);
    // Ordered desc by sequence — highest sequence first.
    const seqs = body.items.map((h) => BigInt(h.sequence));
    expect(seqs[0]).toBeGreaterThan(seqs[1]);

    // Each hit has required fields.
    for (const hit of body.items) {
      expect(hit.messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(hit.sequence).toMatch(/^\d+$/);
      expect(typeof hit.snippet).toBe('string');
      expect(hit.snippet.length).toBeGreaterThan(0);
      expect(typeof hit.createdAt).toBe('string');
      expect(hit.senderUserId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }

    // The "nothing matches" message should NOT appear.
    expect(body.items.every((h) => /hello/i.test(h.snippet))).toBe(true);

    // No next page for only 2 hits.
    expect(body.meta.hasMore).toBe(false);
    expect(body.meta.nextCursor).toBeNull();
  });

  // ─── Case 2 — tombstoned message excluded ───────────────────────────────

  it('Case 2 — deleted (tombstoned) messages are excluded from search results', async () => {
    const chatId = await openChat(alice, bob);
    const msgId = await sendText(alice, chatId, 'secret keyword');

    // Delete for everyone (within the 60-min edit window — we just created it).
    const del = await authedInject(testApp, {
      method: 'DELETE',
      url: `/chats/${chatId}/messages/${msgId}?scope=everyone`,
      token: alice.accessToken,
    });
    expect(del.statusCode).toBe(204);

    const res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages/search?q=keyword`,
      token: alice.accessToken,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: unknown[] }>();
    expect(body.items).toHaveLength(0);
  });

  // ─── Case 3 — message before clear excluded; after-clear included ────────

  it('Case 3 — messages sent before clearedAt are excluded; after-clear messages included', async () => {
    const chatId = await openChat(alice, bob);
    // Alice sends a message BEFORE she clears the chat.
    await sendText(alice, chatId, 'old searchable text');

    // Alice clears the chat — sets her clearedAt = NOW().
    const clearRes = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/clear`,
      token: alice.accessToken,
    });
    expect(clearRes.statusCode).toBe(200);

    // Bob sends a message AFTER alice cleared — alice should see it in search.
    await sendText(bob, chatId, 'new searchable text');

    // Alice searches: should see only the post-clear message.
    const res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages/search?q=searchable`,
      token: alice.accessToken,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ snippet: string }> }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].snippet).toMatch(/new searchable/i);
  });

  // ─── Case 4 — non-member → 403 ───────────────────────────────────────────

  it('Case 4 — non-member receives 403 not_a_member', async () => {
    const chatId = await openChat(alice, bob);
    await sendText(alice, chatId, 'some text');

    const res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages/search?q=some`,
      token: mallory.accessToken,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_a_member');
  });

  // ─── Case 5 — empty q → 400 ──────────────────────────────────────────────

  it('Case 5 — empty or missing q returns 400', async () => {
    const chatId = await openChat(alice, bob);

    // Empty string.
    const emptyRes = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages/search?q=`,
      token: alice.accessToken,
    });
    expect(emptyRes.statusCode).toBe(400);

    // Whitespace-only (should be trimmed to empty by zod .trim()).
    const wsRes = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages/search?q=${encodeURIComponent('   ')}`,
      token: alice.accessToken,
    });
    expect(wsRes.statusCode).toBe(400);
  });

  // ─── Case 7 — LIKE wildcard escaping ────────────────────────────────────

  it('Case 7 — LIKE metachar "_" matches only the literal char, not any char; "%" matches only literal "%"', async () => {
    const chatId = await openChat(alice, bob);

    // "userXname" should NOT match q=user_name (underscore is literal, not a
    // wildcard for any single char).
    await sendText(alice, chatId, 'call me at userXname');
    // Only this message should match.
    await sendText(bob, chatId, 'my handle is user_name');

    const res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages/search?q=${encodeURIComponent('user_name')}`,
      token: alice.accessToken,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ snippet: string }> }>();
    // Exactly one hit — the literal user_name message.
    expect(body.items).toHaveLength(1);
    expect(body.items[0].snippet).toContain('user_name');

    // Second assert: "%" does not act as a wildcard — "100 rupees" must NOT
    // match q=100%.
    const chatId2 = await openChat(alice, mallory);
    await sendText(alice, chatId2, '100 rupees');

    const res2 = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId2}/messages/search?q=${encodeURIComponent('100%')}`,
      token: alice.accessToken,
    });

    expect(res2.statusCode).toBe(200);
    const body2 = res2.json<{ items: unknown[] }>();
    expect(body2.items).toHaveLength(0);
  });

  // ─── Case 6 — cross-page cursor pagination ───────────────────────────────

  it('Case 6 — keyset cursor paginates correctly across 25 messages (20+5, no overlap)', async () => {
    const chatId = await openChat(alice, bob);

    // Send 25 messages that all contain the unique token "pageword".
    // Alternate senders so we exercise multi-sender searches.
    const sentIds: string[] = [];
    for (let i = 1; i <= 25; i++) {
      const sender = i % 2 === 0 ? bob : alice;
      const id = await sendText(sender, chatId, `pageword ${i}`);
      sentIds.push(id);
    }

    // ── Page 1: limit=20 ─────────────────────────────────────────────────
    const page1Res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages/search?q=pageword&limit=20`,
      token: alice.accessToken,
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = page1Res.json<{
      items: Array<{ messageId: string; sequence: string; snippet: string }>;
      meta: { nextCursor: string | null; hasMore: boolean };
    }>();

    expect(page1.items).toHaveLength(20);
    expect(page1.meta.hasMore).toBe(true);
    expect(page1.meta.nextCursor).not.toBeNull();

    const page1Ids = new Set(page1.items.map((h) => h.messageId));

    // ── Page 2: limit=20 with cursor from page 1 ─────────────────────────
    const encodedCursor = encodeURIComponent(page1.meta.nextCursor!);
    const page2Res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages/search?q=pageword&limit=20&cursor=${encodedCursor}`,
      token: alice.accessToken,
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = page2Res.json<{
      items: Array<{ messageId: string; sequence: string; snippet: string }>;
      meta: { nextCursor: string | null; hasMore: boolean };
    }>();

    expect(page2.items).toHaveLength(5);
    expect(page2.meta.hasMore).toBe(false);
    expect(page2.meta.nextCursor).toBeNull();

    // Core keyset correctness: no message appears on both pages.
    const page2Ids = page2.items.map((h) => h.messageId);
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }

    // All returned snippets must contain the search token.
    for (const hit of [...page1.items, ...page2.items]) {
      expect(hit.snippet.toLowerCase()).toContain('pageword');
    }
  });
});
