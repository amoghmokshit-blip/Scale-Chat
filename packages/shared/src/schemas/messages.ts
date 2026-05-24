import { z } from 'zod';

import { paginatedResponse } from './common.js';

export const MessageKindEnum = z.enum(['TEXT', 'VOICE', 'IMAGE', 'SYSTEM']);
export type MessageKind = z.infer<typeof MessageKindEnum>;

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
  replyToMessageId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  /**
   * If non-null, the message was deleted-for-everyone. The server zeroes
   * `text` / `mediaObjectKey` / `durationSec` / `waveform` when this is set,
   * so clients should render a `This message was deleted` tombstone in place
   * of the original content.
   */
  deletedAt: z.string().datetime().nullable(),
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
    replyToMessageId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
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
} as const;

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
});
export type ChatDetailDto = z.infer<typeof ChatDetailSchema>;
