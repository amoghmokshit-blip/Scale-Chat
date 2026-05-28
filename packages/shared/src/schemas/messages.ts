import { z } from 'zod';

import { ChatThemeEnum } from './chat-theme.js';
import { paginatedResponse } from './common.js';
import { PollAggregateSchema } from './polls.js';
import { ReactionAggregateSchema } from './reactions.js';

export const MessageKindEnum = z.enum([
  'TEXT',
  'VOICE',
  'IMAGE',
  'SYSTEM',
  'DOCUMENT',
  'VIDEO',
  'LOCATION',
  'LOCATION_LIVE',
  'CONTACT_CARD',
  'POLL',
  'CALL_EVENT',
]);
export type MessageKind = z.infer<typeof MessageKindEnum>;

/**
 * Kinds the client may NEVER send directly — they're authored server-side
 * (SYSTEM tombstones/notices, POLL via the polls module, CALL_EVENT via the
 * calls module, LOCATION_LIVE via a future live-location stream). `SendMessageSchema`
 * rejects them with `kind_not_allowed_from_client`.
 */
export const SERVER_ONLY_KINDS: ReadonlySet<MessageKind> = new Set([
  'SYSTEM',
  'POLL',
  'CALL_EVENT',
  'LOCATION_LIVE',
]);

export const MessageStatusEnum = z.enum(['sending', 'sent', 'delivered', 'read', 'failed']);
export type MessageStatus = z.infer<typeof MessageStatusEnum>;

/**
 * Wire-format message — what the chat gateway (Socket.IO) and REST endpoints
 * both return. `sequence` is a `BigInt` on the server but serialised as a
 * string so it can cross the JSON boundary safely.
 */
export const MessageSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string().uuid(),
  senderUserId: z.string().uuid(),
  clientMessageId: z.string().min(1).max(64),
  sequence: z.string().regex(/^\d+$/),
  kind: MessageKindEnum,
  text: z.string().nullable(),
  mediaObjectKey: z.string().nullable(),
  /**
   * Public CDN URL the client can render / stream from. Computed by the server
   * from `mediaObjectKey` so clients never need to know the bucket layout.
   * Null for TEXT/SYSTEM and for deleted messages.
   */
  mediaUrl: z.string().url().nullable(),
  /** IMAGE only: intrinsic pixel width — clients reserve aspect space pre-load. */
  imageWidth: z.number().int().positive().nullable(),
  /** IMAGE only: intrinsic pixel height. */
  imageHeight: z.number().int().positive().nullable(),
  durationSec: z.number().int().nullable(),
  waveform: z.array(z.number()).nullable(),
  /** DOCUMENT/VIDEO: exact MIME (drives the bubble icon + download). Null otherwise. */
  mediaMimeType: z.string().nullable().default(null),
  /** VIDEO only. */
  videoDurationSec: z.number().int().nullable().default(null),
  videoWidth: z.number().int().positive().nullable().default(null),
  videoHeight: z.number().int().positive().nullable().default(null),
  /** LOCATION / LOCATION_LIVE. */
  latitude: z.number().nullable().default(null),
  longitude: z.number().nullable().default(null),
  locationName: z.string().nullable().default(null),
  /** CONTACT_CARD. */
  contactName: z.string().nullable().default(null),
  contactPhoneE164: z.string().nullable().default(null),
  /** DOCUMENT. */
  documentTitle: z.string().nullable().default(null),
  documentSizeBytes: z.number().int().nonnegative().nullable().default(null),
  /** Forward (Tranche 2.E) — `forwardedFromMessageId` is server-only; clients see `forwardCount` for the "Forwarded many times" pill. */
  forwardedFromMessageId: z.string().uuid().nullable().default(null),
  forwardCount: z.number().int().nonnegative().default(0),
  /** Pin (Tranche 2.E). */
  pinnedAt: z.string().datetime().nullable().default(null),
  pinnedByUserId: z.string().uuid().nullable().default(null),
  replyToMessageId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  /**
   * If non-null, the message was deleted-for-everyone. The server zeroes
   * `text` / `mediaObjectKey` / `durationSec` / `waveform` when this is set,
   * so clients should render a `This message was deleted` tombstone in place
   * of the original content.
   */
  deletedAt: z.string().datetime().nullable(),
  /**
   * Emoji reactions aggregated per emoji (Phase 2.1). Empty array when the
   * message has no reactions. The server folds the `MessageReaction` rows
   * into this shape on read so clients don't have to.
   */
  reactions: z.array(ReactionAggregateSchema).default([]),
  /**
   * Poll aggregate (Tranche 2.F). Present (non-null) when `kind === 'POLL'`;
   * the server folds `PollMessage` + `PollOption` + `PollVote` rows into this
   * shape on read so clients render the bubble off a single DTO. Tombstones
   * (deletedAt non-null) zero this out alongside text/media.
   */
  poll: PollAggregateSchema.nullable().default(null),
});
export type MessageDto = z.infer<typeof MessageSchema>;

