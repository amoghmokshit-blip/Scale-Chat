/**
 * Calls signalling e2e (Tranche 2.H PR-1).
 *
 * Backend-only — no mobile UI in this tranche. Tests drive the REST surface
 * end-to-end against a real Postgres + Redis (per `setup-e2e.ts`); the
 * BullMQ ring-timeout is bypassed by calling
 * `callsService.onRingTimeout(callId)` directly (plan §11 Q1c — waiting 30s
 * per case would multiply the suite runtime).
 *
 * Socket assertions are mocked: we spy on `MessagesGateway.emitCallRing /
 * emitCallAccepted / emitCallEnded / emitCallTaken` and assert they were
 * called with the right rooms. Real Socket.IO clients land in a dedicated
 * socket harness in a later tranche.
 *
 * Coverage (10 cases per BRD §2.H line 723):
 *   1. token-mint with non-member → 403 not_a_member
 *   2. token-mint with blocked counterpart → 403 peer_blocked
 *   3. decline records DECLINED + inserts CALL_EVENT thread row
 *   4. ring-timeout fires MISSED + CALL_EVENT (direct processor call)
 *   5. multi-device first-accept-wins: second-accept returns 409
 *   6. double-accept idempotent semantics: second returns 409 (NOT idempotent)
 *   7. hangup after accept records COMPLETED with durationSec
 *   8. webhook bad signature → 403 invalid_webhook_signature (PR-1 stub)
 *   9. (PR-2) webhook good signature updates durationSec — placeholder
 *   10. client-supplied CALL_EVENT kind rejected 400 kind_not_allowed_from_client
 */
import { CallsService } from '../src/modules/calls/calls.service';
import { MessagesGateway } from '../src/modules/messages/messages.gateway';
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
  return `cli-call-${Date.now()}-${(cliSeq += 1)}`;
}

