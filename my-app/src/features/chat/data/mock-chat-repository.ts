import { StorageKeys, getJson, setJson } from '@/lib/mmkv';

import type { Message, Thread } from '../types';
import type { ChatRepository } from './chat-repository';
import { SEED_CONTACT_BY_ID, SEED_MESSAGES, SEED_THREADS } from './seed';

/**
 * In-memory + MMKV-backed implementation of `ChatRepository`. Plays the role
 * of the eventual NestJS chat gateway so screens never see the wire format.
 *
 * Persistence strategy (matches CLAUDE.md §4 "Frontend implications"):
 *   - Threads + messages persist to MMKV so a reload doesn't lose drafts/sends.
 *   - `clientMessageId` is supplied by the caller for idempotency parity with
 *     the eventual `message:send` socket event.
 */

type Snapshot = {
  threads: Thread[];
  messagesByThread: Record<string, Message[]>;
};

const MIN_LATENCY_MS = 80;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadInitial(): Snapshot {
  const persisted = getJson<Snapshot>(StorageKeys.chatSnapshot);
  if (persisted && persisted.threads && persisted.messagesByThread) return persisted;
  const seed: Snapshot = {
    threads: clone(SEED_THREADS),
    messagesByThread: clone(SEED_MESSAGES),
  };
  setJson(StorageKeys.chatSnapshot, seed);
  return seed;
}

// Lazy — `loadInitial()` touches MMKV, which throws under web SSR
// (no `localStorage` on the server). Top-level execution would happen
// during Metro's static web bundle pass; defer to first method call.
let state: Snapshot | null = null;
const listeners = new Set<() => void>();

function getState(): Snapshot {
  if (state === null) state = loadInitial();
  return state;
}

function persist(): void {
  setJson(StorageKeys.chatSnapshot, getState());
  listeners.forEach((l) => l());
}

function sleep(ms: number = MIN_LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextSequence(threadId: string): number {
  const msgs = getState().messagesByThread[threadId] ?? [];
  return msgs.reduce((max, m) => Math.max(max, m.sequence), 0) + 1;
}

export const mockChatRepository: ChatRepository = {
  async listThreads() {
    await sleep();
    // Most-recent first.
    return clone(getState().threads).sort((a, b) =>
      b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt)
    );
  },

  async getThread(threadId) {
    await sleep();
    return clone(getState().threads.find((t) => t.id === threadId) ?? null);
  },

  async listMessages(threadId) {
    await sleep();
    return clone(getState().messagesByThread[threadId] ?? []);
  },

  async sendMessage(input) {
    await sleep();
    const s = getState();
    const sequence = nextSequence(input.threadId);
    const base = {
      id: input.clientMessageId,
      threadId: input.threadId,
      senderId: 'me' as const,
      sequence,
      createdAt: new Date().toISOString(),
      status: 'sent' as const,
    };
    const msg: Message =
      input.type === 'text'
        ? { ...base, type: 'text', text: input.text }
        : input.type === 'voice'
          ? {
              ...base,
              type: 'voice',
              durationSec: input.durationSec,
              waveform: input.waveform,
              // Mock keeps the local file URI so the player works offline.
              mediaUrl: input.uri,
            }
          : {
              ...base,
              type: 'image',
              mediaUrl: input.uri,
              width: input.width,
              height: input.height,
            };

    const list = s.messagesByThread[input.threadId] ?? [];
    s.messagesByThread = {
      ...s.messagesByThread,
      [input.threadId]: [...list, msg],
    };
    s.threads = s.threads.map((t) =>
      t.id === input.threadId
        ? { ...t, lastMessage: msg, lastReadSequence: sequence, unreadCount: 0 }
        : t
    );
    persist();
    return clone(msg);
  },

  async deleteMessage(threadId, messageId) {
    await sleep();
    const s = getState();
    const list = s.messagesByThread[threadId];
    if (!list) return;
    const at = list.findIndex((m) => m.id === messageId);
    if (at < 0) return;
    const prev = list[at]!;
    const tombstone = {
      ...prev,
      deletedAt: new Date().toISOString(),
      ...(prev.type === 'text'
        ? { text: '' }
        : prev.type === 'voice'
          ? { durationSec: 0, waveform: [] }
          : { mediaUrl: '', width: 0, height: 0 }),
    } as Message;
    s.messagesByThread[threadId] = [...list.slice(0, at), tombstone, ...list.slice(at + 1)];
    persist();
  },

  async markThreadRead(threadId) {
    await sleep();
    const s = getState();
    s.threads = s.threads.map((t) =>
      t.id === threadId
        ? { ...t, unreadCount: 0, lastReadSequence: t.lastMessage.sequence }
        : t
    );
    persist();
  },

  async markAllRead() {
    await sleep();
    const s = getState();
    s.threads = s.threads.map((t) =>
      t.unreadCount > 0
        ? { ...t, unreadCount: 0, lastReadSequence: t.lastMessage.sequence }
        : t
    );
    persist();
  },

  async toggleFavourite(threadId) {
    await sleep();
    const s = getState();
    s.threads = s.threads.map((t) =>
      t.id === threadId ? { ...t, isFavourite: !t.isFavourite } : t
    );
    persist();
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Exposed for tests / debug — never call this from screens. */
export function __resetChatMockForTests(): void {
  state = {
    threads: clone(SEED_THREADS),
    messagesByThread: clone(SEED_MESSAGES),
  };
  setJson(StorageKeys.chatSnapshot, state);
  listeners.forEach((l) => l());
}

/** Re-export for screens that need to look up by id without going through the repo. */
export const ContactById = SEED_CONTACT_BY_ID;