export const MessageListResponseSchema = paginatedResponse(MessageSchema);
export type MessageListResponse = z.infer<typeof MessageListResponseSchema>;

/**
 * Direction controls how the page is fetched relative to the cursor:
 *   - `asc`  → "give me messages newer than the cursor" (oldest-first scroll).
 *   - `desc` → "give me messages older than the cursor" (newest-first scroll,
 *              the natural shape for an inverted chat list — initial fetch
 *              returns the latest N, subsequent pages walk backwards in time).
 *
 * Server contract: `items` are ALWAYS returned in chronological order (asc)
 * regardless of the requested direction. `desc` only flips which slice the
 * cursor selects. This keeps the UI logic simple — clients append/prepend
 * without re-sorting.
 */
export const MessageListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
});
export type MessageListQuery = z.infer<typeof MessageListQuerySchema>;

/**
 * Query for `GET /chats/:chatId/media` — the per-chat media gallery used by
 * the Contact Profile screen (BRD §3.3 "Media Links & Docs").
 *
 * `kind` is restricted to media-bearing kinds; TEXT and SYSTEM never appear
 * in the gallery. Pagination shares the same cursor scheme as the message
 * list, just narrower content. `direction` defaults to `desc` (newest-first)
 * — the gallery grid reads top-to-bottom newest → oldest like Photos.app.
 */
