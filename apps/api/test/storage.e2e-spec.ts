/**
 * P2-Storage — GET /chats/:chatId/storage e2e suite.
 *
 * 4 cases:
 *   1. Non-member → 403 not_a_member
 *   2. Empty chat → { perKind: [], totalBytes: '0' }
 *   3. Two TEXT messages → TEXT count 2, totalBytes '0'
 *   4. Two IMAGE rows inserted directly via prisma (bypass R2 presign) →
 *      IMAGE count 2, totalBytes '2000000', grand total '2000000'
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
  return `storage-cli-${Date.now()}-${(cliSeq += 1)}`;
}

describe('GET /chats/:chatId/storage', () => {
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
    alice = await seedUser(testApp, { fullName: 'Alice', phoneE164: '+919222220001' });
    bob = await seedUser(testApp, { fullName: 'Bob', phoneE164: '+919222220002' });
    mallory = await seedUser(testApp, { fullName: 'Mallory', phoneE164: '+919222220003' });
  });

  /** Helper — create a 1-on-1 chat, return chatId. */
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

  /** Helper — send a TEXT message via REST, return the message id. */
  async function sendText(chatId: string, sender: SeededUser, text: string): Promise<string> {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: sender.accessToken,
      payload: { kind: 'TEXT', text, clientMessageId: cli() },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  // ─── Case 1 — Non-member → 403 not_a_member ─────────────────────────────

  it('returns 403 not_a_member for a non-member', async () => {
    const chatId = await openChat(alice, bob);

    const res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/storage`,
      token: mallory.accessToken,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_a_member');
  });

  // ─── Case 2 — Empty chat → perKind: [], totalBytes: '0' ─────────────────

  it('returns empty perKind and totalBytes 0 for a chat with no messages', async () => {
    const chatId = await openChat(alice, bob);

    const res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/storage`,
      token: alice.accessToken,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ perKind: unknown[]; totalBytes: string }>();
    expect(body.perKind).toEqual([]);
    expect(body.totalBytes).toBe('0');
  });

  // ─── Case 3 — Two TEXT messages → TEXT count 2, totalBytes '0' ──────────

  it('counts TEXT messages with totalBytes 0', async () => {
    const chatId = await openChat(alice, bob);
    await sendText(chatId, alice, 'hello');
    await sendText(chatId, bob, 'world');

    const res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/storage`,
      token: alice.accessToken,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ perKind: Array<{ kind: string; count: number; totalBytes: string }>; totalBytes: string }>();

    const textRow = body.perKind.find((r) => r.kind === 'TEXT');
    expect(textRow).toBeDefined();
    expect(textRow!.count).toBe(2);
    expect(textRow!.totalBytes).toBe('0');
    expect(body.totalBytes).toBe('0');
  });

  // ─── Case 4 — Two IMAGE rows inserted directly via prisma ───────────────
  // Bypasses R2 presign + media validation; exercises the $queryRaw aggregation.

  it('sums mediaSizeBytes for IMAGE rows inserted directly', async () => {
    const chatId = await openChat(alice, bob);

    // Insert two IMAGE rows with known sizes directly via prisma (bypasses the
    // R2 presign path, which isn't wired in the e2e env).
    const fakeKey = (n: number) => `chat-media/aaaabbbb/fake-image-${n}.jpg`;

    await testApp.prisma.message.create({
      data: {
        chatId,
        senderUserId: alice.id,
        clientMessageId: cli(),
        sequence: 1n,
        kind: 'IMAGE',
        mediaObjectKey: fakeKey(1),
        imageWidth: 800,
        imageHeight: 600,
        mediaSizeBytes: 500_000n,
      },
    });
    await testApp.prisma.message.create({
      data: {
        chatId,
        senderUserId: alice.id,
        clientMessageId: cli(),
        sequence: 2n,
        kind: 'IMAGE',
        mediaObjectKey: fakeKey(2),
        imageWidth: 1920,
        imageHeight: 1080,
        mediaSizeBytes: 1_500_000n,
      },
    });

    const res = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}/storage`,
      token: alice.accessToken,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ perKind: Array<{ kind: string; count: number; totalBytes: string }>; totalBytes: string }>();

    const imageRow = body.perKind.find((r) => r.kind === 'IMAGE');
    expect(imageRow).toBeDefined();
    expect(imageRow!.count).toBe(2);
    expect(imageRow!.totalBytes).toBe('2000000');
    expect(body.totalBytes).toBe('2000000');
  });
});