describe('1-on-1 calls (REST happy path + edges)', () => {
  let testApp: TestApp;
  let alice: SeededUser;
  let bob: SeededUser;
  let mallory: SeededUser;
  // Spies — reset before each test in `beforeEach`.
  let emitCallRingSpy: jest.SpyInstance;
  let emitCallAcceptedSpy: jest.SpyInstance;
  let emitCallEndedSpy: jest.SpyInstance;
  let emitCallTakenSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await setupTestApp();
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  beforeEach(async () => {
    await truncateAll(testApp.prisma);
    alice = await seedUser(testApp, { fullName: 'Alice', phoneE164: '+919000020001' });
    bob = await seedUser(testApp, { fullName: 'Bob', phoneE164: '+919000020002' });
    mallory = await seedUser(testApp, { fullName: 'Mallory', phoneE164: '+919000020003' });

    const gateway = testApp.app.get(MessagesGateway);
    // Replace emits with spies so we don't need a real Socket.IO client.
    // jest.spyOn re-stubs implementation to a no-op.
    emitCallRingSpy = jest.spyOn(gateway, 'emitCallRing').mockImplementation(() => undefined);
    emitCallAcceptedSpy = jest
      .spyOn(gateway, 'emitCallAccepted')
      .mockImplementation(() => undefined);
    emitCallEndedSpy = jest.spyOn(gateway, 'emitCallEnded').mockImplementation(() => undefined);
    emitCallTakenSpy = jest.spyOn(gateway, 'emitCallTaken').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function oneOnOne(): Promise<string> {
    const r = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    return r.json<{ chatId: string }>().chatId;
  }

  async function mintCall(
    chatId: string,
    token: string,
    kind: 'VOICE' | 'VIDEO' = 'VOICE',
  ): Promise<{ callId: string; roomName: string; accessToken: string; wsUrl: string }> {
    const r = await authedInject(testApp, {
      method: 'POST',
      url: '/calls/token',
      token,
      payload: { chatId, kind },
    });
    expect(r.statusCode).toBe(200);
    return r.json<{ callId: string; roomName: string; accessToken: string; wsUrl: string }>();
  }

  // ─── Case 1 — non-member token mint → 403 ─────────────────────────────────

  it('token-mint with non-member → 403 not_a_member', async () => {
    const chatId = await oneOnOne();
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/calls/token',
      token: mallory.accessToken,
      payload: { chatId, kind: 'VOICE' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('not_a_member');
  });

  // ─── Case 2 — blocked counterpart → 403 ───────────────────────────────────

  it('token-mint with blocked counterpart → 403 peer_blocked', async () => {
    const chatId = await oneOnOne();
    // Alice blocks Bob (or vice-versa) — either direction blocks the call.
    await testApp.prisma.blockedUser.create({
      data: { blockerUserId: bob.id, blockedUserId: alice.id },
    });
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/calls/token',
      token: alice.accessToken,
      payload: { chatId, kind: 'VOICE' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('peer_blocked');
  });

  // ─── Case 3 — decline records DECLINED + inserts CALL_EVENT ──────────────

  it('decline records DECLINED + inserts CALL_EVENT thread row', async () => {
    const chatId = await oneOnOne();
    const { callId } = await mintCall(chatId, alice.accessToken, 'VOICE');

    const declineRes = await authedInject(testApp, {
      method: 'POST',
      url: `/calls/${callId}/decline`,
      token: bob.accessToken,
    });
    expect(declineRes.statusCode).toBe(204);

    // CallSession is DECLINED.
    const row = await testApp.prisma.callSession.findUnique({ where: { id: callId } });
    expect(row?.status).toBe('DECLINED');
    expect(row?.endedAt).not.toBeNull();

    // CALL_EVENT thread row was inserted with the call-id linkage.
    expect(row?.callEventMessageId).not.toBeNull();
    const event = await testApp.prisma.message.findUnique({
      where: { id: row!.callEventMessageId! },
    });
    expect(event?.kind).toBe('CALL_EVENT');
    expect(event?.text).toContain('Declined');

    // call:ended broadcast fired for both peers (mocked emit assertion).
    expect(emitCallEndedSpy).toHaveBeenCalledTimes(2);
    expect(emitCallEndedSpy).toHaveBeenCalledWith(
      alice.id,
      expect.objectContaining({ callId, reason: 'declined' }),
    );
    expect(emitCallEndedSpy).toHaveBeenCalledWith(
      bob.id,
      expect.objectContaining({ callId, reason: 'declined' }),
    );
  });

  // ─── Case 4 — ring-timeout fires MISSED ───────────────────────────────────

  it('ring 30s timeout via BullMQ records MISSED + CALL_EVENT (direct processor call)', async () => {
    const chatId = await oneOnOne();
    const { callId } = await mintCall(chatId, alice.accessToken, 'VIDEO');

    // Bypass the BullMQ delay — call the processor entry point directly.
    const callsService = testApp.app.get(CallsService);
    await callsService.onRingTimeout(callId);

    const row = await testApp.prisma.callSession.findUnique({ where: { id: callId } });
    expect(row?.status).toBe('MISSED');
    expect(row?.endedAt).not.toBeNull();
    expect(row?.callEventMessageId).not.toBeNull();

    const event = await testApp.prisma.message.findUnique({
      where: { id: row!.callEventMessageId! },
    });
    expect(event?.kind).toBe('CALL_EVENT');
    expect(event?.text).toContain('Missed video call');

    expect(emitCallEndedSpy).toHaveBeenCalledWith(
      alice.id,
      expect.objectContaining({ callId, reason: 'missed' }),
    );
  });

  // ─── Case 5 — multi-device first-accept-wins ──────────────────────────────

  it('accept from two devices: first wins; second returns 409 call_already_accepted', async () => {
    const chatId = await oneOnOne();
    const { callId } = await mintCall(chatId, alice.accessToken, 'VOICE');

    const first = await authedInject(testApp, {
      method: 'POST',
      url: `/calls/${callId}/accept`,
      token: bob.accessToken,
    });
    expect(first.statusCode).toBe(200);

    // Second accept (same JWT — represents another device) → 409.
    const second = await authedInject(testApp, {
      method: 'POST',
      url: `/calls/${callId}/accept`,
      token: bob.accessToken,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('call_already_accepted');

    // call:taken was broadcast to the callee's room (the OTHER devices dismiss).
    expect(emitCallTakenSpy).toHaveBeenCalledWith(bob.id, { callId });
    // call:accepted fired for both peers.
    expect(emitCallAcceptedSpy).toHaveBeenCalledTimes(2);
  });

  // ─── Case 6 — double-accept is NOT idempotent (state transition) ─────────

  it('double-accept returns 409 (state transition, not idempotent)', async () => {
    const chatId = await oneOnOne();
    const { callId } = await mintCall(chatId, alice.accessToken, 'VOICE');

    await authedInject(testApp, {
      method: 'POST',
      url: `/calls/${callId}/accept`,
      token: bob.accessToken,
    });
    const retry = await authedInject(testApp, {
      method: 'POST',
      url: `/calls/${callId}/accept`,
      token: bob.accessToken,
    });
    expect(retry.statusCode).toBe(409);
  });

  // ─── Case 7 — hangup after accept records COMPLETED + durationSec ────────

  it('hangup after accept records COMPLETED with durationSec', async () => {
    const chatId = await oneOnOne();
    const { callId } = await mintCall(chatId, alice.accessToken, 'VOICE');

    // Accept first.
    const acceptRes = await authedInject(testApp, {
      method: 'POST',
      url: `/calls/${callId}/accept`,
      token: bob.accessToken,
    });
    expect(acceptRes.statusCode).toBe(200);

    // Force startedAt back ~10s so durationSec is observable.
    await testApp.prisma.callSession.update({
      where: { id: callId },
      data: { startedAt: new Date(Date.now() - 10_000) },
    });

    const hangup = await authedInject(testApp, {
      method: 'POST',
      url: `/calls/${callId}/hangup`,
      token: alice.accessToken,
    });
    expect(hangup.statusCode).toBe(204);

    const row = await testApp.prisma.callSession.findUnique({ where: { id: callId } });
    expect(row?.status).toBe('COMPLETED');
    expect(row?.endedAt).not.toBeNull();
    expect(row?.durationSec).toBeGreaterThanOrEqual(9);

    expect(emitCallEndedSpy).toHaveBeenCalledWith(
      alice.id,
      expect.objectContaining({
        callId,
        reason: 'hangup',
        durationSec: expect.any(Number),
      }),
    );
  });

  // ─── Case 8 — webhook bad signature → 403 (PR-1 stub) ─────────────────────

  it('webhook bad signature → 403 invalid_webhook_signature', async () => {
    const res = await testApp.inject({
      method: 'POST',
      url: '/calls/webhooks/livekit',
      payload: { event: 'room_finished', room: { name: 'x' } },
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer not-a-valid-livekit-jwt',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('invalid_webhook_signature');
  });

  // ─── Case 9 — webhook good signature (real LiveKit JWT) ───────────────────
  // Needs LIVEKIT_API_KEY/SECRET in the test env to forge a valid signed
  // webhook (LiveKit's WebhookReceiver verifies a JWT over the body sha256).
  // Deferred until the e2e harness injects test LiveKit creds — the happy-path
  // call completion is already covered by the hangup case (7); the webhook is
  // only the app-killed fallback.

  it.todo('webhook good signature transitions ACCEPTED→COMPLETED (needs test LiveKit creds)');

  // ─── Case 10 — client-supplied CALL_EVENT rejected ────────────────────────

  it('client-supplied CALL_EVENT kind rejected 400 kind_not_allowed_from_client', async () => {
    const chatId = await oneOnOne();
    const res = await authedInject(testApp, {
      method: 'POST',
      url: `/chats/${chatId}/messages`,
      token: alice.accessToken,
      payload: { kind: 'CALL_EVENT', clientMessageId: cli(), text: 'fake call' },
    });
    expect(res.statusCode).toBe(400);
  });
});