export const ChatMediaListQuerySchema = z.object({
  kind: z.enum(['IMAGE', 'VOICE']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(60).optional().default(30),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
});
export type ChatMediaListQuery = z.infer<typeof ChatMediaListQuerySchema>;

export const SendMessageSchema = z
  .object({
    clientMessageId: z.string().min(1).max(64),
    kind: MessageKindEnum,
    text: z.string().trim().min(1).max(4000).optional(),
    mediaObjectKey: z.string().max(256).optional(),
    /** IMAGE only — required when `kind: 'IMAGE'`. */
    imageWidth: z.number().int().positive().max(20_000).optional(),
    /** IMAGE only — required when `kind: 'IMAGE'`. */
    imageHeight: z.number().int().positive().max(20_000).optional(),
    durationSec: z.number().int().positive().max(300).optional(),
    waveform: z.array(z.number().min(0).max(1)).max(120).optional(),
    /** DOCUMENT/VIDEO — exact MIME of the uploaded object. */
    mediaMimeType: z.string().min(1).max(80).optional(),
    /** VIDEO only. */
    videoDurationSec: z.number().int().positive().max(7_200).optional(),
    videoWidth: z.number().int().positive().max(20_000).optional(),
    videoHeight: z.number().int().positive().max(20_000).optional(),
    /** LOCATION only. */
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    locationName: z.string().trim().min(1).max(120).optional(),
    /** CONTACT_CARD only. */
    contactName: z.string().trim().min(1).max(120).optional(),
    contactPhoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
    /** DOCUMENT only. */
    documentTitle: z.string().trim().min(1).max(255).optional(),
    documentSizeBytes: z.number().int().positive().max(104_857_600).optional(),
    /** Unified media size in bytes — IMAGE/VOICE/VIDEO/DOCUMENT (populated on send). */
    mediaSizeBytes: z.number().int().positive().max(104_857_600).optional(),
    replyToMessageId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (SERVER_ONLY_KINDS.has(v.kind)) {
      ctx.addIssue({
        code: 'custom',
        message: `kind_not_allowed_from_client: ${v.kind} messages are authored server-side`,
        path: ['kind'],
      });
      return;
    }
    if (v.kind === 'TEXT' && !v.text) {
      ctx.addIssue({ code: 'custom', message: 'text is required for TEXT messages', path: ['text'] });
    }
    if (v.kind === 'VOICE' && (v.durationSec === undefined || v.waveform === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'durationSec and waveform are required for VOICE messages',
        path: ['durationSec'],
      });
    }
    if (v.kind === 'VOICE' && !v.mediaObjectKey) {
      ctx.addIssue({
        code: 'custom',
        message: 'mediaObjectKey is required for VOICE messages',
        path: ['mediaObjectKey'],
      });
    }
    if (v.kind === 'IMAGE') {
      if (!v.mediaObjectKey) {
        ctx.addIssue({
          code: 'custom',
          message: 'mediaObjectKey is required for IMAGE messages',
          path: ['mediaObjectKey'],
        });
      }
      if (v.imageWidth === undefined || v.imageHeight === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'imageWidth and imageHeight are required for IMAGE messages',
          path: ['imageWidth'],
        });
      }
    }
    if (v.kind === 'DOCUMENT') {
      if (!v.mediaObjectKey || !v.mediaMimeType || !v.documentTitle || v.documentSizeBytes === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'mediaObjectKey, mediaMimeType, documentTitle and documentSizeBytes are required for DOCUMENT messages',
          path: ['mediaObjectKey'],
        });
      }
    }
    if (v.kind === 'VIDEO') {
      if (
        !v.mediaObjectKey ||
        !v.mediaMimeType ||
        v.videoDurationSec === undefined ||
        v.videoWidth === undefined ||
        v.videoHeight === undefined
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'mediaObjectKey, mediaMimeType, videoDurationSec, videoWidth and videoHeight are required for VIDEO messages',
          path: ['mediaObjectKey'],
        });
      }
    }
    if (v.kind === 'LOCATION' && (v.latitude === undefined || v.longitude === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'latitude and longitude are required for LOCATION messages',
        path: ['latitude'],
      });
    }
    if (v.kind === 'CONTACT_CARD' && (!v.contactName || !v.contactPhoneE164)) {
      ctx.addIssue({
        code: 'custom',
        message: 'contactName and contactPhoneE164 are required for CONTACT_CARD messages',
        path: ['contactName'],
      });
    }
  });
export type SendMessageBody = z.infer<typeof SendMessageSchema>;

// ─── Socket.IO gateway events ────────────────────────────────────────────────
//
// Event names + payloads shared by the Nest gateway and the mobile client.
// Kept here so the two are guaranteed to agree on the wire format.

/** Client → server: send a message in a chat I'm a member of. */
export const SocketMessageSendSchema = z.object({
  chatId: z.string().uuid(),
  body: SendMessageSchema,
});
export type SocketMessageSendPayload = z.infer<typeof SocketMessageSendSchema>;

/** Server → client ack to a `message:send`. Either ok with the durable message, or
 *  fail with an error code the UI can branch on (the original `clientMessageId`
 *  is always echoed so the optimistic insert can be reconciled either way). */
