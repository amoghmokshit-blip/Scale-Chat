/**
 * Chat domain types — mirror the eventual backend contract from CLAUDE.md §4.
 *
 * Once `packages/shared` exists, these will be re-exports of branded zod schemas.
 * For now we type the mock store the way the masked socket payloads will look.
 */

import type { PollAggregate, ReactionAggregate } from '@scalechat/shared';

export type ThreadKind = 'direct' | 'group' | 'super';

/**
 * A contact / chat participant. For Super Groups, members will receive `Masked`
 * versions of this where `phoneE164` is omitted and `displayName` is an alias.
 */
export type Contact = {
  id: string;
  displayName: string;
  phoneE164?: string;
  avatarUri?: string;
  /** Optional emoji fallback when no photo is set (mock seed). */
  emoji?: string;
  /** Background tint used when no photo is set. */
  tint?: string;
  isOnline?: boolean;
};

/** A single 1-on-1 thread (and the same shape will represent groups when added). */
export type Thread = {
  id: string;
  kind: ThreadKind;
  counterpart: Contact;
  lastMessage: Message;
  unreadCount: number;
  /** Sequence of the last message the user has read — drives "delivered" vs "read" ticks. */
  lastReadSequence: number;
  isPinned?: boolean;
  isArchived?: boolean;
  isFavourite?: boolean;
  /**
   * Per-user per-chat theme override (P2-Theme). Null / undefined = default theme.
   * Values mirror `ChatTheme` from `@scalechat/shared`.
   */
  chatTheme?: string | null;
};

export type MessageStatus =
  /** Media is uploading to R2 — bubble shows a progress spinner overlay. */
  | 'uploading'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export type MessageBase = {
  id: string;
  threadId: string;
  /** Author id; `me` is the current device user. */
  senderId: string;
  /** Server-assigned ordering; `BigInt` in the real backend (serialised as string). */
  sequence: number;
  /** ISO timestamp. Format with `formatBubbleTime` / `formatDayLabel`. */
  createdAt: string;
  /** Status from the sender's perspective. */
  status: MessageStatus;
  /**
   * Client-generated idempotency key. Present on every send (optimistic AND
   * durable rows the server returns) so the cache can match the durable row
   * back to the optimistic insert regardless of whether the ack or the socket
   * `message:new` broadcast arrives first.
   */
  clientMessageId?: string;
  /** Set when this message replies to another in the same thread. */
  replyToMessageId?: string | null;
  /**
   * Non-null when the message was deleted-for-everyone. Renders as a
   * "This message was deleted" tombstone; the original `text`/voice payload
   * is zeroed server-side.
   */
  deletedAt?: string | null;
  /**
   * Emoji reactions aggregated per emoji (Tranche 2.A). Empty array (default)
   * when the message has no reactions; we keep the shape on every row so the
   * bubble's pill renderer can do a uniform `length > 0` check.
   *
   * `reactedByMe` is per-viewer — the server already personalizes the bubble's
   * MessageDto for the calling client. Socket `reaction:updated` broadcasts
   * carry the fresh aggregate which we splice into the cached message.
   */
  reactions?: ReactionAggregate[];
  /**
   * Set when this message is a forwarded copy of another (Tranche 2.E). The
   * bubble renders a small "↪ Forwarded" label above the body. The server
   * keeps the actual source id private; the client only needs presence/absence.
   */
  forwardedFromMessageId?: string | null;
  /**
   * How many times this (source) message has been forwarded. Drives a future
   * "Forwarded many times" pill; carried now so the Pin/Forward type doesn't
   * need re-touching. Defaults to 0.
   */
  forwardCount?: number;
  /**
   * Non-null when this message is pinned (Tranche 2.E-front-pin). Carried here
   * so the next PR (bubble pin pip) doesn't re-touch this type; unused in the
   * Forward-only PR.
   */
  pinnedAt?: string | null;
};

export type TextMessage = MessageBase & {
  type: 'text';
  text: string;
};

export type VoiceMessage = MessageBase & {
  type: 'voice';
  /** Duration in seconds. */
  durationSec: number;
  /** Waveform peaks (0..1). */
  waveform: number[];
  /**
   * R2 (or local) URL the player streams from. Optimistic / uploading rows
   * carry the device-local `file://` URI; reconciled durable rows carry the
   * public CDN URL the server computes from `mediaObjectKey`.
   */
  mediaUrl?: string;
};

export type ImageMessage = MessageBase & {
  type: 'image';
  /**
   * R2 public URL (or local `file://` while uploading). The bubble lays out
   * against `width/height` to avoid jumpy paint before the asset finishes
   * loading.
   */
  mediaUrl: string;
  /** Intrinsic pixel width — drives bubble aspect ratio. */
  width: number;
  /** Intrinsic pixel height. */
  height: number;
};

export type DocumentMessage = MessageBase & {
  type: 'document';
  /** R2 public URL (or local `file://` while uploading). */
  mediaUrl: string;
  /** Original file name (≤255 chars; the repo truncates if longer). */
  fileName: string;
  /** File size in bytes — drives the size label. */
  sizeBytes: number;
  /** Exact MIME (drives the icon + open behaviour). */
  mimeType: string;
};

export type VideoMessage = MessageBase & {
  type: 'video';
  /** R2 public URL (or local `file://` while uploading). */
  mediaUrl: string;
  /** Intrinsic pixel width — drives the bubble aspect box. */
  width: number;
  /** Intrinsic pixel height. */
  height: number;
  /** Duration in seconds. */
  durationSec: number;
};

