import type {
  BlockStatusResponse,
  CallAcceptResponse,
  CallKind,
  CallSummary,
  CallTokenResponse,
  ClearChatResponse,
  CommonGroupsListResponse,
  DevicePlatform,
  MuteChatResponse,
  ReportReason,
  UserProfileCard,
} from '@scalechat/shared';

import type { CreatePollInput, Message, SendMessageInput, Thread } from '../types';

export type LoadOlderResult = {
  /** Older messages prepended (chronological ASC). */
  items: Message[];
  /** False once there's nothing older to fetch. */
  hasMore: boolean;
};

/**
 * Seam for the NestJS chat backend. Both REST and Socket.IO flow through here so
 * screens see one shape:
 *   - listThreads / getThread     → GET  /chats, /chats/:id
 *   - listMessages                → GET  /chats/:id/messages?direction=desc
 *   - loadOlder                   → GET  /chats/:id/messages?direction=desc&cursor=…
 *   - sendMessage                 → socket `message:send` (REST fallback)
 *   - markThreadRead / markAllRead → PATCH /chats/:id/read | /chats/read-all
 *   - toggleFavourite             → PATCH /chats/:id/favourite
 *
 * The api implementation also maintains an in-memory cache fed by both REST
 * responses and socket `message:new` events, so screens never need to refetch
 * to see an incoming message — they just `subscribe()` and re-read.
 */
export type ListThreadsArgs = {
  /** When set, the server applies the stored UserChatFilter.criteria instead of any preset. */
  customFilterId?: string;
};

