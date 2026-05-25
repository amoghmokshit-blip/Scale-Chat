/**
 * Chat domain types — mirror the eventual backend contract from CLAUDE.md §4.
 *
 * Once `packages/shared` exists, these will be re-exports of branded zod schemas.
 * For now we type the mock store the way the masked socket payloads will look.
 */

import type { ReactionAggregate } from '@scalechat/shared';

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

export type Message = TextMessage | VoiceMessage | ImageMessage;

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
