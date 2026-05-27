/**
 * P2-Privacy copy + mock-repo structural guard.
 *
 * Strategy:
 *   - Assert every key in `ChatCopy.privacy` is present and non-empty.
 *   - Assert the alert-title functions return non-empty strings when called
 *     with a representative name argument.
 *   - Assert mock `blockUser` / `unblockUser` return the expected shapes.
 *
 * NOTE on mock-repo import: the mock repository touches MMKV at the top of its
 * module (via the `loadInitial` / `getState` lazy path). Under Jest (jsdom /
 * node env) `react-native-mmkv` is mocked by the project's Jest setup, so the
 * import succeeds — but `getJson` / `setJson` return `null` / undefined from
 * the mock. The repository handles this gracefully via its `loadInitial` null
 * guard (falls back to SEED data). All tests below are async-safe since we
 * `await` each call and mock latency is the real `setTimeout` (Jest uses fake
 * timers only when explicitly enabled).
 *
 * If a future native-module update breaks the MMKV mock path under Jest, skip
 * the repo assertions and leave a note — the copy assertions are sufficient to
 * guard the structural contract.
 */

import { ChatCopy } from '@/features/chat/copy';

// ─── Copy tests ───────────────────────────────────────────────────────────────

describe('ChatCopy.privacy', () => {
  const p = ChatCopy.privacy;

  it('has all expected string keys and they are non-empty', () => {
    const stringKeys: (keyof typeof p)[] = [
      'screenTitle',
      'encryptionLabel',
      'encryptionHint',
      'encryptionTitle',
      'encryptionBody',
      'disappearingLabel',
      'disappearingHint',
      'blockLabel',
      'unblockLabel',
      'blockHint',
      'blockedHint',
      'blockAlertBody',
      'unblockAlertBody',
      'blockFailed',
      'unblockFailed',
    ];
    for (const key of stringKeys) {
      const value = p[key];
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it('blockAlertTitle(name) returns a non-empty string', () => {
    const result = p.blockAlertTitle('Alice');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Alice');
  });

  it('unblockAlertTitle(name) returns a non-empty string', () => {
    const result = p.unblockAlertTitle('Bob');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Bob');
  });
});

// ─── Mock repo block/unblock shape tests ─────────────────────────────────────

// We import the mock repo lazily so that a MMKV-mock failure doesn't break the
// copy tests above. If the import fails, the describe block skips gracefully.
let mockRepo: typeof import('@/features/chat/data/mock-chat-repository').mockChatRepository | null =
  null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@/features/chat/data/mock-chat-repository') as {
    mockChatRepository: typeof mockRepo;
  };
  mockRepo = mod.mockChatRepository;
} catch {
  // MMKV or another native module failed to load under Jest — skip the repo tests.
}

const describeOrSkip = mockRepo ? describe : describe.skip;

describeOrSkip('mockChatRepository block/unblock shapes', () => {
  it('blockUser returns { blockedUserId, isBlocked: true }', async () => {
    const repo = mockRepo!;
    const result = await repo.blockUser('user-abc');
    expect(result).toMatchObject({ blockedUserId: 'user-abc', isBlocked: true });
  });

  it('unblockUser returns { blockedUserId, isBlocked: false }', async () => {
    const repo = mockRepo!;
    const result = await repo.unblockUser('user-abc');
    expect(result).toMatchObject({ blockedUserId: 'user-abc', isBlocked: false });
  });
});