export interface ChatRepository {
  listThreads(args?: ListThreadsArgs): Promise<Thread[]>;
  getThread(threadId: string): Promise<Thread | null>;
  listMessages(threadId: string): Promise<Message[]>;
  /** Fetch older messages (before the oldest one currently cached). */
  loadOlder?(threadId: string): Promise<LoadOlderResult>;
  /**
   * Insert a local "pending" message immediately and dispatch the send.
   * The returned promise resolves with the durable message once the server
   * acks; intermediate states (sending → sent / failed) are pushed via
   * `subscribe()` so the UI doesn't have to await.
   */
  sendMessage(input: SendMessageInput): Promise<Message>;
  /** Delete-for-everyone — soft-deletes server-side, broadcasts a tombstone. */
  deleteMessage?(threadId: string, messageId: string): Promise<void>;
  /**
   * Report a counterpart's message for moderation. Server-side only; the
   * report row never broadcasts. Per `(messageId, reporterUserId, reason)`
   * uniqueness, repeated taps with the same reason fail with 409
   * `already_reported`.
   */
  reportMessage?(input: {
    messageId: string;
    reason: ReportReason;
    note?: string;
  }): Promise<void>;
  markThreadRead(threadId: string): Promise<void>;
  markAllRead(): Promise<void>;
  toggleFavourite(threadId: string): Promise<void>;
  /**
   * Privacy-filtered public profile of another user. 403 if you don't share
   * a chat with them and haven't saved them as a contact.
   */
  getProfileCard?(userId: string): Promise<UserProfileCard>;
  /**
   * Per-chat media gallery (Contact Profile → Media Links & Docs).
   * `kind` narrows to IMAGE-only or VOICE-only; omit for both.
   */
  listMedia?(
    threadId: string,
    args?: { kind?: 'IMAGE' | 'VOICE'; cursor?: string; limit?: number },
  ): Promise<{ items: Message[]; nextCursor: string | null; hasMore: boolean }>;
  /**
   * Group / Super Group chats both me and the target user are active members
   * of. Returns `{ items: [] }` until groups ship.
   */
  getCommonGroups?(contactUserId: string): Promise<CommonGroupsListResponse>;
  /**
   * Mute notifications for a chat. `until: null` unmutes. The push worker
   * (Phase E) reads `ChatMember.mutedUntil` and skips muted memberships.
   */
  muteChat?(threadId: string, until: Date | null): Promise<MuteChatResponse>;
  /**
   * Per-user "Clear chat" — hides messages with `createdAt ≤ now` from the
   * caller's list view; the counterpart's history is untouched.
   */
  clearChat?(threadId: string): Promise<ClearChatResponse>;
  /**
   * Block a user. Server enforces symmetric blocking: sends in either
   * direction are rejected with 403 `peer_blocked`.
   */
  blockUser?(userId: string): Promise<BlockStatusResponse>;
  unblockUser?(userId: string): Promise<BlockStatusResponse>;
  /**
   * React to a message with an emoji (Tranche 2.A). Optimistic — the cache
   * flips immediately and the server confirms via `reaction:updated` socket
   * broadcast. Calling with an emoji the viewer has already reacted with is
   * a no-op on the server (idempotent unique on `(messageId, userId, emoji)`).
   */
  addReaction?(messageId: string, emoji: string): Promise<void>;
  /** Remove the viewer's own reaction. 200 even if no row existed (idempotent). */
  removeReaction?(messageId: string, emoji: string): Promise<void>;
  /**
   * Forward a message into one or more other chats (Tranche 2.E). Returns the
   * per-target outcome: `delivered` copies created + `skipped` targets (not a
   * member / peer-blocked / source not forwardable — silently skipped, matching
   * WhatsApp). Each delivered target receives the new copy via `message:new`,
   * so this doesn't insert optimistically into the target cache.
   */
  forwardMessage?(
    messageId: string,
    targetThreadIds: string[],
  ): Promise<{ delivered: number; skipped: number }>;
  /**
   * Pin a message in a chat (Tranche 2.E). Optimistic — flips `pinnedAt`
   * immediately and the server confirms via `message:pinned` socket broadcast.
   * Throws an `ApiError` with `code: 'pin_cap_exceeded'` (409) when the chat
   * already has the max (3) pinned messages.
   */
  pinMessage?(threadId: string, messageId: string): Promise<void>;
  /** Unpin a message. Idempotent server-side (200 even if it wasn't pinned). */
  unpinMessage?(threadId: string, messageId: string): Promise<void>;
  /**
   * Create a poll (Tranche 2.F). Server authors the POLL message (POLL is
   * server-only) and broadcasts `message:new` + per-viewer `poll:voted`; the
   * api repo upserts the new bubble into the local cache via the socket
   * subscriber, then resolves with the returned `PollMessage`. Mock repo
   * inserts directly into the snapshot.
   */
  createPoll?(input: CreatePollInput): Promise<Message>;
  /**
   * Cast / change a vote. `optionIds` is the FULL post-vote selection set:
   * the server diff-applies. Single-select polls accept exactly one id;
   * multi-select 1..N. Optimistic: the cached bubble flips `votedByMe` +
   * counts immediately and reconciles when the `poll:voted` socket lands.
   * On failure (e.g. 409 `poll_closed`) the prior aggregate is restored
   * and the error is rethrown.
   */
  votePoll?(messageId: string, optionIds: string[]): Promise<void>;
  /** Close a poll (sender-only). Idempotent if already closed. */
  closePoll?(messageId: string): Promise<void>;
  /**
   * Start a 1-on-1 call (Tranche 2.H/2.I). `POST /calls/token` → callId + a
   * LiveKit `accessToken` + `roomName` + `wsUrl` for `Room.connect`. The server
   * also rings the callee (socket + push).
   */
  startCall?(threadId: string, kind: CallKind): Promise<CallTokenResponse>;
  /** Accept an incoming call. `POST /calls/:id/accept` → LiveKit token + wsUrl. */
  acceptCall?(callId: string): Promise<CallAcceptResponse>;
  /** Decline an incoming call. `POST /calls/:id/decline`. */
  declineCall?(callId: string): Promise<void>;
  /** End an active call (either peer). `POST /calls/:id/hangup`. */
  hangupCall?(callId: string): Promise<void>;
  /** Per-thread call history. `GET /chats/:id/calls`. */
  listCallsInThread?(threadId: string): Promise<CallSummary[]>;
  /** Register this device's Expo push token for call wakeup. `POST /push/tokens`. */
  registerPushToken?(expoPushToken: string, platform: DevicePlatform): Promise<void>;
  /** Subscribe to repository changes (any thread/message update). */
  subscribe(listener: () => void): () => void;
}
