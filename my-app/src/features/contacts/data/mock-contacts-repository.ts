import type {
  AddContactBody,
  BulkAddContactsBody,
  BulkAddContactsResponse,
  Contact,
  DiscoverContactsResponse,
  UpdateContactBody,
} from '@scalechat/shared';

import { SEED_CONTACTS } from '@/features/chat/data/seed';

import type { ContactsRepository } from './contacts-repository';

const MIN_LATENCY_MS = 80;
const listeners = new Set<() => void>();

const cache: Contact[] = SEED_CONTACTS
  .filter((c) => !c.id.startsWith('g-'))
  .map((c, idx) => ({
    id: c.id.replace('c-', 'mock-contact-') + '-uuid',
    contactUserId: null,
    phoneE164: c.phoneE164 ?? `+9190000000${idx}`,
    displayName: c.displayName,
    favouriteAt: idx === 0 ? new Date().toISOString() : null,
    avatarUri: null,
    isOnPlatform: true,
    createdAt: new Date(Date.now() - idx * 86_400_000).toISOString(),
  }));

function notify(): void {
  listeners.forEach((l) => l());
}

function sleep(ms = MIN_LATENCY_MS): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const mockContactsRepository: ContactsRepository = {
  async list(args) {
    await sleep();
    const search = args?.search?.toLowerCase();
    const items = search
      ? cache.filter(
          (c) =>
            c.displayName.toLowerCase().includes(search) ||
            c.phoneE164.toLowerCase().includes(search),
        )
      : [...cache];
    return { items, nextCursor: null };
  },

  async add(body: AddContactBody) {
    await sleep();
    if (cache.some((c) => c.phoneE164 === body.phoneE164)) {
      throw new Error('Contact already saved.');
    }
    const created: Contact = {
      id: uuid(),
      contactUserId: null,
      phoneE164: body.phoneE164,
      displayName: body.displayName,
      favouriteAt: null,
      avatarUri: null,
      isOnPlatform: false,
      createdAt: new Date().toISOString(),
    };
    cache.unshift(created);
    notify();
    return created;
  },

  async update(id: string, patch: UpdateContactBody) {
    await sleep();
    const idx = cache.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error('Contact not found');
    const next: Contact = {
      ...cache[idx]!,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.favourite !== undefined
        ? { favouriteAt: patch.favourite ? new Date().toISOString() : null }
        : {}),
    };
    cache[idx] = next;
    notify();
    return next;
  },

  async remove(id: string) {
    await sleep();
    const idx = cache.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error('Contact not found');
    cache.splice(idx, 1);
    notify();
  },

  async discover(phones: string[]): Promise<DiscoverContactsResponse> {
    await sleep();
    // Treat every seeded mock contact as "on platform" — the mock seam is
    // for offline UI development, not a faithful backend simulation. The
    // hook + screen need *something* to match against; the seed is it.
    const matchSet = new Set(phones);
    const matches = cache
      .filter((c) => matchSet.has(c.phoneE164))
      .map((c) => ({
        phoneE164: c.phoneE164,
        isOnPlatform: true as const,
        displayName: c.displayName,
        avatarUri: c.avatarUri,
      }));
    return { matches };
  },

  async addMany(body: BulkAddContactsBody): Promise<BulkAddContactsResponse> {
    await sleep();
    // Per-batch dedup (mirror server logic) + skip already-saved phones.
    const seen = new Set<string>();
    const unique = body.items.filter((item) => {
      if (seen.has(item.phoneE164)) return false;
      seen.add(item.phoneE164);
      return true;
    });
    const saved: Contact[] = [];
    let alreadyHad = 0;
    for (const item of unique) {
      if (cache.some((c) => c.phoneE164 === item.phoneE164)) {
        alreadyHad += 1;
        continue;
      }
      const created: Contact = {
        id: uuid(),
        contactUserId: null,
        phoneE164: item.phoneE164,
        displayName: item.displayName,
        favouriteAt: null,
        avatarUri: null,
        isOnPlatform: false,
        createdAt: new Date().toISOString(),
      };
      cache.unshift(created);
      saved.push(created);
    }
    if (saved.length > 0) notify();
    return { saved, alreadyHad };
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
