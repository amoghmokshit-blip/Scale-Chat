import { MAX_PINNED_PER_CHAT } from '@scalechat/shared';
import type {
  CallAcceptResponse,
  CallKind,
  CallSummary,
  CallTokenResponse,
  ChatStorageSummary,
  DevicePlatform,
  MessageKind,
  MessageSearchPage,
} from '@scalechat/shared';

import { ApiError } from '@/lib/api-client';
import { StorageKeys, getJson, setJson } from '@/lib/mmkv';

import type { CreatePollInput, Message, PollMessage, Thread } from '../types';
import type { ChatRepository } from './chat-repository';
import { searchMessages as searchMessagesImpl } from './search-message-utils';
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

// Threads created via `createOneOnOne` but not yet messaged. They're visible to
// `getThread` (so the thread screen renders) but kept out of the home list until
// the first `sendMessage` materialises them — mirroring WhatsApp, where a brand
// new chat only appears in the chat list once you've sent something.
const pendingThreads = new Map<string, Thread>();

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

/**
 * Toggle a reaction aggregate on a message in place (mock-only). Mirrors the
 * api repo's `bumpReactionLocally` math: add bumps/inserts + flips reactedByMe,
 * remove decrements/drops. Searches every thread since the screen passes only
 * a messageId.
 */
function mutateReaction(messageId: string, emoji: string, isAdd: boolean): void {
  const s = getState();
  for (const threadId of Object.keys(s.messagesByThread)) {
    const list = s.messagesByThread[threadId]!;
    const at = list.findIndex((m) => m.id === messageId);
    if (at < 0) continue;
    const msg = list[at]!;
    const current = msg.reactions ?? [];
    const ri = current.findIndex((r) => r.emoji === emoji);
    let nextReactions = current;
    if (isAdd) {
      if (ri >= 0) {
        if (current[ri]!.reactedByMe) return;
        nextReactions = current.map((r, i) =>
          i === ri ? { ...r, count: r.count + 1, reactedByMe: true } : r,
        );
      } else {
        nextReactions = [...current, { emoji, count: 1, reactedByMe: true }];
      }
    } else {
      if (ri < 0 || !current[ri]!.reactedByMe) return;
      const nextCount = current[ri]!.count - 1;
      nextReactions =
        nextCount <= 0
          ? current.filter((_, i) => i !== ri)
          : current.map((r, i) => (i === ri ? { ...r, count: nextCount, reactedByMe: false } : r));
    }
    s.messagesByThread[threadId] = [
      ...list.slice(0, at),
      { ...msg, reactions: nextReactions } as Message,
      ...list.slice(at + 1),
    ];
    persist();
    return;
  }
}