export const SocketMessageSendAckSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    clientMessageId: z.string(),
    message: MessageSchema,
  }),
  z.object({
    ok: z.literal(false),
    clientMessageId: z.string(),
    code: z.enum(['not_a_member', 'rate_limited', 'invalid_payload', 'server_error']),
    message: z.string(),
  }),
]);
export type SocketMessageSendAck = z.infer<typeof SocketMessageSendAckSchema>;

/** Server → all clients in `chat:{chatId}` room when a new message lands. */
export const SocketMessageNewSchema = MessageSchema;
export type SocketMessageNew = MessageDto;

/** Client → server: catch me up since `lastSeenSequence` (used on reconnect). */
export const SocketSessionResumeSchema = z.object({
  chatId: z.string().uuid(),
  lastSeenSequence: z.string().regex(/^\d+$/),
});
export type SocketSessionResumePayload = z.infer<typeof SocketSessionResumeSchema>;

/** Server → client reply to `session:resume` — missed messages in chronological order. */
export const SocketSessionResumeReplySchema = z.object({
  chatId: z.string().uuid(),
  items: z.array(MessageSchema),
  hasMore: z.boolean(),
});
export type SocketSessionResumeReply = z.infer<typeof SocketSessionResumeReplySchema>;

/** Server → client when a peer's lastReadSequence advances. */
export const SocketReadReceiptSchema = z.object({
  chatId: z.string().uuid(),
  userId: z.string().uuid(),
  uptoSequence: z.string().regex(/^\d+$/),
});
export type SocketReadReceipt = z.infer<typeof SocketReadReceiptSchema>;

// ─── Typing indicator ────────────────────────────────────────────────────────
//
// Client emits `typing:start` on first keystroke (and every ~3s while typing)
// and `typing:stop` on blur/send/clear. Server stores `typing:{chatId}:{userId}`
// in Redis with a 5s TTL and broadcasts `typing:update` to the room. Peers
// re-broadcast on each refresh so the receiver doesn't have to handle "stop"
// explicitly — the indicator just expires if no refresh arrives.

export const SocketTypingPingSchema = z.object({
  chatId: z.string().uuid(),
});
export type SocketTypingPing = z.infer<typeof SocketTypingPingSchema>;

export const SocketTypingUpdateSchema = z.object({
  chatId: z.string().uuid(),
  userId: z.string().uuid(),
  /** true = user started/continues typing; false = explicit stop. */
  isTyping: z.boolean(),
});
export type SocketTypingUpdate = z.infer<typeof SocketTypingUpdateSchema>;

// ─── Presence ────────────────────────────────────────────────────────────────
//
// Online status + last-seen. Server tracks `presence:{userId}` as a Redis
// hash with `{ socketCount, lastSeenAt }`; on connect we INCR and broadcast
// `presence:update isOnline=true`; on disconnect we DECR and, if count hits 0,
// write `lastSeenAt = now` and broadcast `isOnline=false`. Subscribers receive
// updates for every user whose chats they share (the gateway joins them to
// `presence:{userId}` rooms on connect).

export const SocketPresenceRequestSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
});
export type SocketPresenceRequest = z.infer<typeof SocketPresenceRequestSchema>;

export const SocketPresenceUpdateSchema = z.object({
  userId: z.string().uuid(),
  isOnline: z.boolean(),
  /** ISO timestamp; only meaningful when isOnline === false. */
  lastSeenAt: z.string().datetime().nullable(),
});
export type SocketPresenceUpdate = z.infer<typeof SocketPresenceUpdateSchema>;

export const SocketPresenceSnapshotSchema = z.object({
  items: z.array(SocketPresenceUpdateSchema),
});
export type SocketPresenceSnapshot = z.infer<typeof SocketPresenceSnapshotSchema>;

