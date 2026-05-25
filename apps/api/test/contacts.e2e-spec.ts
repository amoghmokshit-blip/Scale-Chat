/**
 * Contacts module e2e — PR 6 device-contacts sync.
 *
 * PR 6.2 — POST /contacts/discover
 *   1. Discovery returns only on-platform matches and never leaks `id`/`userId`.
 *   2. Discovery silently drops the caller's own phone if included in the batch.
 *   3. Empty / malformed bodies are rejected with 400.
 *   4. Rate limit kicks in after 10 successful calls within the window.
 *
 * PR 6.3 — POST /contacts/bulk
 *   5. Bulk save partitions input into newly-saved vs already-had counts.
 *   6. Re-running the same batch is a NOP (idempotent).
 *   7. Caller's own phone is silently dropped (no error).
 *   8. Per-batch dedup — same phone twice in items is treated as one.
 *   9. Empty / malformed bodies → 400.
 *   10. Rate limit kicks in after 5 calls.
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

describe('POST /contacts/discover', () => {
  let testApp: TestApp;
  let alice: SeededUser;
  let bob: SeededUser;
  let carol: SeededUser;

  beforeAll(async () => {
    testApp = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await truncateAll(testApp.prisma);
    // Three platform users + one phone we'll submit that doesn't exist.
    // Each seedUser() call generates a unique phone, so the rate-limit key
    // (`contacts:discover:${user.sub}`) is also unique per test run — leftover
    // Redis state from prior runs can't poison these assertions.
    alice = await seedUser(testApp, { fullName: 'Alice', phoneE164: '+919800010001' });
    bob = await seedUser(testApp, { fullName: 'Bob', phoneE164: '+919800010002' });
    carol = await seedUser(testApp, { fullName: 'Carol', phoneE164: '+919800010003' });
  });

  // ─── Case 1 — happy path + privacy contract ───────────────────────────────

  it('returns matches for on-platform phones and rejects unknown ones', async () => {
    const ghost = '+919800099999'; // not seeded
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/discover',
      token: alice.accessToken,
      payload: { phones: [bob.phoneE164, carol.phoneE164, ghost] },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ matches: Array<Record<string, unknown>> }>();
    expect(body.matches).toHaveLength(2);

    // Privacy contract: the response must NOT carry the matched user's `id`
    // or any `userId`-like field. Serialise + grep the whole payload.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/"id"\s*:/);
    expect(raw).not.toMatch(/userId/i);

    // Each match must carry only the 4 contracted fields.
    for (const m of body.matches) {
      expect(Object.keys(m).sort()).toEqual(
        ['avatarUri', 'displayName', 'isOnPlatform', 'phoneE164'].sort(),
      );
      expect(m.isOnPlatform).toBe(true);
    }

    // The two matches are bob + carol (order is unspecified by the service).
    const phones = body.matches.map((m) => m.phoneE164).sort();
    expect(phones).toEqual([bob.phoneE164, carol.phoneE164].sort());
  });

  // ─── Case 2 — caller's own number is silently dropped ─────────────────────

  it("does not return the caller's own phone even if submitted", async () => {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/discover',
      token: alice.accessToken,
      payload: { phones: [alice.phoneE164, bob.phoneE164] },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ matches: Array<{ phoneE164: string }> }>();
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]?.phoneE164).toBe(bob.phoneE164);
  });

  // ─── Case 3 — input validation ────────────────────────────────────────────

  it('rejects an empty phones array', async () => {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/discover',
      token: alice.accessToken,
      payload: { phones: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed E.164 phone', async () => {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/discover',
      token: alice.accessToken,
      payload: { phones: ['9876543210'] }, // missing +91 prefix
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/contacts/discover',
      headers: { 'content-type': 'application/json' },
      payload: { phones: [bob.phoneE164] },
    });
    expect(res.statusCode).toBe(401);
  });

  // ─── Case 4 — rate limit (10 req/min/user) ────────────────────────────────

  it('returns 429 after exceeding the 10 req/min ceiling', async () => {
    // The 10 within-window calls all succeed (status 200). The 11th must
    // return 429 with the documented error code.
    for (let i = 0; i < 10; i += 1) {
      const ok = await authedInject(testApp, {
        method: 'POST',
        url: '/contacts/discover',
        token: alice.accessToken,
        payload: { phones: [bob.phoneE164] },
      });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/discover',
      token: alice.accessToken,
      payload: { phones: [bob.phoneE164] },
    });
    expect(limited.statusCode).toBe(429);
    // The global HttpExceptionFilter wraps every HttpException as
    // `{ error: { code, message, requestId } }` — see
    // `apps/api/src/common/filters/http-exception.filter.ts`. Assert the
    // unwrapped shape rather than the controller's raw throw payload.
    expect(limited.json<{ error: { code: string } }>().error.code).toBe('rate_limited');
  });
});

describe('POST /contacts/bulk', () => {
  let testApp: TestApp;
  let alice: SeededUser;
  let bob: SeededUser;
  let carol: SeededUser;

  beforeAll(async () => {
    testApp = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await truncateAll(testApp.prisma);
    alice = await seedUser(testApp, { fullName: 'Alice', phoneE164: '+919700020001' });
    bob = await seedUser(testApp, { fullName: 'Bob', phoneE164: '+919700020002' });
    carol = await seedUser(testApp, { fullName: 'Carol', phoneE164: '+919700020003' });
  });

  // ─── Case 5 — happy path: partition saved vs alreadyHad ───────────────────

  it('saves new contacts and reports zero alreadyHad on first run', async () => {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/bulk',
      token: alice.accessToken,
      payload: {
        items: [
          { phoneE164: bob.phoneE164, displayName: 'Bob from work' },
          { phoneE164: carol.phoneE164, displayName: 'Carol from college' },
          { phoneE164: '+919700099999', displayName: 'Off-platform Friend' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ saved: Array<Record<string, unknown>>; alreadyHad: number }>();
    expect(body.alreadyHad).toBe(0);
    expect(body.saved).toHaveLength(3);

    // The two platform users get contactUserId populated; the ghost phone
    // has contactUserId: null and isOnPlatform: false.
    const byPhone = new Map(body.saved.map((c) => [c.phoneE164 as string, c]));
    expect(byPhone.get(bob.phoneE164)?.isOnPlatform).toBe(true);
    expect(byPhone.get(bob.phoneE164)?.contactUserId).toBe(bob.id);
    expect(byPhone.get(carol.phoneE164)?.isOnPlatform).toBe(true);
    expect(byPhone.get('+919700099999')?.isOnPlatform).toBe(false);
    expect(byPhone.get('+919700099999')?.contactUserId).toBeNull();
  });

  // ─── Case 6 — idempotent: re-run sends 0 saved, all alreadyHad ────────────

  it('re-running the same batch is a NOP', async () => {
    const payload = {
      items: [
        { phoneE164: bob.phoneE164, displayName: 'Bob' },
        { phoneE164: carol.phoneE164, displayName: 'Carol' },
      ],
    };
    const first = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/bulk',
      token: alice.accessToken,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ saved: unknown[]; alreadyHad: number }>().saved).toHaveLength(2);

    const second = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/bulk',
      token: alice.accessToken,
      payload,
    });
    expect(second.statusCode).toBe(200);
    const body = second.json<{ saved: unknown[]; alreadyHad: number }>();
    expect(body.saved).toHaveLength(0);
    expect(body.alreadyHad).toBe(2);

    // Confirm the underlying rows didn't double-insert.
    const rows = await testApp.prisma.contact.findMany({ where: { ownerUserId: alice.id } });
    expect(rows).toHaveLength(2);
  });

  // ─── Case 7 — caller's own phone is silently dropped ──────────────────────

  it("silently filters the caller's own phone from items", async () => {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/bulk',
      token: alice.accessToken,
      payload: {
        items: [
          { phoneE164: alice.phoneE164, displayName: 'Me' },
          { phoneE164: bob.phoneE164, displayName: 'Bob' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ saved: Array<{ phoneE164: string }>; alreadyHad: number }>();
    expect(body.saved).toHaveLength(1);
    expect(body.saved[0]?.phoneE164).toBe(bob.phoneE164);
    expect(body.alreadyHad).toBe(0); // self-drop doesn't count as alreadyHad
  });

  // ─── Case 8 — per-batch dedup (same phone twice in items) ─────────────────

  it('per-batch dedups when the same phone appears twice', async () => {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/bulk',
      token: alice.accessToken,
      payload: {
        items: [
          { phoneE164: bob.phoneE164, displayName: 'Bob (work)' },
          { phoneE164: bob.phoneE164, displayName: 'Bob (personal)' }, // duplicate
          { phoneE164: carol.phoneE164, displayName: 'Carol' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ saved: Array<{ phoneE164: string; displayName: string }>; alreadyHad: number }>();
    expect(body.saved).toHaveLength(2);
    // First occurrence wins — the duplicate's displayName is dropped.
    const bobRow = body.saved.find((r) => r.phoneE164 === bob.phoneE164);
    expect(bobRow?.displayName).toBe('Bob (work)');
  });

  // ─── Case 9 — input validation ────────────────────────────────────────────

  it('rejects an empty items array', async () => {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/bulk',
      token: alice.accessToken,
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed E.164 in any item', async () => {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/bulk',
      token: alice.accessToken,
      payload: {
        items: [
          { phoneE164: bob.phoneE164, displayName: 'Bob' },
          { phoneE164: '9876543210', displayName: 'No-prefix' }, // missing +91
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── Case 10 — rate limit (5 req/min/user) ────────────────────────────────

  it('returns 429 after exceeding the 5 req/min ceiling', async () => {
    // 5 successful calls land within the window; the 6th flips to rate_limited.
    // Each call adds at least one new contact, so we burn fresh phones to keep
    // the response counts honest (otherwise alreadyHad would dominate).
    for (let i = 0; i < 5; i += 1) {
      const ok = await authedInject(testApp, {
        method: 'POST',
        url: '/contacts/bulk',
        token: alice.accessToken,
        payload: { items: [{ phoneE164: `+91970099000${i}`, displayName: `New ${i}` }] },
      });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await authedInject(testApp, {
      method: 'POST',
      url: '/contacts/bulk',
      token: alice.accessToken,
      payload: { items: [{ phoneE164: bob.phoneE164, displayName: 'Bob' }] },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe('rate_limited');
  });
});
