import type {
  BlockStatusResponse,
  CallAcceptResponse,
  CallKind,
  CallListResponse,
  CallSummary,
  CallTokenResponse,
  ChatDetailDto,
  ChatListResponse,
  ChatStorageSummary,
  ClearChatResponse,
  CommonGroupsListResponse,
  CreateMessageReportBody,
  DevicePlatform,
  ForwardRequestBody,
  ForwardResponse,
  MediaUploadKind,
  MediaUploadResponse,
  MessageDto,
  MessageListResponse,
  MessageReportAck,
  MessageSearchPage,
  MuteChatBody,
  MuteChatResponse,
  PollAggregate,
  PollCreateRequestBody,
  ReactionAggregate,
  ReactionsList,
  SendMessageBody,
  UserProfileCard,
} from '@scalechat/shared';
import * as LegacyFileSystem from 'expo-file-system/legacy';

import { apiClient, ApiError } from '@/lib/api-client';
import { chatSocket } from '@/lib/chat-socket';

import type {
  Contact,
  CreatePollInput,
  Message,
  MessageStatus,
  PollMessage,
  SendMessageInput,
  Thread,
} from '../types';
import type { ChatRepository, LoadOlderResult } from './chat-repository';
import { dtoToMessage } from './dto-to-message';
import { mockChatRepository } from './mock-chat-repository';
import { applyVoteLocally } from './poll-vote-math';

// Re-export so existing imports of `dtoToMessage` from this module continue to work.
export { dtoToMessage };

// ─── Listener bus ─────────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
function notify(): void {
  listeners.forEach((l) => l());
}

// ─── In-memory message cache ─────────────────────────────────────────────────
//
// The cache is the source of truth that screens read from. REST fetches seed it;
// socket `message:new` events keep it live; optimistic sends insert directly.
// The cache never grows unbounded — we only hold messages the user has actually
// pulled in via listMessages / loadOlder.

type ThreadCache = {
  messages: Message[];                // chronological asc
  oldestCursor: string | null;        // cursor for loadOlder; null once exhausted
  hasMoreOlder: boolean;
};

const cacheByChatId = new Map<string, ThreadCache>();
const counterpartByChatId = new Map<string, string>();
const highestSeqByChatId = new Map<string, bigint>();
/**
 * The counterpart's `lastReadSequence` as of the most recent `/chats/:id`
 * fetch. Used by `listMessages` to mark mine-messages already read by the
 * peer as `read` (lime double-tick) on initial load — closes Phase A cold-
 * start read-receipt gap (known-limit #1 from the 2026-05-25 verify).
 *
 * Live updates flip rows via the existing `chatSocket.onReadReceipt`
 * subscription; this cache is only consulted on the first paint of a thread.
 */
const counterpartLastReadByChatId = new Map<string, bigint>();

function getCache(chatId: string): ThreadCache {
  let c = cacheByChatId.get(chatId);
  if (!c) {
    c = { messages: [], oldestCursor: null, hasMoreOlder: true };
    cacheByChatId.set(chatId, c);
  }
  return c;
}

function rememberSequence(chatId: string, raw: string | number | bigint): void {
  const next = typeof raw === 'bigint' ? raw : BigInt(raw);
  const prev = highestSeqByChatId.get(chatId);
  if (prev === undefined || next > prev) highestSeqByChatId.set(chatId, next);
}

/** Insert a message into the cache idempotently. Dedups by durable `id`, then
 *  by `clientMessageId` (matches the optimistic insert whose id was the
 *  clientMessageId). Returns true if changed. */
function upsertMessage(chatId: string, m: Message): boolean {
  const c = getCache(chatId);
  const byId = c.messages.findIndex((x) => x.id === m.id);
  if (byId >= 0) {
    c.messages[byId] = m;
    return true;
  }
  if (m.clientMessageId) {
    const byClient = c.messages.findIndex(
      (x) => x.clientMessageId === m.clientMessageId || x.id === m.clientMessageId
    );
    if (byClient >= 0) {
      c.messages[byClient] = m;
      return true;
    }
  }
  const at = c.messages.findIndex((x) => x.sequence > m.sequence);
  if (at < 0) c.messages.push(m);
  else c.messages.splice(at, 0, m);
  return true;
}

/** Replace a pending message (matched by `pendingId`) with the durable one
 *  returned by the server. Used by the optimistic send path. */
function reconcileSend(chatId: string, pendingId: string, durable: Message): void {
  const c = getCache(chatId);
  const at = c.messages.findIndex((x) => x.id === pendingId);
  if (at >= 0) {
    c.messages[at] = durable;
  } else {
    upsertMessage(chatId, durable);
  }
}

function markPendingFailed(chatId: string, pendingId: string): void {
  const c = getCache(chatId);
  const at = c.messages.findIndex((x) => x.id === pendingId);
  if (at >= 0) {
    const prev = c.messages[at]!;
    c.messages[at] = { ...prev, status: 'failed' };
  }
}

/** Content fields to zero when a message becomes a tombstone — per kind, so a
 *  deleted DOCUMENT/VIDEO doesn't leak its filename/dims (the bubbles also
 *  early-return on `deletedAt`, but clearing is the defensive backstop). */
function tombstoneContent(prev: Message): Partial<Message> {
  switch (prev.type) {
    case 'text':
      return { text: '' };
    case 'voice':
      return { durationSec: 0, waveform: [] };
    case 'document':
      return { mediaUrl: '', fileName: '', sizeBytes: 0, mimeType: '' };
    case 'video':
      return { mediaUrl: '', width: 0, height: 0, durationSec: 0 };
    case 'location':
      return { latitude: 0, longitude: 0, locationName: null };
    case 'contact':
      return { contactName: '', contactPhoneE164: '' };
    case 'poll':
      // Server zeroes `poll: null` on delete; the bubble's tombstone branch
      // renders "This message was deleted" before reaching the poll renderer,
      // so the cleared fields here are belt-and-braces.
      return { question: '', options: [], totalVoters: 0, closedAt: null };
    default:
      return { mediaUrl: '', width: 0, height: 0 };
  }
}

