import { createMMKV } from 'react-native-mmkv';

export const storage = createMMKV({ id: 'scalechat' });

/**
 * Centralised MMKV key registry. Strings live here so the keys stay greppable
 * and there's a single place to migrate / clear on sign-out.
 */
export const StorageKeys = {
  authCurrentUser: 'auth.currentUser',
  authPendingPhone: 'auth.pendingPhone',
  authAccessToken: 'auth.accessToken',
  authRefreshToken: 'auth.refreshToken',
  /** Stable per-install identifier; survives reloads, cleared on signOut. */
  authDeviceId: 'auth.deviceId',
  /**
   * Snapshot of the chat mock store (threads + messages). Bumped to v2 when
   * the Contact Page slice added the College Group thread + favourite flag —
   * existing dev installs need a fresh seed instead of the legacy snapshot.
   */
  chatSnapshot: 'chat.snapshot.v2',
  /** Per-thread last-seen sequence — mirrors the eventual socket session resume. */
  chatLastSequencePrefix: 'chat.lastSequence.',
  /** Manual theme override layered on top of useColorScheme(): 'system' | 'light' | 'dark'. */
  themeMode: 'app.themeMode.v1',
  /** Local cache of /chats/filters so the filter menu paints without a network round-trip. */
  chatFiltersCache: 'chat.filters.cache.v1',
  /**
   * Device-contacts discovery cache — `{ matches: ContactDiscoveryMatch[],
   * expiresAt: number }`. 24h TTL so re-opening Import Contacts within a
   * day skips both the OS permission re-prompt cost AND the
   * `Contacts.getContactsAsync()` + discovery round-trip.
   */
  contactsDiscoveryCache: 'contacts.discovery.cache.v1',
} as const;

export function setJson<T>(key: string, value: T): void {
  storage.set(key, JSON.stringify(value));
}

export function getJson<T>(key: string): T | null {
  const raw = storage.getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearKeys(keys: readonly string[]): void {
  keys.forEach((k) => storage.remove(k));
}