// ─── Message deletion ────────────────────────────────────────────────────────
//
// Soft delete — server sets `deletedAt` and zeroes content. Two scopes:
//   - `self` removes the message only from the sender's own client (we just
//     mark a row in user_message_state, never touching the message itself).
//   - `everyone` flips `deletedAt` and broadcasts `message:deleted` so all
//     room members render the tombstone. Only allowed within the edit window
//     (default 60min from createdAt) and only by the sender.

export const MessageDeleteScopeSchema = z.enum(['self', 'everyone']);
export type MessageDeleteScope = z.infer<typeof MessageDeleteScopeSchema>;

export const SocketMessageDeletedSchema = z.object({
  chatId: z.string().uuid(),
  messageId: z.string().uuid(),
  deletedByUserId: z.string().uuid(),
  scope: MessageDeleteScopeSchema,
});
export type SocketMessageDeleted = z.infer<typeof SocketMessageDeletedSchema>;

/** Canonical event names — string constants imported by both sides. */
export const SocketEvents = {
  messageSend: 'message:send',
  messageNew: 'message:new',
  messageDeleted: 'message:deleted',
  sessionResume: 'session:resume',
  sessionResumeReply: 'session:resume:reply',
  readReceipt: 'chat:read',
  typingPing: 'typing:ping',
  typingUpdate: 'typing:update',
  presenceRequest: 'presence:request',
  presenceSnapshot: 'presence:snapshot',
  presenceUpdate: 'presence:update',
  reactionUpdated: 'reaction:updated',
  messagePinned: 'message:pinned',
  messageUnpinned: 'message:unpinned',
  pollVoted: 'poll:voted',
  callRing: 'call:ring',
  callAccepted: 'call:accepted',
  callEnded: 'call:ended',
  callTaken: 'call:taken',
} as const;

/** S→C when a message is pinned (Tranche 2.E). Broadcast on `chat:{chatId}`. */
export const SocketMessagePinnedSchema = z.object({
  chatId: z.string().uuid(),
  messageId: z.string().uuid(),
  pinnedByUserId: z.string().uuid(),
  pinnedAt: z.string().datetime(),
});
export type SocketMessagePinned = z.infer<typeof SocketMessagePinnedSchema>;

/** S→C when a message is unpinned (Tranche 2.E). */
export const SocketMessageUnpinnedSchema = z.object({
  chatId: z.string().uuid(),
  messageId: z.string().uuid(),
});
export type SocketMessageUnpinned = z.infer<typeof SocketMessageUnpinnedSchema>;

/** GET /chats/:id — full thread detail for the chat screen. */
export const ChatDetailSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['ONE_ON_ONE', 'GROUP', 'SUPER_GROUP']),
  title: z.string(),
  avatarUri: z.string().url().nullable(),
  counterpart: z
    .object({
      id: z.string().uuid(),
      displayName: z.string(),
      phoneE164: z.string().nullable(),
      avatarUri: z.string().url().nullable(),
    })
    .nullable(),
  lastReadSequence: z.string().regex(/^\d+$/),
  /**
   * The counterpart's `lastReadSequence` — how far the OTHER user has read
   * in this thread. The chat screen uses this on initial load to mark every
   * mine-message with `sequence ≤ counterpartLastReadSequence` as `read`
   * (lime double-tick) instead of `delivered` (grey). Without this, bubbles
   * the peer already read look unread to me until the next interaction.
   * Null for non-1-on-1 chats (groups have N readers).
   *
   * Phase A read-receipt cold-start fix (2026-05-25 verify, finding F1
   * follow-up). See `docs/progress/1-on-1-production.md` Phase A
   * Known Limitations #1.
   */
  counterpartLastReadSequence: z.string().regex(/^\d+$/).nullable(),
  /**
   * Per-user per-chat theme override (P2-Theme). Null = default theme.
   * Values: 'default' | 'midnight' | 'forest' | 'sunset'.
   */
  chatTheme: ChatThemeEnum.nullable().default(null),
});
export type ChatDetailDto = z.infer<typeof ChatDetailSchema>;