// ─── DTO ↔ domain conversion ──────────────────────────────────────────────────
// Pure conversion lives in `./dto-to-message.ts` so the unit tests can import
// it without dragging in MMKV / socket.io / expo-constants. The re-export at
// the top of this file preserves existing call-sites.

// ─── Media upload helpers ────────────────────────────────────────────────────

const DEFAULT_IMAGE_CONTENT_TYPE = 'image/jpeg';
const VOICE_CONTENT_TYPE = 'audio/m4a';

async function fileSize(uri: string): Promise<number> {
  const info = await LegacyFileSystem.getInfoAsync(uri);
  // FileInfo with `exists: true` has `size`. Fall back to 0 if the platform
  // doesn't report it — server-side validation will still gate misuses.
  return (info as { exists: true; size?: number }).size ?? 0;
}

async function requestUploadUrl(input: {
  kind: MediaUploadKind;
  contentType: string;
  sizeBytes: number;
}): Promise<MediaUploadResponse> {
  return apiClient.post<MediaUploadResponse>('/media/upload-url', input);
}

async function putBytes(uploadUrl: string, fileUri: string, contentType: string): Promise<void> {
  const res = await LegacyFileSystem.uploadAsync(uploadUrl, fileUri, {
    httpMethod: 'PUT',
    headers: { 'content-type': contentType },
    uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`media_upload_failed: HTTP ${res.status}`);
  }
}

function previewToMessage(item: ChatListResponse['items'][number]): Message {
  const last = item.lastMessage;
  const senderId =
    last && item.counterpart && last.senderUserId === item.counterpart.id ? item.counterpart.id : 'me';
  const base = {
    id: last?.id ?? `${item.id}-empty`,
    threadId: item.id,
    senderId,
    sequence: last ? Number(last.sequence) : 0,
    createdAt: last?.createdAt ?? new Date().toISOString(),
    status: 'delivered' as MessageStatus,
  };
  if (!last) return { ...base, type: 'text', text: '' };
  if (last.kind === 'VOICE') return { ...base, type: 'voice', durationSec: 0, waveform: [] };
  return { ...base, type: 'text', text: last.preview };
}

function itemToThread(item: ChatListResponse['items'][number]): Thread {
  const counterpart: Contact = item.counterpart
    ? {
        id: item.counterpart.id,
        displayName: item.counterpart.displayName,
        avatarUri: item.counterpart.avatarUri ?? undefined,
      }
    : { id: item.id, displayName: item.title, avatarUri: item.avatarUri ?? undefined };

  const last = previewToMessage(item);
  const threadKind =
    item.kind === 'ONE_ON_ONE' ? 'direct' : item.kind === 'GROUP' ? 'group' : 'super';

  return {
    id: item.id,
    kind: threadKind,
    counterpart,
    lastMessage: last,
    unreadCount: item.unreadCount,
    lastReadSequence: item.lastMessage ? Number(item.lastMessage.sequence) - item.unreadCount : 0,
    isPinned: item.isPinned,
    isArchived: item.isArchived,
    isFavourite: item.isFavourite,
  };
}

function detailToThread(detail: ChatDetailDto, last?: MessageDto): Thread {
  const counterpart: Contact = detail.counterpart
    ? {
        id: detail.counterpart.id,
        displayName: detail.counterpart.displayName,
        phoneE164: detail.counterpart.phoneE164 ?? undefined,
        avatarUri: detail.counterpart.avatarUri ?? undefined,
      }
    : { id: detail.id, displayName: detail.title, avatarUri: detail.avatarUri ?? undefined };

  const kind = detail.kind === 'ONE_ON_ONE' ? 'direct' : detail.kind === 'GROUP' ? 'group' : 'super';
  const fallbackMessage: Message = {
    id: `${detail.id}-empty`,
    threadId: detail.id,
    senderId: counterpart.id,
    sequence: 0,
    createdAt: new Date().toISOString(),
    status: 'delivered',
    type: 'text',
    text: '',
  };

  return {
    id: detail.id,
    kind,
    counterpart,
    lastMessage: last ? dtoToMessage(last, counterpart.id) : fallbackMessage,
    unreadCount: 0,
    lastReadSequence: Number(detail.lastReadSequence),
    chatTheme: detail.chatTheme ?? null,
  };
}

async function fetchDetail(chatId: string): Promise<ChatDetailDto> {
  const detail = await apiClient.get<ChatDetailDto>(`/chats/${chatId}`);
  if (detail.counterpart) counterpartByChatId.set(chatId, detail.counterpart.id);
  if (detail.counterpartLastReadSequence) {
    counterpartLastReadByChatId.set(chatId, BigInt(detail.counterpartLastReadSequence));
  } else {
    counterpartLastReadByChatId.delete(chatId);
  }
  return detail;
}

// ─── Reaction helpers ────────────────────────────────────────────────────────
//
// Used by the optimistic-update path in `addReaction` / `removeReaction` and
// by the `reaction:updated` socket subscriber. Kept local because reactions
// are aggregated per-emoji and the math is simple enough to inline:
//   - add: bump count or insert; flip reactedByMe=true
//   - remove: decrement count or drop the row; flip reactedByMe=false

function locateMessage(messageId: string): { cache: ThreadCache; index: number; message: Message } | null {
  for (const cache of cacheByChatId.values()) {
    const index = cache.messages.findIndex((m) => m.id === messageId);
    if (index >= 0) return { cache, index, message: cache.messages[index]! };
  }
  return null;
}