export type LocationMessage = MessageBase & {
  type: 'location';
  latitude: number;
  longitude: number;
  /** Reverse-geocoded place name (city/area), or null if unavailable. */
  locationName?: string | null;
};

export type ContactCardMessage = MessageBase & {
  type: 'contact';
  contactName: string;
  /** E.164 (e.g. +919876543210). */
  contactPhoneE164: string;
};

/**
 * Poll bubble (Tranche 2.F). Mirrors `PollAggregate` from `@scalechat/shared`
 * with one tweak: `options[].votedByMe` is the local cache's optimistic state
 * — the api repo flips it immediately on tap and reconciles to the server's
 * authoritative aggregate when the `poll:voted` broadcast lands.
 */
export type PollMessage = MessageBase & {
  type: 'poll';
  /** The `PollMessage.id` (NOT the `Message.id` — that lives in `MessageBase.id`). */
  pollMessageId: string;
  question: string;
  multiSelect: boolean;
  anonymous: boolean;
  /** ISO timestamp the poll was closed (sender-only), or null while open. */
  closedAt: string | null;
  /** Distinct voter count across all options (drives "N voted" subline). */
  totalVoters: number;
  options: PollAggregate['options'];
};

/**
 * Server-authored call-log row (Tranche 2.I) — rendered as a centered system
 * pill, not a left/right bubble. `text` is the server label ("Missed voice
 * call" / "Voice call · 4m 12s").
 */
export type CallEventMessage = MessageBase & {
  type: 'call_event';
  text: string;
  callKind: 'VOICE' | 'VIDEO';
};

export type Message =
  | TextMessage
  | VoiceMessage
  | ImageMessage
  | DocumentMessage
  | VideoMessage
  | LocationMessage
  | ContactCardMessage
  | PollMessage
  | CallEventMessage;

export type SendMessageInput =
  | {
      threadId: string;
      type: 'text';
      text: string;
      clientMessageId: string;
      replyToMessageId?: string;
    }
  | {
      threadId: string;
      type: 'voice';
      /** Device-local file URI (e.g. `file:///.../voice-note.m4a`). The repo uploads to R2. */
      uri: string;
      durationSec: number;
      waveform: number[];
      clientMessageId: string;
      replyToMessageId?: string;
    }
  | {
      threadId: string;
      type: 'image';
      /** Device-local file URI returned by `expo-image-picker`. The repo uploads to R2. */
      uri: string;
      width: number;
      height: number;
      /** Mime type — defaults to `image/jpeg` if the picker omits it. */
      contentType?: string;
      /** Byte size if the picker reports it; otherwise the repo `stat`s the file. */
      sizeBytes?: number;
      clientMessageId: string;
      replyToMessageId?: string;
    }
  | {
      threadId: string;
      type: 'document';
      /** Device-local file URI from `expo-document-picker`. */
      uri: string;
      fileName: string;
      /** Required + positive (server rejects 0) — the picker supplies it. */
      sizeBytes: number;
      /** Validated against the DOCUMENT MIME allowlist before send. */
      mimeType: string;
      clientMessageId: string;
      replyToMessageId?: string;
    }
  | {
      threadId: string;
      type: 'video';
      /** Device-local file URI from `expo-image-picker` (`mediaTypes:['videos']`). */
      uri: string;
      width: number;
      height: number;
      /** Seconds (≥1; the picker gives ms, the screen converts with Math.max(1,…)). */
      durationSec: number;
      /** Validated against the VIDEO MIME allowlist before send. */
      mimeType: string;
      /** Required + positive — the picker supplies it. */
      sizeBytes: number;
      clientMessageId: string;
      replyToMessageId?: string;
    }
  | {
      threadId: string;
      type: 'location';
      latitude: number;
      longitude: number;
      /** Reverse-geocoded name; omitted (not '') when unavailable — server rejects empty. */
      locationName?: string;
      clientMessageId: string;
      replyToMessageId?: string;
    }
  | {
      threadId: string;
      type: 'contact';
      contactName: string;
      /** Already normalized to E.164 before this call. */
      contactPhoneE164: string;
      clientMessageId: string;
      replyToMessageId?: string;
    };

/**
 * Polls don't go through `sendMessage` — they use a dedicated `createPoll`
 * repo method because the server authors POLL `Message` rows directly (POLL
 * is in `SERVER_ONLY_KINDS`). Multi-select defaults to false (BRD Q4 —
 * WhatsApp parity). Anonymous is fixed false in the 1-on-1 UI (the toggle is
 * hidden; the column exists for future Super Groups reuse).
 */
export type CreatePollInput = {
  threadId: string;
  clientMessageId: string;
  question: string;
  options: string[];
  multiSelect: boolean;
};

/**
 * Filter pill state on the Contact Page. Mirrors the future
 * `filter=ALL|UNREAD|GROUP|SUPER_GROUP|FAVOURITES` query string on
 * `GET /chats` (`packages/shared/src/schemas/chats.ts`).
 */
export type ChatFilter = 'all' | 'unread' | 'group' | 'super' | 'favourites';

export const ChatFilters: Record<ChatFilter, string> = {
  all: 'All',
  unread: 'Unread',
  group: 'Group',
  super: 'Super Group',
  favourites: 'Favourites',
};
