/**
 * 1-on-1 chat happy-path e2e — covers the Phase A+B+C surfaces that landed
 * pre-Tranche 1.B. Phase 2 features (Reactions / Edit / Forward / Search /
 * Stickers) extend this file as they ship.
 *
 * See `docs/progress/1-on-1-production.md` § Phase 4.1 for the running case
 * list. Cases that require Socket.IO broadcast assertions (3, 4, 5) are
 * marked `it.todo` for now — the wire shape is already covered by the
 * `MessageReportSchema` / read-receipt schema in `packages/shared`, and the
 * controllers call into the same gateway methods, so the missing piece is
 * just an in-test `socket.io-client` harness. Lands with PR 4 (reactions),
 * which needs an event-broadcast assertion anyway.
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

const TEXT = (s: string) => JSON.stringify({ kind: 'TEXT', text: s, clientMessageId: cli() });
let cliSeq = 0;
function cli(): string {
  return `cli-${Date.now()}-${(cliSeq += 1)}`;
}

describe('1-on-1 chat (REST happy path)', () => {
  let testApp: TestApp;
  let alice: SeededUser;
  let bob: SeededUser;
  let mallory: SeededUser; // a non-member used for negative cases

  beforeAll(async () => {
    testApp = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await truncateAll(testApp.prisma);
    alice = await seedUser(testApp, { fullName: 'Alice', phoneE164: '+919000010001' });
    bob = await seedUser(testApp, { fullName: 'Bob', phoneE164: '+919000010002' });
    mallory = await seedUser(testApp, { fullName: 'Mallory', phoneE164: '+919000010003' });
  });

  // ─── Case 1 — POST /chats/one-on-one is idempotent on the (alice, bob) pair ─

  it('POST /chats/one-on-one returns the same chatId on a retry', async () => {
    const first = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    expect(first.statusCode).toBe(201);
    const firstChatId = first.json<{ chatId: string }>().chatId;

    const second = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json<{ chatId: string }>().chatId).toBe(firstChatId);
  });

  // ─── Case 2 — POST /chats/:id/messages is idempotent on clientMessageId ───

  it('POST /chats/:id/messages dedups by clientMessageId', async () => {
    const create = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    const chatId = create.json<{ chatId: string }>().chatId;

    const clientMessageId = cli();
    const body = { kind: 'TEXT', text: 'hi bob', clientMessageId };

    const first = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json<{ id: string }>().id;

    const second = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: body,
    });
    expect(second.statusCode).toBe(201);
    expect(second.json<{ id: string }>().id).toBe(firstId);

    const list = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages?limit=10`,
      token: bob.accessToken,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  // ─── Cases 3-5 — Socket.IO broadcast assertions ───────────────────────────

  it.todo(
    'Case 3 — A connects via /chat namespace; B REST-sends; A receives message:new'
  );
  it.todo(
    'Case 4 — PATCH /chats/:id/read from B → A receives chat:read on socket'
  );
  it.todo(
    'Case 5 — DELETE /chats/:id/messages/:msgId?scope=everyone — A deletes, B receives message:deleted; C (non-member) → 403'
  );

  // ─── Case 6 — POST /messages/:id/report ───────────────────────────────────

  it('POST /messages/:id/report — 201 first, 409 on duplicate (reason)', async () => {
    const create = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    const chatId = create.json<{ chatId: string }>().chatId;

    const send = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: bob.accessToken,
      payload: { kind: 'TEXT', text: 'spammy', clientMessageId: cli() },
    });
    const messageId = send.json<{ id: string }>().id;

    const reportBody = { reason: 'SPAM' };

    const first = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/report`,
      token: alice.accessToken,
      payload: reportBody,
    });
    expect(first.statusCode).toBe(201);

    const second = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/report`,
      token: alice.accessToken,
      payload: reportBody,
    });
    expect(second.statusCode).toBe(409);
  });

  // ─── Case 7 — POST /users/:id/block — peer_blocked on send ────────────────

  it('POST /users/:id/block rejects subsequent peer sends with 403 peer_blocked', async () => {
    const create = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    const chatId = create.json<{ chatId: string }>().chatId;

    const block = await authedInject(testApp, {
      method: 'POST',
      url: `/users/${bob.id}/block`,
      token: alice.accessToken,
      payload: {},
    });
    expect([200, 201]).toContain(block.statusCode);

    const send = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: bob.accessToken,
      payload: { kind: 'TEXT', text: 'still around?', clientMessageId: cli() },
    });
    expect(send.statusCode).toBe(403);
    expect(send.json<{ error?: { code: string } }>().error?.code).toBe('peer_blocked');

    const unblock = await authedInject(testApp, {
      method: 'DELETE',
      url: `/users/${bob.id}/block`,
      token: alice.accessToken,
    });
    expect([200, 204]).toContain(unblock.statusCode);

    const sendAgain = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: bob.accessToken,
      payload: { kind: 'TEXT', text: 'still around?', clientMessageId: cli() },
    });
    expect(sendAgain.statusCode).toBe(201);
  });

  // ─── Case 8 — PATCH /chats/:id/mute sets ChatMember.mutedUntil ───────────

  it('PATCH /chats/:id/mute updates mutedUntil on the caller membership', async () => {
    const create = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    const chatId = create.json<{ chatId: string }>().chatId;

    const until = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const mute = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/mute`,
      token: alice.accessToken,
      payload: { until },
    });
    expect(mute.statusCode).toBe(200);

    const member = await testApp.prisma.chatMember.findFirst({
      where: { chatId, userId: alice.id },
      select: { mutedUntil: true },
    });
    expect(member?.mutedUntil).not.toBeNull();
  });

  // ─── Case 9 — PATCH /chats/:id/clear is per-user ──────────────────────────

  it('PATCH /chats/:id/clear hides history for caller; peer still sees it', async () => {
    const create = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    const chatId = create.json<{ chatId: string }>().chatId;

    await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: { kind: 'TEXT', text: 'history #1', clientMessageId: cli() },
    });
    await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: { kind: 'TEXT', text: 'history #2', clientMessageId: cli() },
    });

    const clear = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/clear`,
      token: alice.accessToken,
      payload: {},
    });
    expect(clear.statusCode).toBe(200);

    const aliceList = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages?limit=10`,
      token: alice.accessToken,
    });
    expect(aliceList.json<{ items: unknown[] }>().items).toHaveLength(0);

    const bobList = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/messages?limit=10`,
      token: bob.accessToken,
    });
    expect(bobList.json<{ items: unknown[] }>().items).toHaveLength(2);
  });

  // ─── Non-member negative case ─────────────────────────────────────────────

  it('Mallory cannot send to a chat she is not a member of (403)', async () => {
    const create = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    const chatId = create.json<{ chatId: string }>().chatId;

    const send = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: mallory.accessToken,
      payload: { kind: 'TEXT', text: 'sneak', clientMessageId: cli() },
    });
    expect(send.statusCode).toBe(403);
  });

  // ─── Case 10 — Reactions add / remove + non-member 403 ────────────────────

  it('POST/DELETE /messages/:id/reactions aggregates correctly + rejects non-members', async () => {
    const create = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    const chatId = create.json<{ chatId: string }>().chatId;

    const send = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: { kind: 'TEXT', text: 'react to me', clientMessageId: cli() },
    });
    const messageId = send.json<{ id: string }>().id;

    // Alice reacts 👍 → 1 row
    const r1 = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/reactions`,
      token: alice.accessToken,
      payload: { emoji: '👍' },
    });
    expect(r1.statusCode).toBe(201);
    expect(r1.json<{ reactions: { emoji: string; count: number }[] }>().reactions).toEqual([
      { emoji: '👍', count: 1, reactedByMe: true },
    ]);

    // Bob reacts ❤️ → 2 emoji rows, sorted by count then alpha
    const r2 = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/reactions`,
      token: bob.accessToken,
      payload: { emoji: '❤️' },
    });
    expect(r2.statusCode).toBe(201);
    const r2List = r2.json<{ reactions: { emoji: string }[] }>().reactions;
    expect(r2List.map((r) => r.emoji).sort()).toEqual(['❤️', '👍']);

    // Alice double-taps 👍 (idempotent — server swallows P2002)
    const r3 = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/reactions`,
      token: alice.accessToken,
      payload: { emoji: '👍' },
    });
    expect(r3.statusCode).toBe(201);
    // Still one 👍 (alice), one ❤️ (bob).
    const r3Counts = Object.fromEntries(
      r3.json<{ reactions: { emoji: string; count: number }[] }>().reactions.map((r) => [r.emoji, r.count])
    );
    expect(r3Counts).toEqual({ '👍': 1, '❤️': 1 });

    // Mallory (non-member) cannot react.
    const denied = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/reactions`,
      token: mallory.accessToken,
      payload: { emoji: '🔥' },
    });
    expect(denied.statusCode).toBe(403);

    // Alice removes 👍 → only ❤️ left.
    const r4 = await authedInject(testApp, {
      method: 'DELETE',
      url: `/messages/${messageId}/reactions/${encodeURIComponent('👍')}`,
      token: alice.accessToken,
    });
    expect(r4.statusCode).toBe(200);
    expect(r4.json<{ reactions: { emoji: string }[] }>().reactions).toEqual([
      { emoji: '❤️', count: 1, reactedByMe: false },
    ]);

    // DB sanity check.
    const rows = await testApp.prisma.messageReaction.findMany({
      where: { messageId },
      select: { emoji: true, userId: true },
    });
    expect(rows).toEqual([{ emoji: '❤️', userId: bob.id }]);
  });

  // ─── Tranche 2.B — extended message kinds (DOCUMENT / VIDEO / LOCATION / CONTACT_CARD) ───
  //
  // Backend-only schema foundation: the new kinds are sendable + persist +
  // round-trip through GET, and server-only kinds are rejected. No mobile UI.

  async function oneOnOne(): Promise<string> {
    const create = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    return create.json<{ chatId: string }>().chatId;
  }

  // A media key matching the sender-prefix + extension contract (see MediaService.validateObjectKey).
  function docKey(userId: string, ext = 'pdf'): string {
    const prefix = userId.replace(/-/g, '').slice(0, 8).toLowerCase();
    return `chat-media/${prefix}/00000000-0000-4000-8000-000000000000.${ext}`;
  }

  it('send DOCUMENT persists documentTitle + mediaMimeType and round-trips', async () => {
    const chatId = await oneOnOne();
    const res = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: {
        kind: 'DOCUMENT',
        clientMessageId: cli(),
        mediaObjectKey: docKey(alice.id, 'pdf'),
        mediaMimeType: 'application/pdf',
        documentTitle: 'Q3 report.pdf',
        documentSizeBytes: 248_000,
      },
    });
    expect(res.statusCode).toBe(201);
    const dto = res.json<{ kind: string; documentTitle: string; mediaMimeType: string }>();
    expect(dto.kind).toBe('DOCUMENT');
    expect(dto.documentTitle).toBe('Q3 report.pdf');
    expect(dto.mediaMimeType).toBe('application/pdf');
  });

  it('send DOCUMENT without mediaMimeType → 400', async () => {
    const chatId = await oneOnOne();
    const res = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: {
        kind: 'DOCUMENT',
        clientMessageId: cli(),
        mediaObjectKey: docKey(alice.id, 'pdf'),
        documentTitle: 'no-mime.pdf',
        documentSizeBytes: 100,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('send LOCATION persists lat/lng; out-of-range latitude → 400', async () => {
    const chatId = await oneOnOne();
    const ok = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: { kind: 'LOCATION', clientMessageId: cli(), latitude: 19.076, longitude: 72.8777, locationName: 'Mumbai' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<{ latitude: number; longitude: number }>().latitude).toBeCloseTo(19.076);

    const bad = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: { kind: 'LOCATION', clientMessageId: cli(), latitude: 200, longitude: 0 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('send CONTACT_CARD persists name/phone; bad E.164 → 400', async () => {
    const chatId = await oneOnOne();
    const ok = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: { kind: 'CONTACT_CARD', clientMessageId: cli(), contactName: 'Priya', contactPhoneE164: '+919620304050' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<{ contactName: string }>().contactName).toBe('Priya');

    const bad = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: { kind: 'CONTACT_CARD', clientMessageId: cli(), contactName: 'X', contactPhoneE164: '12345' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('client-supplied server-only kinds (POLL / CALL_EVENT / SYSTEM) → 400', async () => {
    const chatId = await oneOnOne();
    for (const kind of ['POLL', 'CALL_EVENT', 'SYSTEM', 'LOCATION_LIVE']) {
      const res = await authedInject(testApp, {
        method: 'POST',
        url: `/chats/${chatId}/messages`,
        token: alice.accessToken,
        payload: { kind, clientMessageId: cli(), text: 'nope' },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  // ─── Tranche 2.E-back — Forward + Pin ─────────────────────────────────────

  async function chatWith(ownerToken: string, contactUserId: string): Promise<string> {
    const r = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: ownerToken,
      payload: { contactUserId },
    });
    return r.json<{ chatId: string }>().chatId;
  }
  async function sendText(chatId: string, token: string, text = 'hello'): Promise<string> {
    const r = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token,
      payload: { kind: 'TEXT', text, clientMessageId: cli() },
    });
    return r.json<{ id: string }>().id;
  }

  it('forward delivers a copy + sets forwardedFromMessageId + bumps forwardCount; re-forward is idempotent', async () => {
    const sourceChat = await oneOnOne(); // alice↔bob
    const targetChat = await chatWith(alice.accessToken, mallory.id); // alice↔mallory
    const messageId = await sendText(sourceChat, alice.accessToken, 'forward me');

    const fwd = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/forward`,
      token: alice.accessToken,
      payload: { targetChatIds: [targetChat] },
    });
    expect(fwd.statusCode).toBe(201);
    const body = fwd.json<{ items: Array<{ id: string; forwardedFromMessageId: string; replyToMessageId: string | null; chatId: string }>; skipped: unknown[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.forwardedFromMessageId).toBe(messageId);
    expect(body.items[0]?.replyToMessageId).toBeNull();
    expect(body.items[0]?.chatId).toBe(targetChat);
    expect(body.skipped).toHaveLength(0);

    // Re-forward same source→target: idempotent (same row id, no double count).
    const again = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/forward`,
      token: alice.accessToken,
      payload: { targetChatIds: [targetChat] },
    });
    expect(again.json<{ items: Array<{ id: string }> }>().items[0]?.id).toBe(body.items[0]?.id);

    // forwardCount on the source bumped exactly once.
    const list = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${sourceChat}/messages?limit=10`,
      token: alice.accessToken,
    });
    const src = list.json<{ items: Array<{ id: string; forwardCount: number }> }>().items.find((m) => m.id === messageId);
    expect(src?.forwardCount).toBe(1);
  });

  it('forward to a chat the forwarder is not in is skipped (not a 4xx)', async () => {
    const sourceChat = await oneOnOne(); // alice↔bob
    const foreignChat = await chatWith(bob.accessToken, mallory.id); // bob↔mallory; alice not a member
    const messageId = await sendText(sourceChat, alice.accessToken);

    const fwd = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/forward`,
      token: alice.accessToken,
      payload: { targetChatIds: [foreignChat] },
    });
    expect(fwd.statusCode).toBe(201);
    const body = fwd.json<{ items: unknown[]; skipped: Array<{ chatId: string; reason: string }> }>();
    expect(body.items).toHaveLength(0);
    expect(body.skipped).toEqual([{ chatId: foreignChat, reason: 'not_a_member' }]);
  });

  it('forwarding a deleted message is rejected', async () => {
    const sourceChat = await oneOnOne();
    const targetChat = await chatWith(alice.accessToken, mallory.id);
    const messageId = await sendText(sourceChat, alice.accessToken, 'soon gone');
    await authedInject(testApp, {
      method: 'DELETE',
      url: `/chats/${sourceChat}/messages/${messageId}?scope=everyone`,
      token: alice.accessToken,
    });
    const fwd = await authedInject(testApp, {
      method: 'POST',
      url: `/messages/${messageId}/forward`,
      token: alice.accessToken,
      payload: { targetChatIds: [targetChat] },
    });
    expect(fwd.statusCode).toBe(403);
  });

  it('pin sets pinnedAt + lists; 4th pin → 409; unpin idempotent', async () => {
    const chatId = await oneOnOne();
    const ids = [
      await sendText(chatId, alice.accessToken, 'm1'),
      await sendText(chatId, alice.accessToken, 'm2'),
      await sendText(chatId, alice.accessToken, 'm3'),
      await sendText(chatId, alice.accessToken, 'm4'),
    ];
    for (const id of ids.slice(0, 3)) {
      const p = await authedInject(testApp, {
        method: 'PATCH',
        url: `/chats/${chatId}/messages/${id}/pin`,
        token: alice.accessToken,
      });
      expect(p.statusCode).toBe(200);
      expect(p.json<{ pinnedAt: string | null }>().pinnedAt).not.toBeNull();
    }
    const fourth = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/messages/${ids[3]}/pin`,
      token: alice.accessToken,
    });
    expect(fourth.statusCode).toBe(409);

    const pins = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/pins`,
      token: bob.accessToken,
    });
    expect(pins.json<{ items: unknown[] }>().items).toHaveLength(3);

    // Unpin twice → both 200 (idempotent).
    for (let i = 0; i < 2; i += 1) {
      const u = await authedInject(testApp, {
        method: 'DELETE',
        url: `/chats/${chatId}/messages/${ids[0]}/pin`,
        token: alice.accessToken,
      });
      expect(u.statusCode).toBe(200);
    }
  });

  it('non-member cannot pin (403); cross-chat pin → 404', async () => {
    const chatId = await oneOnOne(); // alice↔bob
    const messageId = await sendText(chatId, alice.accessToken);

    const byNonMember = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/messages/${messageId}/pin`,
      token: mallory.accessToken,
    });
    expect(byNonMember.statusCode).toBe(403);

    // Pin a message that belongs to chatId via a DIFFERENT chat's id → 404.
    const otherChat = await chatWith(alice.accessToken, mallory.id);
    const crossChat = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${otherChat}/messages/${messageId}/pin`,
      token: alice.accessToken,
    });
    expect(crossChat.statusCode).toBe(404);
  });

  // Phase 2 cases — extended as the features land.
  it.todo('Case 11 — Phase 2.2 Edit: in-window 200, outside-window 400 edit_window_expired');
  it.todo('Case 13 — Phase 2.5 Search: ILIKE match on TEXT only');
});

void TEXT; // exported for future helpers; lint-quiet