function bumpReactionLocally(
  prev: ReactionAggregate[] | undefined,
  emoji: string,
  isAdd: boolean,
): ReactionAggregate[] {
  const list = prev ?? [];
  const at = list.findIndex((r) => r.emoji === emoji);
  if (isAdd) {
    if (at >= 0) {
      const row = list[at]!;
      if (row.reactedByMe) return list; // already reacted — no-op
      const next = list.slice();
      next[at] = { ...row, count: row.count + 1, reactedByMe: true };
      return next;
    }
    return [...list, { emoji, count: 1, reactedByMe: true }];
  }
  // Remove path
  if (at < 0) return list;
  const row = list[at]!;
  if (!row.reactedByMe) return list; // haven't reacted — no-op
  const nextCount = row.count - 1;
  if (nextCount <= 0) {
    // Drop the row entirely when nobody else has this emoji on the message.
    return list.filter((_, i) => i !== at);
  }
  const next = list.slice();
  next[at] = { ...row, count: nextCount, reactedByMe: false };
  return next;
}

function applyAuthoritativeAggregate(messageId: string, reactions: ReactionAggregate[]): void {
  const located = locateMessage(messageId);
  if (!located) return;
  located.cache.messages[located.index] = { ...located.message, reactions } as Message;
  notify();
}

function restoreReactions(messageId: string, prev: ReactionAggregate[] | undefined): void {
  const located = locateMessage(messageId);
  if (!located) return;
  located.cache.messages[located.index] = { ...located.message, reactions: prev } as Message;
  notify();
}

/** Set a message's `pinnedAt` in the cache + notify. Used by the optimistic
 *  pin/unpin path (flip → reconcile / rollback) and the pin socket subscribers. */
function setPinnedAt(messageId: string, pinnedAt: string | null): void {
  const located = locateMessage(messageId);
  if (!located) return;
  located.cache.messages[located.index] = { ...located.message, pinnedAt } as Message;
  notify();
}

// ─── Poll helpers (Tranche 2.F) ──────────────────────────────────────────────
//
// Optimistic math lives in `./poll-vote-math.ts` so it can be unit-tested
// without dragging the api repo's MMKV / socket.io / expo-constants imports
// into the Jest graph. The cache splice + restore stay here.

/** Splice a fresh `PollAggregate` onto the cached PollMessage in place. */
function applyPollAggregate(messageId: string, aggregate: PollAggregate): void {
  const located = locateMessage(messageId);
  if (!located) return;
  const prev = located.message;
  if (prev.type !== 'poll') return;
  located.cache.messages[located.index] = {
    ...prev,
    closedAt: aggregate.closedAt,
    totalVoters: aggregate.totalVoters,
    options: aggregate.options,
  };
  notify();
}

/** Restore a snapshot of a poll's mutable state after an optimistic vote fails. */
function restorePollSnapshot(
  messageId: string,
  snapshot: {
    options: PollMessage['options'];
    closedAt: string | null;
    totalVoters: number;
  },
): void {
  const located = locateMessage(messageId);
  if (!located) return;
  const prev = located.message;
  if (prev.type !== 'poll') return;
  located.cache.messages[located.index] = { ...prev, ...snapshot };
  notify();
}

// ─── Socket event wiring (one-time) ───────────────────────────────────────────

let socketWired = false;
function ensureSocketWired(): void {
  if (socketWired) return;
  socketWired = true;
  // Opening the connection is fire-and-forget; if the user isn't authed yet,
  // ensureConnected is a no-op until they sign in.
  void chatSocket.ensureConnected();

  chatSocket.onMessage((m: MessageDto) => {
    const counterpartId = counterpartByChatId.get(m.chatId) ?? '';
    const domain = dtoToMessage(m, counterpartId);
    upsertMessage(m.chatId, domain);
    rememberSequence(m.chatId, m.sequence);
    notify();
  });

  // When the peer's read cursor advances, the server broadcasts `chat:read`
  // with `uptoSequence`. Flip every message I sent at-or-below that sequence
  // from `delivered` → `read` so the bubble's lime double-tick lights up
  // live. Self-reads (my own other devices) and reads from anyone other than
  // the counterpart are ignored — only the peer reading my messages should
  // change my bubble status.
  chatSocket.onReadReceipt((r) => {
    const counterpartId = counterpartByChatId.get(r.chatId);
    if (!counterpartId || r.userId !== counterpartId) return;
    const cache = cacheByChatId.get(r.chatId);
    if (!cache) return;
    const upto = BigInt(r.uptoSequence);
    let changed = false;
    for (let i = 0; i < cache.messages.length; i += 1) {
      const m = cache.messages[i]!;
      if (m.senderId !== 'me') continue;
      if (m.status === 'read') continue;
      if (BigInt(m.sequence) > upto) continue;
      cache.messages[i] = { ...m, status: 'read' as MessageStatus };
      changed = true;
    }
    if (changed) notify();
  });

  // When ANY user toggles a reaction on a message, the server broadcasts
  // `reaction:updated` with the freshly-aggregated `{ emoji, count, reactedByMe }[]`
  // for THIS viewer. Splice it into the cached row so the bubble's pill renderer
  // sees the new state. `reactedByMe` is personalized per-viewer — the server
  // already filtered it for us, so we can write it straight into the cache.
  chatSocket.onReactionUpdated((r) => {
    const cache = cacheByChatId.get(r.chatId);
    if (!cache) return;
    const at = cache.messages.findIndex((x) => x.id === r.messageId);
    if (at < 0) return;
    const prev = cache.messages[at]!;
    cache.messages[at] = { ...prev, reactions: r.reactions } as Message;
    notify();
  });

  // Pin / unpin broadcasts (Tranche 2.E). Flip the cached row's `pinnedAt` so
  // the bubble pin pip updates live for everyone in the chat. The unpinned
  // payload carries no `pinnedAt`, so we hard-set null (reading it would leave
  // a stale pip). Idempotent with our own optimistic flip on self-echo.
  chatSocket.onMessagePinned((p) => {
    const cache = cacheByChatId.get(p.chatId);
    if (!cache) return;
    const at = cache.messages.findIndex((x) => x.id === p.messageId);
    if (at < 0) return;
    cache.messages[at] = { ...cache.messages[at]!, pinnedAt: p.pinnedAt } as Message;
    notify();
  });
  chatSocket.onMessageUnpinned((p) => {
    const cache = cacheByChatId.get(p.chatId);
    if (!cache) return;
    const at = cache.messages.findIndex((x) => x.id === p.messageId);
    if (at < 0) return;
    cache.messages[at] = { ...cache.messages[at]!, pinnedAt: null } as Message;
    notify();
  });

  // Poll create / vote / close (Tranche 2.F). The server emits one
  // `poll:voted` event per viewer with that viewer's personalised
  // `votedByMe` flags, so we can write the aggregate straight onto the
  // cached row. Idempotent with our own optimistic flip on self-echo:
  // the broadcast's counts will equal what we already wrote.
  chatSocket.onPollVoted((p) => {
    applyPollAggregate(p.messageId, p.poll);
  });

  // When a peer (or our own other device) deletes a message, the server
  // broadcasts `message:deleted`. Mark the cached row as a tombstone so the
  // bubble re-renders as "This message was deleted".
  chatSocket.onMessageDeleted((d) => {
    const cache = cacheByChatId.get(d.chatId);
    if (!cache) return;
    const at = cache.messages.findIndex((x) => x.id === d.messageId);
    if (at < 0) return;
    const prev = cache.messages[at]!;
    cache.messages[at] = {
      ...prev,
      deletedAt: new Date().toISOString(),
      // Zero the content so leftover text/voice/image can't be rendered.
      ...tombstoneContent(prev),
    } as Message;
    notify();
  });

  chatSocket.onConnectionChange((connected) => {
    if (!connected) return;
    // On reconnect, pull `session:resume` for every cached chat so we don't miss
    // events that flowed while we were offline.
    for (const [chatId, c] of cacheByChatId) {
      const since = highestSeqByChatId.get(chatId);
      void chatSocket
        .resume({ chatId, lastSeenSequence: (since ?? 0n).toString() })
        .then((reply) => {
          if (!reply) return;
          const counterpartId = counterpartByChatId.get(chatId) ?? '';
          let changed = false;
          for (const m of reply.items) {
            const domain = dtoToMessage(m, counterpartId);
            upsertMessage(chatId, domain);
            rememberSequence(chatId, m.sequence);
            changed = true;
          }
          if (changed) notify();
        });
      void c;
    }
  });
}

