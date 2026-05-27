/**
 * P2-Theme e2e — 5 cases for PATCH /chats/:id/theme + GET /chats/:id chatTheme field.
 *
 * Case 1: PATCH theme persists + GET /chats/:id surfaces chatTheme:'midnight'
 * Case 2: unknown theme 'neon' → 400
 * Case 3: null resets → GET shows null
 * Case 4: non-member → [403,404]
 * Case 5: alice sets theme → bob's GET /chats/:id chatTheme is still null (per-user isolation)
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

describe('Per-chat theme (PATCH /chats/:id/theme)', () => {
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
    alice = await seedUser(testApp, { fullName: 'Alice', phoneE164: '+919001110001' });
    bob = await seedUser(testApp, { fullName: 'Bob', phoneE164: '+919001110002' });
    mallory = await seedUser(testApp, { fullName: 'Mallory', phoneE164: '+919001110003' });
  });

  async function createChat(token: string, contactUserId: string): Promise<string> {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token,
      payload: { contactUserId },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ chatId: string }>().chatId;
  }

  // ─── Case 1 — PATCH theme persists + GET surfaces chatTheme ───────────────

  it('PATCH /chats/:id/theme persists and GET /chats/:id surfaces chatTheme', async () => {
    const chatId = await createChat(alice.accessToken, bob.id);

    const patch = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/theme`,
      token: alice.accessToken,
      payload: { theme: 'midnight' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<{ theme: string }>().theme).toBe('midnight');

    const get = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}`,
      token: alice.accessToken,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ chatTheme: string | null }>().chatTheme).toBe('midnight');
  });

  // ─── Case 2 — unknown theme → 400 ─────────────────────────────────────────

  it('PATCH /chats/:id/theme with unknown theme returns 400', async () => {
    const chatId = await createChat(alice.accessToken, bob.id);

    const patch = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/theme`,
      token: alice.accessToken,
      payload: { theme: 'neon' },
    });
    expect(patch.statusCode).toBe(400);
  });

  // ─── Case 3 — null resets theme ───────────────────────────────────────────

  it('PATCH /chats/:id/theme with null resets theme to null', async () => {
    const chatId = await createChat(alice.accessToken, bob.id);

    // First set it
    await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/theme`,
      token: alice.accessToken,
      payload: { theme: 'forest' },
    });

    // Then reset it
    const patch = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/theme`,
      token: alice.accessToken,
      payload: { theme: null },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<{ theme: string | null }>().theme).toBeNull();

    const get = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}`,
      token: alice.accessToken,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json<{ chatTheme: string | null }>().chatTheme).toBeNull();
  });

  // ─── Case 4 — non-member → [403, 404] ────────────────────────────────────

  it('PATCH /chats/:id/theme by non-member returns 403 or 404', async () => {
    const chatId = await createChat(alice.accessToken, bob.id);

    const patch = await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/theme`,
      token: mallory.accessToken,
      payload: { theme: 'midnight' },
    });
    expect([403, 404]).toContain(patch.statusCode);
  });

  // ─── Case 5 — per-user isolation ─────────────────────────────────────────

  it('alice setting theme does not affect bob\'s chatTheme', async () => {
    const chatId = await createChat(alice.accessToken, bob.id);

    await authedInject(testApp, {
      method: 'PATCH',
      url: `/chats/${chatId}/theme`,
      token: alice.accessToken,
      payload: { theme: 'sunset' },
    });

    const bobGet = await authedInject(testApp, {
      method: 'GET',
      url: `/chats/${chatId}`,
      token: bob.accessToken,
    });
    expect(bobGet.statusCode).toBe(200);
    expect(bobGet.json<{ chatTheme: string | null }>().chatTheme).toBeNull();
  });
});