export const mockChatRepository: ChatRepository = {
  // Mock ignores customFilterId — custom filters require real backend persistence
  // and aren't useful against an in-memory seed. The arg is accepted to keep the
  // interface contract identical to the API impl.
  async listThreads() {
    await sleep();
    // Most-recent first.
    return clone(getState().threads).sort((a, b) =>
      b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt)
    );
  },

  async getThread(threadId) {
    await sleep();
    const existing = getState().threads.find((t) => t.id === threadId);
    if (existing) return clone(existing);
    // Fall back to a not-yet-messaged chat so the thread screen can render its
    // header/counterpart immediately after `createOneOnOne`.
    return clone(pendingThreads.get(threadId) ?? null);
  },

  async createOneOnOne(args) {
    await sleep();
    const s = getState();
    const matches = (c: Thread['counterpart']): boolean =>
      (args.contactUserId != null && c.id === args.contactUserId) ||
      (args.phoneE164 != null && c.phoneE164 === args.phoneE164);

    // Reuse an existing visible thread or a pending one for the same peer.
    const visible = s.threads.find((t) => t.kind === 'direct' && matches(t.counterpart));
    if (visible) return { chatId: visible.id };
    for (const [id, t] of pendingThreads) {
      if (matches(t.counterpart)) return { chatId: id };
    }

    // Create a fresh, not-yet-messaged thread. The placeholder `lastMessage` is
    // never shown (pending threads are excluded from the home list); the first
    // `sendMessage` replaces it when the thread materialises.
    const chatId = `t-new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const counterpartId = args.contactUserId ?? `u-${args.phoneE164 ?? chatId}`;
    const placeholder: Message = {
      id: `${chatId}-seed`,
      threadId: chatId,
      senderId: counterpartId,
      sequence: 0,
      createdAt: new Date().toISOString(),
      status: 'sent',
      type: 'text',
      text: '',
    };
    const thread: Thread = {
      id: chatId,
      kind: 'direct',
      counterpart: {
        id: counterpartId,
        displayName: args.displayName ?? args.phoneE164 ?? 'New chat',
        phoneE164: args.phoneE164,
        avatarUri: args.avatarUri ?? undefined,
      },
      lastMessage: placeholder,
      unreadCount: 0,
      lastReadSequence: 0,
    };
    pendingThreads.set(chatId, thread);
    return { chatId };
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
    let msg: Message;
    if (input.type === 'text') {
      msg = { ...base, type: 'text', text: input.text };
    } else if (input.type === 'voice') {
      msg = {
        ...base,
        type: 'voice',
        durationSec: input.durationSec,
        waveform: input.waveform,
        // Mock keeps the local file URI so the player works offline.
        mediaUrl: input.uri,
      };
    } else if (input.type === 'image') {
      msg = { ...base, type: 'image', mediaUrl: input.uri, width: input.width, height: input.height };
    } else if (input.type === 'document') {
      msg = {
        ...base,
        type: 'document',
        mediaUrl: input.uri,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
      };
    } else if (input.type === 'video') {
      msg = {
        ...base,
        type: 'video',
        mediaUrl: input.uri,
        width: input.width,
        height: input.height,
        durationSec: input.durationSec,
      };
    } else if (input.type === 'location') {
      msg = {
        ...base,
        type: 'location',
        latitude: input.latitude,
        longitude: input.longitude,
        locationName: input.locationName ?? null,
      };
    } else {
      msg = {
        ...base,
        type: 'contact',
        contactName: input.contactName,
        contactPhoneE164: input.contactPhoneE164,
      };
    }

    // Materialise a pending (not-yet-messaged) thread into the visible list on
    // its first send so it appears in the home chat list.
    if (!s.threads.some((t) => t.id === input.threadId)) {
      const pending = pendingThreads.get(input.threadId);
      if (pending) {
        s.threads = [...s.threads, pending];
        pendingThreads.delete(input.threadId);
      }
    }

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
          : prev.type === 'document'
            ? { mediaUrl: '', fileName: '', sizeBytes: 0, mimeType: '' }
            : prev.type === 'video'
              ? { mediaUrl: '', width: 0, height: 0, durationSec: 0 }
              : prev.type === 'location'
                ? { latitude: 0, longitude: 0, locationName: null }
                : prev.type === 'contact'
                  ? { contactName: '', contactPhoneE164: '' }
                  : prev.type === 'poll'
                    ? { question: '', options: [], totalVoters: 0, closedAt: null }
                    : { mediaUrl: '', width: 0, height: 0 }),
    } as Message;
    s.messagesByThread[threadId] = [...list.slice(0, at), tombstone, ...list.slice(at + 1)];
    persist();
  },

  async reportMessage() {
    // Mock store has no moderation queue — pretend the report was filed.
    // The api repo is the only thing that actually POSTs to /messages/:id/report.
    await sleep();
  },

  async getProfileCard(userId) {
    await sleep();
    // Look up the contact in the chat threads (counterpart shape) and synthesise
    // a profile card. The mock never gates by privacy — useful for offline UI dev.
    const s = getState();
    const thread = s.threads.find((t) => t.counterpart.id === userId);
    const fromContacts = SEED_CONTACT_BY_ID[userId];
    const contact = thread?.counterpart ?? fromContacts ?? null;
    if (!contact) throw new Error(`mock: no contact ${userId}`);
    return {
      id: userId,
      fullName: contact.displayName,
      phoneE164: contact.phoneE164 ?? '+91 00000 00000',
      avatarUri: contact.avatarUri ?? null,
      bio: null,
      isPremium: false,
      createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      commonChatId: thread?.id ?? null,
      isBlocked: false,
    };
  },

  async listMedia(threadId, args) {
    await sleep();
    const s = getState();
    const all = s.messagesByThread[threadId] ?? [];
    const filtered = all.filter((m) => {
      if (m.deletedAt) return false;
      if (args?.kind === 'IMAGE') return m.type === 'image';
      if (args?.kind === 'VOICE') return m.type === 'voice';
      return m.type === 'image' || m.type === 'voice';
    });
    return { items: clone(filtered), nextCursor: null, hasMore: false };
  },

  async getCommonGroups() {
    await sleep();
    return { items: [] };
  },

  async muteChat(threadId, until) {
    await sleep();
    return { chatId: threadId, mutedUntil: until ? until.toISOString() : null };
  },

  async clearChat(threadId) {
    await sleep();
    const s = getState();
    s.messagesByThread = { ...s.messagesByThread, [threadId]: [] };
    persist();
    return { chatId: threadId, clearedAt: new Date().toISOString() };
  },

  async blockUser(userId) {
    await sleep();
    return { blockedUserId: userId, isBlocked: true };
  },

  async unblockUser(userId) {
    await sleep();
    return { blockedUserId: userId, isBlocked: false };
  },

  // Reactions (Tranche 2.A). The mock toggles the aggregate in place so the
  // pill row + strip work fully offline — the project's primary dev flow per
  // CLAUDE.md §3. `reactedByMe` doubles as "this device reacted" since the
  // mock has a single local user.
  async addReaction(messageId, emoji) {
    await sleep();
    mutateReaction(messageId, emoji, true);
  },

  async removeReaction(messageId, emoji) {
    await sleep();
    mutateReaction(messageId, emoji, false);
  },

  // Forward (Tranche 2.E). Clone the source content into each target thread —
  // dropping reply context AND reactions (forwards don't carry either), setting
  // `forwardedFromMessageId` so the bubble shows the "↪ Forwarded" label, and
  // assigning a fresh id + sequence per target. `persist()` fires the listener
  // bus so an open target thread repaints (the mock has no socket).
  async forwardMessage(messageId, targetThreadIds) {
    await sleep();
    const s = getState();

    // Locate the source message across every thread (screen passes only an id).
    let source: Message | null = null;
    for (const list of Object.values(s.messagesByThread)) {
      const found = list.find((m) => m.id === messageId);
      if (found) {
        source = found;
        break;
      }
    }
    if (!source || source.deletedAt) {
      return { delivered: 0, skipped: targetThreadIds.length };
    }

    let delivered = 0;
    let skipped = 0;
    const threadIds = new Set(s.threads.map((t) => t.id));
    for (const targetId of targetThreadIds) {
      if (!threadIds.has(targetId)) {
        skipped += 1;
        continue;
      }
      const sequence = nextSequence(targetId);
      const clone = {
        ...source,
        id: `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        threadId: targetId,
        senderId: 'me' as const,
        sequence,
        createdAt: new Date().toISOString(),
        status: 'sent' as const,
        forwardedFromMessageId: source.id,
        // Forwarded copies stand alone — no reply context, no inherited reactions.
        replyToMessageId: null,
        reactions: [],
      } as Message;
      const list = s.messagesByThread[targetId] ?? [];
      s.messagesByThread = { ...s.messagesByThread, [targetId]: [...list, clone] };
      s.threads = s.threads.map((t) =>
        t.id === targetId
          ? { ...t, lastMessage: clone, lastReadSequence: sequence, unreadCount: 0 }
          : t,
      );
      delivered += 1;
    }
    persist();
    return { delivered, skipped };
  },

  // Pin / unpin (Tranche 2.E). Flips `pinnedAt` in place (immutable splice) +
  // persist() so the open thread's bubble pip updates offline. The mock fakes
  // the server's 3-pin cap so the cap → rollback → Alert path is exercisable on
  // the emulator (real cap lives server-side; mock has no socket to echo).
  async pinMessage(threadId, messageId) {
    await sleep();
    const s = getState();
    const list = s.messagesByThread[threadId];
    if (!list) return;
    const at = list.findIndex((m) => m.id === messageId);
    if (at < 0) return;
    const msg = list[at]!;
    if (msg.pinnedAt) return; // already pinned — idempotent
    const pinnedCount = list.filter((m) => m.pinnedAt != null && m.deletedAt == null).length;
    if (pinnedCount >= MAX_PINNED_PER_CHAT) {
      throw new ApiError(409, {
        code: 'pin_cap_exceeded',
        message: `You've pinned the maximum of ${MAX_PINNED_PER_CHAT} messages.`,
      });
    }
    s.messagesByThread[threadId] = [
      ...list.slice(0, at),
      { ...msg, pinnedAt: new Date().toISOString() } as Message,
      ...list.slice(at + 1),
    ];
    persist();
  },

  async unpinMessage(threadId, messageId) {
    await sleep();
    const s = getState();
    const list = s.messagesByThread[threadId];
    if (!list) return;
    const at = list.findIndex((m) => m.id === messageId);
    if (at < 0) return;
    const msg = list[at]!;
    s.messagesByThread[threadId] = [
      ...list.slice(0, at),
      { ...msg, pinnedAt: null } as Message,
      ...list.slice(at + 1),
    ];
    persist();
  },

  // Polls (Tranche 2.F). Mock parity with the real `PollsModule`:
  //   - createPoll appends a PollMessage row with `totalVoters: 0` + all
  //     `votedByMe: false` to the target thread.
  //   - votePoll branches single-select replace vs multi-select diff using
  //     the same shape as the api repo's `applyVoteLocally`. The single local
  //     voter is treated as `me`.
  //   - closePoll is sender-only — throws `not_sender` ApiError when called
  //     by a non-author so the same error path runs as against the server.
  async createPoll(input: CreatePollInput) {
    await sleep();
    const s = getState();
    const sequence = nextSequence(input.threadId);
    const pollMessageId = `mockpoll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const poll: PollMessage = {
      id: input.clientMessageId,
      threadId: input.threadId,
      senderId: 'me',
      sequence,
      createdAt: new Date().toISOString(),
      status: 'sent',
      clientMessageId: input.clientMessageId,
      replyToMessageId: null,
      deletedAt: null,
      type: 'poll',
      pollMessageId,
      question: input.question,
      multiSelect: input.multiSelect,
      anonymous: false,
      closedAt: null,
      totalVoters: 0,
      options: input.options.map((label, i) => ({
        id: `${pollMessageId}-${i}`,
        ordinal: i,
        label,
        count: 0,
        votedByMe: false,
      })),
    };
    const list = s.messagesByThread[input.threadId] ?? [];
    s.messagesByThread = {
      ...s.messagesByThread,
      [input.threadId]: [...list, poll],
    };
    s.threads = s.threads.map((t) =>
      t.id === input.threadId
        ? { ...t, lastMessage: poll, lastReadSequence: sequence, unreadCount: 0 }
        : t,
    );
    persist();
    return clone(poll);
  },

  async votePoll(messageId, optionIds) {
    await sleep();
    const s = getState();
    for (const threadId of Object.keys(s.messagesByThread)) {
      const list = s.messagesByThread[threadId]!;
      const at = list.findIndex((m) => m.id === messageId);
      if (at < 0) continue;
      const msg = list[at]!;
      if (msg.type !== 'poll') return;
      if (msg.closedAt) {
        throw new ApiError(409, {
          code: 'poll_closed',
          message: 'This poll has been closed.',
        });
      }
      const selected = new Set(optionIds);
      const nextOptions = msg.options.map((opt) => {
        const wantsVote = selected.has(opt.id);
        if (wantsVote && !opt.votedByMe) {
          return { ...opt, count: opt.count + 1, votedByMe: true };
        }
        if (!wantsVote && opt.votedByMe) {
          return { ...opt, count: Math.max(0, opt.count - 1), votedByMe: false };
        }
        return opt;
      });
      const iVoteAfter = nextOptions.some((o) => o.votedByMe);
      const iVoteBefore = msg.options.some((o) => o.votedByMe);
      const totalDelta = iVoteAfter && !iVoteBefore ? 1 : !iVoteAfter && iVoteBefore ? -1 : 0;
      s.messagesByThread[threadId] = [
        ...list.slice(0, at),
        {
          ...msg,
          options: nextOptions,
          totalVoters: Math.max(0, msg.totalVoters + totalDelta),
        },
        ...list.slice(at + 1),
      ];
      persist();
      return;
    }
  },

  async closePoll(messageId) {
    await sleep();
    const s = getState();
    for (const threadId of Object.keys(s.messagesByThread)) {
      const list = s.messagesByThread[threadId]!;
      const at = list.findIndex((m) => m.id === messageId);
      if (at < 0) continue;
      const msg = list[at]!;
      if (msg.type !== 'poll') return;
      // Mock has a single local user (`me`) — only sender can close. If the
      // poll was authored by the counterpart, mirror the server's 403.
      if (msg.senderId !== 'me') {
        throw new ApiError(403, {
          code: 'not_sender',
          message: 'Only the poll creator can close this poll.',
        });
      }
      if (msg.closedAt) return; // idempotent
      s.messagesByThread[threadId] = [
        ...list.slice(0, at),
        { ...msg, closedAt: new Date().toISOString() },
        ...list.slice(at + 1),
      ];
      persist();
      return;
    }
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

  // ─── Calls (Tranche 2.H/2.I) ────────────────────────────────────────────────
  // Mock returns synthetic tokens so the call UI mounts without crashing in the
  // offline dev flow. Real media needs USE_MOCKS=false + the live backend —
  // a connect against `wss://mock.invalid` fails gracefully into the call
  // screen's abnormal-termination → back path.

  async startCall(threadId, kind: CallKind): Promise<CallTokenResponse> {
    await sleep();
    return {
      callId: `mock-call-${Date.now()}`,
      roomName: `mock-room-${threadId}`,
      accessToken: 'mock-access-token',
      wsUrl: 'wss://mock.invalid',
      expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    };
  },

  async acceptCall(_callId): Promise<CallAcceptResponse> {
    await sleep();
    return {
      roomName: 'mock-room',
      accessToken: 'mock-access-token',
      wsUrl: 'wss://mock.invalid',
      expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    };
  },

  async declineCall(_callId) {
    await sleep();
  },

  async hangupCall(_callId) {
    await sleep();
  },

  async listCallsInThread(_threadId): Promise<CallSummary[]> {
    await sleep();
    return [];
  },

  async registerPushToken(_token, _platform: DevicePlatform) {
    // no-op in mock mode (no push service)
  },

  async searchMessages(chatId, q, opts): Promise<MessageSearchPage> {
    await sleep();
    const s = getState();
    const all = s.messagesByThread[chatId] ?? [];
    // Delegate pure search logic to the standalone helper so it's unit-testable
    // without dragging in MMKV / native modules / @scalechat/shared value imports.
    return searchMessagesImpl(all, q, opts) as MessageSearchPage;
  },

  /**
   * Aggregate storage for a chat from the in-memory message snapshot (P2-Storage).
   *
   * Maps mock `type` → `MessageKind` (contact → CONTACT_CARD, others uppercase).
   * Sums `sizeBytes` where present (DOCUMENT), `0` otherwise (media sizes aren't
   * tracked in the mock because the seed uses local `file://` URIs whose sizes are
   * never fetched). Excludes deleted messages. Returned in `totalBytes DESC` order.
   */
  async getChatStorage(chatId): Promise<ChatStorageSummary> {
    await sleep();
    const s = getState();
    const all = s.messagesByThread[chatId] ?? [];

    // Map from mock domain type to MessageKind.
    function typeToKind(type: string): MessageKind {
      if (type === 'contact') return 'CONTACT_CARD';
      if (type === 'call_event') return 'CALL_EVENT';
      return type.toUpperCase() as MessageKind;
    }

    const byKind = new Map<MessageKind, { count: number; bytes: number }>();
    for (const msg of all) {
      if (msg.deletedAt) continue;
      const kind = typeToKind(msg.type);
      const bytes = msg.type === 'document' ? (msg.sizeBytes ?? 0) : 0;
      const prev = byKind.get(kind) ?? { count: 0, bytes: 0 };
      byKind.set(kind, { count: prev.count + 1, bytes: prev.bytes + bytes });
    }

    const perKind = Array.from(byKind.entries())
      .map(([kind, { count, bytes }]) => ({
        kind,
        count,
        totalBytes: String(bytes),
      }))
      .sort((a, b) => Number(BigInt(b.totalBytes) - BigInt(a.totalBytes)));

    const totalBytes = String(perKind.reduce((sum, r) => sum + Number(r.totalBytes), 0));
    return { perKind, totalBytes };
  },

  // ─── Theme (P2-Theme) ────────────────────────────────────────────────────────
  // In-memory map keyed by threadId. `getThread` returns the patched theme so
  // the thread screen can read it back after an optimistic apply. `null` resets.
  async setChatTheme(threadId, theme) {
    await sleep();
    const s = getState();
    s.threads = s.threads.map((t) =>
      t.id === threadId ? { ...t, chatTheme: theme } : t,
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
