/**
 * Push device-token registry + call-wakeup wiring e2e (Tranche 2.I).
 *
 * Does NOT hit Expo's push service (no network) — `PushService.notifyCall` is
 * spied. Covers: token upsert + reassignment, removal, and that minting a call
 * triggers a wakeup push to the callee.
 */
import { CallsService } from '../src/modules/calls/calls.service';
import { MessagesGateway } from '../src/modules/messages/messages.gateway';
import { PushService } from '../src/modules/push/push.service';
import {
  authedInject,
  seedUser,
  setupTestApp,
  teardownTestApp,
  truncateAll,
  type SeededUser,
  type TestApp,
} from './setup-e2e';

const TOKEN_A = 'ExponentPushToken[push-e2e-aaaaaaaaaaaa]';

describe('push tokens + call wakeup', () => {
  let testApp: TestApp;
  let alice: SeededUser;
  let bob: SeededUser;

  beforeAll(async () => {
    testApp = await setupTestApp();
  });
  afterAll(async () => {
    await teardownTestApp();
  });
  beforeEach(async () => {
    await truncateAll(testApp.prisma);
    alice = await seedUser(testApp, { fullName: 'Alice', phoneE164: '+919000030001' });
    bob = await seedUser(testApp, { fullName: 'Bob', phoneE164: '+919000030002' });
    // Keep the call path off the network (gateway + push are spied).
    const gateway = testApp.app.get(MessagesGateway);
    jest.spyOn(gateway, 'emitCallRing').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('registers a push token (204) + upserts a UserDevice row', async () => {
    const res = await authedInject(testApp, {
      method: 'POST',
      url: '/push/tokens',
      token: alice.accessToken,
      payload: { expoPushToken: TOKEN_A, platform: 'ANDROID' },
    });
    expect(res.statusCode).toBe(204);
    const row = await testApp.prisma.userDevice.findUnique({ where: { expoPushToken: TOKEN_A } });
    expect(row?.userId).toBe(alice.id);
    expect(row?.platform).toBe('ANDROID');
  });

  it('re-registering the same token reassigns userId (idempotent upsert — one row)', async () => {
    await authedInject(testApp, {
      method: 'POST',
      url: '/push/tokens',
      token: alice.accessToken,
      payload: { expoPushToken: TOKEN_A, platform: 'ANDROID' },
    });
    // Same physical device, now Bob logs in on it.
    await authedInject(testApp, {
      method: 'POST',
      url: '/push/tokens',
      token: bob.accessToken,
      payload: { expoPushToken: TOKEN_A, platform: 'ANDROID' },
    });
    const rows = await testApp.prisma.userDevice.findMany({ where: { expoPushToken: TOKEN_A } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(bob.id);
  });

  it('DELETE /push/tokens/:token removes the row', async () => {
    await authedInject(testApp, {
      method: 'POST',
      url: '/push/tokens',
      token: alice.accessToken,
      payload: { expoPushToken: TOKEN_A, platform: 'IOS' },
    });
    const del = await authedInject(testApp, {
      method: 'DELETE',
      url: `/push/tokens/${encodeURIComponent(TOKEN_A)}`,
      token: alice.accessToken,
    });
    expect(del.statusCode).toBe(204);
    const row = await testApp.prisma.userDevice.findUnique({ where: { expoPushToken: TOKEN_A } });
    expect(row).toBeNull();
  });

  it('minting a call triggers a wakeup push to the callee', async () => {
    const push = testApp.app.get(PushService);
    const notifySpy = jest.spyOn(push, 'notifyCall').mockResolvedValue(undefined);

    const chat = await authedInject(testApp, {
      method: 'POST',
      url: '/chats/one-on-one',
      token: alice.accessToken,
      payload: { contactUserId: bob.id },
    });
    const chatId = chat.json<{ chatId: string }>().chatId;

    const mint = await authedInject(testApp, {
      method: 'POST',
      url: '/calls/token',
      token: alice.accessToken,
      payload: { chatId, kind: 'VOICE' },
    });
    expect(mint.statusCode).toBe(200);
    // Callee (Bob) gets the wakeup push; payload carries the room + ring window.
    expect(notifySpy).toHaveBeenCalledWith(
      bob.id,
      expect.objectContaining({ kind: 'VOICE', chatId, initiatorName: 'Alice' }),
    );
  });
});