// ─── Public repository ───────────────────────────────────────────────────────

const INITIAL_PAGE_LIMIT = 50;
const OLDER_PAGE_LIMIT = 50;

/**
 * Real-API implementation of `ChatRepository`. Backed by:
 *   - REST for list / detail / send fallback / read-cursor mutations
 *   - Socket.IO gateway for real-time `message:new` and read receipts
 *   - In-memory cache (`cacheByChatId`) that screens read through `subscribe()`
 *
 * Optimistic send: `sendMessage` inserts a `status: 'sending'` row into the
 * cache and notifies immediately. The socket path emits and awaits the ack;
 * on success we reconcile by id (the message's durable id == clientMessageId
 * because the backend uses `clientMessageId` as the primary lookup). On
 * socket failure we fall back to REST so a half-broken socket doesn't block
 * sends. Failure flips the row to `status: 'failed'` for retry.
 */
export const apiChatRepository: ChatRepository = {
  async listThreads(args) {
    ensureSocketWired();
    const qs = args?.customFilterId ? `?customFilterId=${args.customFilterId}` : '';
    const res = await apiClient.get<ChatListResponse>(`/chats${qs}`);
    res.items.forEach((it) => {
      if (it.counterpart) counterpartByChatId.set(it.id, it.counterpart.id);
    });
    return res.items.map(itemToThread);
  },

  async getThread(threadId) {
    ensureSocketWired();
    try {
      const [detail, messages] = await Promise.all([
        fetchDetail(threadId),
        apiClient.get<MessageListResponse>(
          `/chats/${threadId}/messages?direction=desc&limit=1`
        ),
      ]);
      const last = messages.items[messages.items.length - 1];
      return detailToThread(detail, last);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },

  async createOneOnOne(args) {
    ensureSocketWired();
    // The server resolves the peer from either id; the display hints are
    // mock-only, so we don't forward them.
    const body = args.contactUserId
      ? { contactUserId: args.contactUserId }
      : { phoneE164: args.phoneE164 };
    const res = await apiClient.post<{ chatId: string }>('/chats/one-on-one', body);
    // The new chat enters `GET /chats` once it has a message; notify so the
    // home list refreshes (no-op visually until the first send).
    notify();
    return { chatId: res.chatId };
  },

  async listMessages(threadId) {
    ensureSocketWired();
    if (!counterpartByChatId.has(threadId)) {
      try {
        await fetchDetail(threadId);
      } catch {
        // ignored — sender attribution will default to other-side
      }
    }
    const res = await apiClient.get<MessageListResponse>(
      `/chats/${threadId}/messages?direction=desc&limit=${INITIAL_PAGE_LIMIT}`
    );
    const counterpartId = counterpartByChatId.get(threadId) ?? '';

    // Seed cache: the response is already chronological asc (server contract).
    const cache = getCache(threadId);
    cache.messages = res.items.map((m) => dtoToMessage(m, counterpartId));

    // Cold-start read receipts: flip mine-messages with `sequence ≤
    // counterpartLastReadSequence` from `delivered` → `read` so the lime
    // double-tick shows on initial load (Phase A known-limit #1 fix —
    // 2026-05-25 verify follow-up).
    const peerReadUpto = counterpartLastReadByChatId.get(threadId);
    if (peerReadUpto !== undefined) {
      for (let i = 0; i < cache.messages.length; i++) {
        const msg = cache.messages[i]!;
        if (msg.senderId === 'me' && msg.status !== 'read') {
          if (BigInt(msg.sequence) <= peerReadUpto) {
            cache.messages[i] = { ...msg, status: 'read' as MessageStatus };
          }
        }
      }
    }

    cache.oldestCursor = res.meta.nextCursor;
    cache.hasMoreOlder = res.meta.hasMore;
    res.items.forEach((m) => rememberSequence(threadId, m.sequence));

    return [...cache.messages];
  },

  async loadOlder(threadId): Promise<LoadOlderResult> {
    const cache = getCache(threadId);
    if (!cache.hasMoreOlder || !cache.oldestCursor) {
      return { items: [], hasMore: false };
    }
    const res = await apiClient.get<MessageListResponse>(
      `/chats/${threadId}/messages?direction=desc&limit=${OLDER_PAGE_LIMIT}&cursor=${encodeURIComponent(cache.oldestCursor)}`
    );
    const counterpartId = counterpartByChatId.get(threadId) ?? '';
    const older = res.items.map((m) => dtoToMessage(m, counterpartId));

    // Prepend to cache, skipping anything already present (defensive).
    const seen = new Set(cache.messages.map((m) => m.id));
    const fresh = older.filter((m) => !seen.has(m.id));
    cache.messages = [...fresh, ...cache.messages];
    cache.oldestCursor = res.meta.nextCursor;
    cache.hasMoreOlder = res.meta.hasMore;
    notify();
    return { items: fresh, hasMore: res.meta.hasMore };
  },

  async sendMessage(input: SendMessageInput) {
    ensureSocketWired();

    // 1. Optimistic insert. For text the row goes straight to `sending`; for
    //    media we start in `uploading` and flip to `sending` once the R2 PUT
    //    completes. The id IS the clientMessageId so reconciliation by id
    //    Just Works when the durable row comes back.
    // location + contact are non-media (like text): no R2 upload, status `sending`.
    const isMedia =
      input.type !== 'text' && input.type !== 'location' && input.type !== 'contact';
    const optimisticBase = {
      id: input.clientMessageId,
      threadId: input.threadId,
      senderId: 'me' as const,
      sequence: Number.MAX_SAFE_INTEGER, // sorts to the bottom until reconciled
      createdAt: new Date().toISOString(),
      status: (isMedia ? 'uploading' : 'sending') as MessageStatus,
      clientMessageId: input.clientMessageId,
      replyToMessageId: input.replyToMessageId ?? null,
      deletedAt: null,
    };
    let optimistic: Message;
    if (input.type === 'text') {
      optimistic = { ...optimisticBase, type: 'text', text: input.text };
    } else if (input.type === 'voice') {
      optimistic = {
        ...optimisticBase,
        type: 'voice',
        durationSec: input.durationSec,
        waveform: input.waveform,
        mediaUrl: input.uri, // local preview
      };
    } else if (input.type === 'image') {
      optimistic = {
        ...optimisticBase,
        type: 'image',
        mediaUrl: input.uri, // local preview
        width: input.width,
        height: input.height,
      };
    } else if (input.type === 'document') {
      optimistic = {
        ...optimisticBase,
        type: 'document',
        mediaUrl: input.uri,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
      };
    } else if (input.type === 'video') {
      optimistic = {
        ...optimisticBase,
        type: 'video',
        mediaUrl: input.uri, // local preview while uploading
        width: input.width,
        height: input.height,
        durationSec: input.durationSec,
      };
    } else if (input.type === 'location') {
      optimistic = {
        ...optimisticBase,
        type: 'location',
        latitude: input.latitude,
        longitude: input.longitude,
        locationName: input.locationName ?? null,
      };
    } else {
      optimistic = {
        ...optimisticBase,
        type: 'contact',
        contactName: input.contactName,
        contactPhoneE164: input.contactPhoneE164,
      };
    }
    upsertMessage(input.threadId, optimistic);
    notify();

    // 2. For media: presign → PUT to R2 → flip optimistic row to `sending`.
    //    DOCUMENT/VIDEO carry a validated MIME + positive size from the picker
    //    (their server validators reject a 0 size / non-allowlisted MIME), so
    //    they NEVER use the `fileSize(uri)` 0-stat fallback that IMAGE/VOICE do.
    let mediaObjectKey: string | undefined;
    // Hoisted so body-building in step 3 can include mediaSizeBytes (P2-Storage).
    let uploadedSizeBytes: number | undefined;
    if (isMedia) {
      try {
        const contentType =
          input.type === 'image'
            ? input.contentType ?? DEFAULT_IMAGE_CONTENT_TYPE
            : input.type === 'voice'
              ? VOICE_CONTENT_TYPE
              : input.mimeType; // document + video
        const sizeBytes =
          input.type === 'image'
            ? input.sizeBytes ?? (await fileSize(input.uri))
            : input.type === 'voice'
              ? await fileSize(input.uri)
              : input.sizeBytes; // document + video — required + positive
        const kind: MediaUploadKind =
          input.type === 'image'
            ? 'IMAGE'
            : input.type === 'voice'
              ? 'VOICE'
              : input.type === 'document'
                ? 'DOCUMENT'
                : 'VIDEO';

        const upload = await requestUploadUrl({ kind, contentType, sizeBytes });
        await putBytes(upload.uploadUrl, input.uri, contentType);
        mediaObjectKey = upload.objectKey;
        uploadedSizeBytes = sizeBytes;

        // Flip uploading → sending so the bubble loses the spinner before the
        // server ack arrives — feels snappier and matches WhatsApp behaviour.
        const cache = getCache(input.threadId);
        const at = cache.messages.findIndex((m) => m.id === input.clientMessageId);
        if (at >= 0) {
          const prev = cache.messages[at]!;
          cache.messages[at] = { ...prev, status: 'sending' as MessageStatus } as Message;
          notify();
        }
      } catch (err) {
        markPendingFailed(input.threadId, input.clientMessageId);
        notify();
        throw err;
      }
    }

    // 3. Compose the wire body for the send.
    let body: SendMessageBody;
    if (input.type === 'text') {
      body = {
        clientMessageId: input.clientMessageId,
        kind: 'TEXT',
        text: input.text,
        replyToMessageId: input.replyToMessageId,
      };
    } else if (input.type === 'voice') {
      body = {
        clientMessageId: input.clientMessageId,
        kind: 'VOICE',
        mediaObjectKey,
        durationSec: input.durationSec,
        waveform: input.waveform,
        replyToMessageId: input.replyToMessageId,
        // Populated once the R2 upload resolves (step 2). Lets the backend
        // record mediaSizeBytes for storage accounting (P2-Storage).
        ...(uploadedSizeBytes !== undefined ? { mediaSizeBytes: uploadedSizeBytes } : {}),
      };
    } else if (input.type === 'image') {
      body = {
        clientMessageId: input.clientMessageId,
        kind: 'IMAGE',
        mediaObjectKey,
        imageWidth: input.width,
        imageHeight: input.height,
        replyToMessageId: input.replyToMessageId,
        ...(uploadedSizeBytes !== undefined ? { mediaSizeBytes: uploadedSizeBytes } : {}),
      };
    } else if (input.type === 'document') {
      body = {
        clientMessageId: input.clientMessageId,
        kind: 'DOCUMENT',
        mediaObjectKey,
        mediaMimeType: input.mimeType,
        documentTitle: input.fileName,
        documentSizeBytes: input.sizeBytes,
        replyToMessageId: input.replyToMessageId,
        // documentSizeBytes and mediaSizeBytes carry the same value for DOCUMENTs;
        // both are sent so older backend versions still see documentSizeBytes.
        // uploadedSizeBytes === input.sizeBytes here (step 2 assigns it from input.sizeBytes
        // for doc/video), so using the hoisted variable keeps all media kinds consistent.
        mediaSizeBytes: uploadedSizeBytes,
      };
    } else if (input.type === 'video') {
      body = {
        clientMessageId: input.clientMessageId,
        kind: 'VIDEO',
        mediaObjectKey,
        mediaMimeType: input.mimeType,
        videoDurationSec: input.durationSec,
        videoWidth: input.width,
        videoHeight: input.height,
        replyToMessageId: input.replyToMessageId,
        // uploadedSizeBytes === input.sizeBytes here — using the hoisted variable keeps
        // all media kinds consistent (image/voice also use uploadedSizeBytes).
        mediaSizeBytes: uploadedSizeBytes,
      };
    } else if (input.type === 'location') {
      body = {
        clientMessageId: input.clientMessageId,
        kind: 'LOCATION',
        latitude: input.latitude,
        longitude: input.longitude,
        // Omit locationName entirely when blank — the server rejects an empty string.
        ...(input.locationName ? { locationName: input.locationName } : {}),
        replyToMessageId: input.replyToMessageId,
      };
    } else {
      body = {
        clientMessageId: input.clientMessageId,
        kind: 'CONTACT_CARD',
        contactName: input.contactName,
        contactPhoneE164: input.contactPhoneE164,
        replyToMessageId: input.replyToMessageId,
      };
    }

    // 4. Prefer the socket path (real-time + same advisory-locked sequence on the
    //    server). Fall back to REST so a degraded socket never blocks sends.
    let durable: MessageDto | null = null;
    if (chatSocket.isConnected()) {
      try {
        const ack = await chatSocket.send({ chatId: input.threadId, body });
        if (ack.ok) {
          durable = ack.message;
        } else if (ack.code !== 'server_error') {
          // Validation / membership errors are not retryable — surface as failed.
          markPendingFailed(input.threadId, input.clientMessageId);
          notify();
          throw new Error(`send failed: ${ack.code}`);
        }
      } catch {
        // fall through to REST
      }
    }
    if (!durable) {
      try {
        durable = await apiClient.post<MessageDto>(`/chats/${input.threadId}/messages`, body);
      } catch (err) {
        markPendingFailed(input.threadId, input.clientMessageId);
        notify();
        throw err;
      }
    }

    // 5. Reconcile cache with the durable row.
    const counterpartId = counterpartByChatId.get(input.threadId) ?? '';
    const domain = dtoToMessage(durable, counterpartId);
    reconcileSend(input.threadId, input.clientMessageId, domain);
    rememberSequence(input.threadId, durable.sequence);
    notify();
    return domain;
  },

  async deleteMessage(threadId, messageId) {
    // Optimistic tombstone: flip the cached row first so the UI updates instantly.
    const cache = cacheByChatId.get(threadId);
    if (cache) {
      const at = cache.messages.findIndex((x) => x.id === messageId);
      if (at >= 0) {
        const prev = cache.messages[at]!;
        cache.messages[at] = {
          ...prev,
          deletedAt: new Date().toISOString(),
          ...tombstoneContent(prev),
        } as Message;
        notify();
      }
    }
    try {
      await apiClient.del(`/chats/${threadId}/messages/${messageId}?scope=everyone`);
    } catch (err) {
      // Roll back the tombstone on failure so the user can retry.
      if (cache) {
        const at = cache.messages.findIndex((x) => x.id === messageId);
        if (at >= 0) {
          const prev = cache.messages[at]!;
          cache.messages[at] = { ...prev, deletedAt: null } as Message;
          notify();
        }
      }
      throw err;
    }
  },

  async reportMessage({ messageId, reason, note }) {
    const body: CreateMessageReportBody = note ? { reason, note } : { reason };
    await apiClient.post<MessageReportAck>(`/messages/${messageId}/report`, body);
  },

  /**
   * React with `emoji`. Optimistic cache update happens BEFORE the network call:
   *   - If the viewer already has this emoji on this message → no-op (idempotent
   *     server-side on `(messageId, userId, emoji)` unique).
   *   - Otherwise bump count + flip `reactedByMe: true`, inserting a new aggregate
   *     row if this is the first reaction of that emoji.
   * On failure we roll back so the pill doesn't show a phantom reaction.
   * The server's `reaction:updated` socket broadcast lands shortly after the
   * REST call returns and replaces the optimistic aggregate with the authoritative one.
   */
  async addReaction(messageId: string, emoji: string) {
    const located = locateMessage(messageId);
    const prevReactions = located?.message.reactions;
    if (located) {
      const next = bumpReactionLocally(prevReactions, emoji, true);
      if (next !== prevReactions) {
        located.cache.messages[located.index] = {
          ...located.message,
          reactions: next,
        } as Message;
        notify();
      }
    }
    try {
      const result = await apiClient.post<ReactionsList>(
        `/messages/${messageId}/reactions`,
        { emoji },
      );
      applyAuthoritativeAggregate(messageId, result.reactions);
    } catch (err) {
      restoreReactions(messageId, prevReactions);
      throw err;
    }
  },

  async removeReaction(messageId: string, emoji: string) {
    const located = locateMessage(messageId);
    const prevReactions = located?.message.reactions;
    if (located) {
      const next = bumpReactionLocally(prevReactions, emoji, false);
      if (next !== prevReactions) {
        located.cache.messages[located.index] = {
          ...located.message,
          reactions: next,
        } as Message;
        notify();
      }
    }
    try {
      const result = await apiClient.del<ReactionsList>(
        `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      );
      applyAuthoritativeAggregate(messageId, result.reactions);
    } catch (err) {
      restoreReactions(messageId, prevReactions);
      throw err;
    }
  },

  /**
   * Forward a message into other chats. The server clones the content into
   * each target (dropping reply context + reactions) and broadcasts
   * `message:new` to each target room — our existing `chatSocket.onMessage`
   * subscriber inserts those copies into the target caches, so there's no
   * optimistic insert here. We don't splice the source's `forwardCount`
   * either: the backend doesn't broadcast it, so a live bump would desync.
   */
  async forwardMessage(messageId, targetThreadIds) {
    const body: ForwardRequestBody = { targetChatIds: targetThreadIds };
    const res = await apiClient.post<ForwardResponse>(
      `/messages/${messageId}/forward`,
      body,
    );
    return { delivered: res.items.length, skipped: res.skipped.length };
  },

  /**
   * Pin / unpin a message. Optimistic single-field flip of `pinnedAt` (mirrors
   * the delete tombstone path) — the server returns the durable `MessageDto`
   * which we reconcile (single field only, so an in-flight optimistic media row
   * isn't clobbered). On failure we restore the EXACT prior `pinnedAt` (not a
   * hardcoded null) and rethrow so the screen can branch on
   * `ApiError.code === 'pin_cap_exceeded'`. The server's `message:pinned`
   * broadcast lands shortly after and re-applies the same value (idempotent).
   */
  async pinMessage(threadId, messageId) {
    const prev = locateMessage(messageId)?.message.pinnedAt ?? null;
    setPinnedAt(messageId, new Date().toISOString());
    try {
      const dto = await apiClient.patch<MessageDto>(
        `/chats/${threadId}/messages/${messageId}/pin`,
      );
      setPinnedAt(messageId, dto.pinnedAt ?? null);
    } catch (err) {
      setPinnedAt(messageId, prev);
      throw err;
    }
  },

  async unpinMessage(threadId, messageId) {
    const prev = locateMessage(messageId)?.message.pinnedAt ?? null;
    setPinnedAt(messageId, null);
    try {
      const dto = await apiClient.del<MessageDto>(
        `/chats/${threadId}/messages/${messageId}/pin`,
      );
      setPinnedAt(messageId, dto.pinnedAt ?? null);
    } catch (err) {
      setPinnedAt(messageId, prev);
      throw err;
    }
  },

  /**
   * Create a poll (Tranche 2.F). POLL messages are server-authored, so unlike
   * `sendMessage` we don't insert an optimistic bubble — the round-trip is
   * <100ms and an optimistic POLL would race a 400 on invalid options. The
   * server's `message:new` broadcast carries the durable bubble; we also
   * upsert from the REST response so the caller can re-use the returned
   * `PollMessage` directly (e.g. to scroll-to-bottom after the modal closes).
   */
  async createPoll(input: CreatePollInput) {
    ensureSocketWired();
    const body: PollCreateRequestBody = {
      clientMessageId: input.clientMessageId,
      question: input.question,
      options: input.options,
      multiSelect: input.multiSelect,
      anonymous: false, // 1-on-1 UI hard-codes false (BRD line 519).
    };
    const dto = await apiClient.post<MessageDto>(`/chats/${input.threadId}/polls`, body);
    const counterpartId = counterpartByChatId.get(input.threadId) ?? '';
    const domain = dtoToMessage(dto, counterpartId);
    upsertMessage(input.threadId, domain);
    rememberSequence(input.threadId, dto.sequence);
    notify();
    return domain;
  },

  /**
   * Cast / change a vote. Optimistic: flip the cached aggregate immediately
   * (single-replace vs multi-diff math identical to the server's branching)
   * and reconcile when the `poll:voted` broadcast lands. Failures (e.g. 409
   * `poll_closed`) restore the snapshot and rethrow.
   */
  async votePoll(messageId, optionIds) {
    const located = locateMessage(messageId);
    let snapshot: { options: PollMessage['options']; closedAt: string | null; totalVoters: number } | null =
      null;
    if (located && located.message.type === 'poll') {
      const poll = located.message;
      snapshot = { options: poll.options, closedAt: poll.closedAt, totalVoters: poll.totalVoters };
      const nextOptions = applyVoteLocally(poll.options, optionIds, poll.multiSelect);
      const iVoteAfter = nextOptions.some((o) => o.votedByMe);
      const iVoteBefore = poll.options.some((o) => o.votedByMe);
      const totalDelta = iVoteAfter && !iVoteBefore ? 1 : !iVoteAfter && iVoteBefore ? -1 : 0;
      located.cache.messages[located.index] = {
        ...poll,
        options: nextOptions,
        totalVoters: Math.max(0, poll.totalVoters + totalDelta),
      };
      notify();
    }
    try {
      const aggregate = await apiClient.post<PollAggregate>(
        `/messages/${messageId}/vote`,
        { optionIds },
      );
      applyPollAggregate(messageId, aggregate);
    } catch (err) {
      if (snapshot) restorePollSnapshot(messageId, snapshot);
      throw err;
    }
  },

  /**
   * Close a poll (sender-only). The cached row already shows my view; we
   * optimistically set `closedAt`, then reconcile from the response (which
   * also fans out via `poll:voted` for the counterpart). On failure we
   * restore the prior null.
   */
  async closePoll(messageId) {
    const located = locateMessage(messageId);
    let prevClosedAt: string | null = null;
    if (located && located.message.type === 'poll') {
      prevClosedAt = located.message.closedAt;
      located.cache.messages[located.index] = {
        ...located.message,
        closedAt: new Date().toISOString(),
      };
      notify();
    }
    try {
      const aggregate = await apiClient.post<PollAggregate>(
        `/messages/${messageId}/poll/close`,
        {},
      );
      applyPollAggregate(messageId, aggregate);
    } catch (err) {
      if (located && located.message.type === 'poll') {
        located.cache.messages[located.index] = { ...located.message, closedAt: prevClosedAt };
        notify();
      }
      throw err;
    }
  },

  async getProfileCard(userId) {
    return apiClient.get<UserProfileCard>(`/users/${userId}/profile-card`);
  },

  async listMedia(threadId, args) {
    const params = new URLSearchParams();
    if (args?.kind) params.set('kind', args.kind);
    if (args?.cursor) params.set('cursor', args.cursor);
    if (args?.limit) params.set('limit', String(args.limit));
    const qs = params.toString();
    const res = await apiClient.get<MessageListResponse>(
      `/chats/${threadId}/media${qs ? `?${qs}` : ''}`,
    );
    const counterpartId = counterpartByChatId.get(threadId) ?? '';
    return {
      items: res.items.map((m) => dtoToMessage(m, counterpartId)),
      nextCursor: res.meta.nextCursor,
      hasMore: res.meta.hasMore,
    };
  },

  async getCommonGroups(contactUserId) {
    return apiClient.get<CommonGroupsListResponse>(
      `/contacts/${contactUserId}/common-groups`,
    );
  },

  async muteChat(threadId, until) {
    const body: MuteChatBody = { until: until ? until.toISOString() : null };
    return apiClient.patch<MuteChatResponse>(`/chats/${threadId}/mute`, body);
  },

  async clearChat(threadId) {
    // Fastify's body-parser rejects PATCH with `content-type: application/json`
    // and an empty body — RN's `fetch` adds the header by default. Pass an
    // explicit `{}` so the request body matches the declared content-type.
    const res = await apiClient.patch<ClearChatResponse>(`/chats/${threadId}/clear`, {});
    // Drop our cached messages so the UI re-fetches against the new clearedAt.
    cacheByChatId.delete(threadId);
    highestSeqByChatId.delete(threadId);
    notify();
    return res;
  },

  async blockUser(userId) {
    return apiClient.post<BlockStatusResponse>(`/users/${userId}/block`, {});
  },

  async unblockUser(userId) {
    return apiClient.del<BlockStatusResponse>(`/users/${userId}/block`);
  },

  async markThreadRead(threadId) {
    let upto = highestSeqByChatId.get(threadId);
    if (upto === undefined) {
      // Cache not warm — pull the latest page to learn the highest sequence.
      const res = await apiClient.get<MessageListResponse>(
        `/chats/${threadId}/messages?direction=desc&limit=1`
      );
      res.items.forEach((m) => rememberSequence(threadId, m.sequence));
      upto = highestSeqByChatId.get(threadId);
    }
    if (upto === undefined) return;
    try {
      await apiClient.patch(`/chats/${threadId}/read`, { uptoSequence: upto.toString() });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.status !== 404) throw err;
    }
    notify();
  },

  async markAllRead() {
    try {
      await apiClient.patch<void>('/chats/read-all');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw err;
    }
    notify();
  },

  async toggleFavourite(threadId) {
    try {
      await apiClient.patch<{ isFavourite: boolean }>(`/chats/${threadId}/favourite`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw err;
    }
    notify();
  },

  // ─── Calls (Tranche 2.H/2.I) ────────────────────────────────────────────────
  // The CALL_EVENT thread rows arrive via the existing `message:new` socket
  // path, so these are plain REST calls — no special call-cache handling.

  async startCall(threadId, kind: CallKind) {
    return apiClient.post<CallTokenResponse>('/calls/token', { chatId: threadId, kind });
  },

  async acceptCall(callId) {
    return apiClient.post<CallAcceptResponse>(`/calls/${callId}/accept`, {});
  },

  async declineCall(callId) {
    await apiClient.post<void>(`/calls/${callId}/decline`, {});
  },

  async hangupCall(callId) {
    await apiClient.post<void>(`/calls/${callId}/hangup`, {});
  },

  async listCallsInThread(threadId) {
    const res = await apiClient.get<CallListResponse>(`/chats/${threadId}/calls`);
    return res.items as CallSummary[];
  },

  async registerPushToken(expoPushToken, platform: DevicePlatform) {
    await apiClient.post<void>('/push/tokens', { expoPushToken, platform });
  },

  async searchMessages(chatId, q, opts) {
    const params = new URLSearchParams({ q });
    if (opts?.cursor) params.set('cursor', opts.cursor);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return apiClient.get<MessageSearchPage>(
      `/chats/${chatId}/messages/search?${params.toString()}`,
    );
  },

  async getChatStorage(chatId) {
    return apiClient.get<ChatStorageSummary>(`/chats/${chatId}/storage`);
  },

  async setChatTheme(threadId, theme) {
    await apiClient.patch(`/chats/${threadId}/theme`, { theme });
    notify();
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export { mockChatRepository };
