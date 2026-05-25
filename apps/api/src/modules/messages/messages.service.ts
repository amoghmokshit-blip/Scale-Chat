import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageKind, Prisma } from '@prisma/client';
import { SERVER_ONLY_KINDS } from '@scalechat/shared';
import type {
  ChatDetailDto,
  ChatMediaListQuery,
  MediaUploadKind,
  MessageDeleteScope,
  MessageDto,
  MessageListResponse,
  SendMessageBody,
} from '@scalechat/shared';

/** Kinds whose `mediaObjectKey` must be validated against the sender's prefix. */
const MEDIA_BACKED_KINDS: ReadonlySet<MessageKind> = new Set([
  MessageKind.IMAGE,
  MessageKind.VOICE,
  MessageKind.DOCUMENT,
  MessageKind.VIDEO,
]);

import { PrismaService } from '../../common/prisma/prisma.service';
import { buildPage, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { BlocksService } from '../blocks/blocks.service';
import { MediaService } from '../media/media.service';

type MessageCursor = { createdAt: string; id: string };

function isMessageCursor(raw: unknown): raw is MessageCursor {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return typeof r.createdAt === 'string' && typeof r.id === 'string';
}

type MessageRow = {
  id: string;
  chatId: string;
  senderUserId: string;
  clientMessageId: string;
  sequence: bigint;
  kind: MessageKind;
  text: string | null;
  mediaObjectKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  durationSec: number | null;
  waveform: Prisma.JsonValue | null;
  mediaMimeType: string | null;
  videoDurationSec: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  contactName: string | null;
  contactPhoneE164: string | null;
  documentTitle: string | null;
  documentSizeBytes: bigint | null;
  forwardedFromMessageId: string | null;
  forwardCount: number;
  pinnedAt: Date | null;
  pinnedByUserId: string | null;
  replyToMessageId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

function buildRowToDto(media: MediaService) {
  return function rowToDto(m: MessageRow): MessageDto {
    // Tombstones zero out content — mediaUrl follows.
    const mediaUrl = m.deletedAt ? null : media.publicUrlFor(m.mediaObjectKey);
    return {
      id: m.id,
      chatId: m.chatId,
      senderUserId: m.senderUserId,
      clientMessageId: m.clientMessageId,
      sequence: m.sequence.toString(),
      kind: m.kind,
      text: m.text,
      mediaObjectKey: m.mediaObjectKey,
      mediaUrl,
      imageWidth: m.imageWidth,
      imageHeight: m.imageHeight,
      durationSec: m.durationSec,
      waveform: Array.isArray(m.waveform) ? (m.waveform as number[]) : null,
      mediaMimeType: m.mediaMimeType,
      videoDurationSec: m.videoDurationSec,
      videoWidth: m.videoWidth,
      videoHeight: m.videoHeight,
      latitude: m.latitude,
      longitude: m.longitude,
      locationName: m.locationName,
      contactName: m.contactName,
      contactPhoneE164: m.contactPhoneE164,
      documentTitle: m.documentTitle,
      documentSizeBytes: m.documentSizeBytes !== null ? Number(m.documentSizeBytes) : null,
      forwardedFromMessageId: m.forwardedFromMessageId,
      forwardCount: m.forwardCount,
      pinnedAt: m.pinnedAt ? m.pinnedAt.toISOString() : null,
      pinnedByUserId: m.pinnedByUserId,
      replyToMessageId: m.replyToMessageId,
      createdAt: m.createdAt.toISOString(),
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      // Reactions default to empty here so the wire shape matches the zod
      // schema without forcing every read path to join. Hot paths that care
      // (e.g. `GET /chats/:id/messages`) load reactions in a batched query
      // and call `injectReactions(dtos, aggregates)` to fold them in.
      reactions: [],
    };
  };
}

@Injectable()
export class MessagesService {
  /** Public so sibling modules (Pin) can map rows they loaded into the wire DTO. */
  readonly rowToDto: (m: MessageRow) => MessageDto;
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly blocks: BlocksService,
  ) {
    this.rowToDto = buildRowToDto(media);
  }

  /** Membership check used by every messages-scoped read/write. */
  private async assertMember(userId: string, chatId: string): Promise<void> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true, leftAt: true },
    });
    if (!member || member.leftAt !== null) {
      throw new ForbiddenException({
        code: 'not_a_member',
        message: 'You are not a member of this chat.',
      });
    }
  }

  /**
   * Like `assertMember` but also returns the caller's per-membership state —
   * used by `list` / `listMedia` to filter cleared messages, and by `send` to
   * skip block-checks on group chats.
   */
  private async loadMemberOrThrow(
    userId: string,
    chatId: string,
  ): Promise<{ id: string; clearedAt: Date | null }> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true, leftAt: true, clearedAt: true },
    });
    if (!member || member.leftAt !== null) {
      throw new ForbiddenException({
        code: 'not_a_member',
        message: 'You are not a member of this chat.',
      });
    }
    return { id: member.id, clearedAt: member.clearedAt };
  }

  async getChat(userId: string, chatId: string): Promise<ChatDetailDto> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      include: {
        chat: {
          include: {
            members: {
              where: { userId: { not: userId }, leftAt: null },
              // Pull the counterpart's lastReadSequence in the same query so
              // the client can flip already-read mine-bubbles to lime double-
              // tick on initial mount (cold-start read receipts — Phase A
              // Known-Limit #1, 2026-05-25 verify follow-up).
              include: {
                user: { select: { id: true, fullName: true, avatarUri: true, phoneE164: true } },
              },
              take: 1,
            },
          },
        },
      },
    });
    if (!member) {
      throw new NotFoundException({ code: 'chat_not_found', message: 'Chat not found.' });
    }

    const chat = member.chat;
    const counterpartMember = chat.kind === 'ONE_ON_ONE' ? chat.members[0] ?? null : null;
    const counterpart = counterpartMember?.user ?? null;
    const title =
      chat.kind === 'ONE_ON_ONE'
        ? counterpart?.fullName ?? 'Direct chat'
        : chat.title ?? 'Group';

    return {
      id: chat.id,
      kind: chat.kind,
      title,
      avatarUri: chat.avatarUri ?? counterpart?.avatarUri ?? null,
      counterpart: counterpart
        ? {
            id: counterpart.id,
            displayName: counterpart.fullName,
            // 1-on-1 chats reveal the counterpart's phone (per product invariant
            // in CLAUDE.md §1). Super Group masking lives in a separate gateway.
            phoneE164: counterpart.phoneE164 ?? null,
            avatarUri: counterpart.avatarUri ?? null,
          }
        : null,
      lastReadSequence: member.lastReadSequence.toString(),
      counterpartLastReadSequence:
        counterpartMember?.lastReadSequence.toString() ?? null,
    };
  }

  async list(
    userId: string,
    chatId: string,
    cursor: string | undefined,
    limit: number,
    direction: 'asc' | 'desc' = 'desc'
  ): Promise<MessageListResponse> {
    const member = await this.loadMemberOrThrow(userId, chatId);

    const c = decodeCursor(cursor, isMessageCursor);

    // Per-user "Clear chat" cutoff — messages at-or-before clearedAt are
    // hidden from THIS user but remain visible to peers. The cutoff is
    // applied at the `where` so cursor pagination still terminates correctly.
    const clearedFilter = member.clearedAt
      ? { createdAt: { gt: member.clearedAt } }
      : {};

    // Fetch in the requested direction so the cursor selects "newer than" vs
    // "older than" the anchor. We always sort items asc before returning so
    // the client doesn't have to think about it.
    const rows = await this.prisma.message.findMany({
      where: { chatId, ...clearedFilter },
      orderBy: [
        { createdAt: direction },
        { id: direction },
      ],
      take: limit + 1,
      ...(c
        ? {
            skip: 1,
            cursor: { id: c.id },
          }
        : {}),
    });

    // Walk the fetched window in chronological order so callers can append
    // without sorting. `buildPage` peels the +1 sentinel off the END of the
    // fetched-direction array, so we trim first then sort.
    const trimmedPage = buildPage(rows, limit, (last) =>
      encodeCursor<MessageCursor>({ createdAt: last.createdAt.toISOString(), id: last.id })
    );
    const sortedAsc = [...trimmedPage.items].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
    );

    return {
      items: sortedAsc.map(this.rowToDto),
      meta: trimmedPage.meta,
    };
  }

  /**
   * Per-chat media gallery — feeds the Contact Profile screen's "Media Links
   * & Docs" tab (BRD §3.3). Same cursor scheme as `list`, narrowed to
   * media-bearing kinds and filtered by `?kind=` when provided.
   *
   * Excludes tombstones — once a message is soft-deleted its `mediaObjectKey`
   * is zeroed in `deleteMessage`, so even past media stops appearing here.
   */
  async listMedia(
    userId: string,
    chatId: string,
    query: ChatMediaListQuery,
  ): Promise<MessageListResponse> {
    await this.assertMember(userId, chatId);

    const c = decodeCursor(query.cursor, isMessageCursor);
    const kindFilter = query.kind ? { kind: query.kind } : { kind: { in: ['IMAGE', 'VOICE'] as MessageKind[] } };

    const rows = await this.prisma.message.findMany({
      where: {
        chatId,
        deletedAt: null,
        ...kindFilter,
      },
      orderBy: [{ createdAt: query.direction }, { id: query.direction }],
      take: query.limit + 1,
      ...(c
        ? {
            skip: 1,
            cursor: { id: c.id },
          }
        : {}),
    });

    const trimmedPage = buildPage(rows, query.limit, (last) =>
      encodeCursor<MessageCursor>({ createdAt: last.createdAt.toISOString(), id: last.id }),
    );
    const sortedAsc = [...trimmedPage.items].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );

    return {
      items: sortedAsc.map(this.rowToDto),
      meta: trimmedPage.meta,
    };
  }

  /**
   * Soft-delete a message. Two scopes:
   *   - `everyone`: flips `deletedAt`, zeros content, broadcasts a tombstone.
   *     Only the sender, only within the edit window (60 min default).
   *   - `self`: not yet wired to a per-viewer hidden-list; today this is treated
   *     as an alias for `everyone` if you're the sender, and rejected otherwise.
   *     (The per-viewer table lands with the Super Group privacy layer.)
   *
   * Returns the updated `MessageDto` so the caller can broadcast it.
   */
  async deleteMessage(
    userId: string,
    chatId: string,
    messageId: string,
    scope: MessageDeleteScope
  ): Promise<{ messageId: string; scope: MessageDeleteScope }> {
    await this.assertMember(userId, chatId);

    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, chatId: true, senderUserId: true, createdAt: true, deletedAt: true },
    });
    if (!msg || msg.chatId !== chatId) {
      throw new NotFoundException({ code: 'message_not_found', message: 'Message not found.' });
    }
    if (msg.deletedAt) {
      // Already deleted — idempotent return.
      return { messageId, scope };
    }
    if (msg.senderUserId !== userId) {
      throw new ForbiddenException({
        code: 'not_sender',
        message: 'Only the sender can delete a message.',
      });
    }

    // Edit window — 60 minutes from createdAt.
    const ageMs = Date.now() - msg.createdAt.getTime();
    const EDIT_WINDOW_MS = 60 * 60 * 1_000;
    if (scope === 'everyone' && ageMs > EDIT_WINDOW_MS) {
      throw new BadRequestException({
        code: 'edit_window_passed',
        message: 'You can only delete a message for everyone within 60 minutes of sending.',
      });
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        text: null,
        mediaObjectKey: null,
        durationSec: null,
        waveform: Prisma.JsonNull,
      },
    });
    return { messageId, scope };
  }

  async send(userId: string, chatId: string, body: SendMessageBody): Promise<MessageDto> {
    await this.assertMember(userId, chatId);

    // Block enforcement for 1-on-1 chats — if either party in either direction
    // has blocked the other, the send is rejected. Group / Super Group chats
    // don't apply blocks at the message layer (a blocker can leave the group
    // instead). Lookup is a single PK probe on `blocked_users`.
    const chatKind = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { kind: true },
    });
    if (chatKind?.kind === 'ONE_ON_ONE') {
      const counterpart = await this.prisma.chatMember.findFirst({
        where: { chatId, userId: { not: userId }, leftAt: null },
        select: { userId: true },
      });
      if (counterpart && (await this.blocks.isBlockedEitherWay(userId, counterpart.userId))) {
        throw new ForbiddenException({
          code: 'peer_blocked',
          message: 'Messages cannot be sent in this chat — one of you has blocked the other.',
        });
      }
    }

    // Server-only kinds (SYSTEM/POLL/CALL_EVENT/LOCATION_LIVE) are authored
    // server-side — reject them here too (zod superRefine already blocks them,
    // this is defence-in-depth against a path that skips the pipe).
    if (SERVER_ONLY_KINDS.has(body.kind)) {
      throw new BadRequestException({
        code: 'kind_not_allowed_from_client',
        message: `${body.kind} messages are authored server-side.`,
      });
    }

    // Validate the supplied object key belongs to this sender for media-backed
    // kinds (IMAGE/VOICE/DOCUMENT/VIDEO) before we touch the DB. Stops a client
    // pasting an arbitrary key.
    if (MEDIA_BACKED_KINDS.has(body.kind)) {
      if (!body.mediaObjectKey) {
        // Zod's superRefine already catches this, but defend-in-depth.
        throw new BadRequestException({
          code: 'media_key_required',
          message: `mediaObjectKey is required for ${body.kind} messages.`,
        });
      }
      this.media.validateObjectKey({
        userId,
        objectKey: body.mediaObjectKey,
        kind: body.kind as MediaUploadKind,
      });
    }

    // Idempotency: a retry with the same clientMessageId returns the prior row.
    const existing = await this.prisma.message.findUnique({
      where: { senderUserId_clientMessageId: { senderUserId: userId, clientMessageId: body.clientMessageId } },
    });
    if (existing) return this.rowToDto(existing);

    const rowToDto = this.rowToDto;

    return this.prisma.$transaction(async (tx) => {
      const created = await this.allocateAndCreate(tx, {
        chatId,
        senderUserId: userId,
        clientMessageId: body.clientMessageId,
        kind: body.kind,
        text: body.kind === 'TEXT' ? body.text ?? null : null,
        mediaObjectKey: MEDIA_BACKED_KINDS.has(body.kind) ? body.mediaObjectKey ?? null : null,
        imageWidth: body.kind === 'IMAGE' ? body.imageWidth ?? null : null,
        imageHeight: body.kind === 'IMAGE' ? body.imageHeight ?? null : null,
        durationSec: body.kind === 'VOICE' ? body.durationSec ?? null : null,
        waveform:
          body.kind === 'VOICE' && body.waveform ? (body.waveform as Prisma.InputJsonValue) : Prisma.JsonNull,
        // DOCUMENT/VIDEO MIME.
        mediaMimeType: body.kind === 'DOCUMENT' || body.kind === 'VIDEO' ? body.mediaMimeType ?? null : null,
        // VIDEO.
        videoDurationSec: body.kind === 'VIDEO' ? body.videoDurationSec ?? null : null,
        videoWidth: body.kind === 'VIDEO' ? body.videoWidth ?? null : null,
        videoHeight: body.kind === 'VIDEO' ? body.videoHeight ?? null : null,
        // LOCATION.
        latitude: body.kind === 'LOCATION' ? body.latitude ?? null : null,
        longitude: body.kind === 'LOCATION' ? body.longitude ?? null : null,
        locationName: body.kind === 'LOCATION' ? body.locationName ?? null : null,
        // CONTACT_CARD.
        contactName: body.kind === 'CONTACT_CARD' ? body.contactName ?? null : null,
        contactPhoneE164: body.kind === 'CONTACT_CARD' ? body.contactPhoneE164 ?? null : null,
        // DOCUMENT.
        documentTitle: body.kind === 'DOCUMENT' ? body.documentTitle ?? null : null,
        documentSizeBytes:
          body.kind === 'DOCUMENT' && body.documentSizeBytes !== undefined
            ? BigInt(body.documentSizeBytes)
            : null,
        replyToMessageId: body.replyToMessageId ?? null,
      });
      return rowToDto(created);
    });
  }

  /**
   * Load a raw message row by id (for Forward to clone). Null if not found.
   */
  async getMessageRow(messageId: string): Promise<MessageRow | null> {
    return this.prisma.message.findUnique({ where: { id: messageId } });
  }

  /**
   * Create a forwarded copy of `source` into `targetChatId` as `forwarderUserId`.
   * Idempotent on the caller-supplied deterministic `clientMessageId` (the
   * ForwardService hashes the source/forwarder/target triple). Clones the
   * content columns + sets `forwardedFromMessageId`; deliberately drops
   * `replyToMessageId` (would dangle into a chat that lacks the quoted message)
   * and never carries the source's pin/forward bookkeeping.
   */
  async forwardInto(
    forwarderUserId: string,
    targetChatId: string,
    source: MessageRow,
    clientMessageId: string,
  ): Promise<{ message: MessageDto; created: boolean }> {
    const existing = await this.prisma.message.findUnique({
      where: {
        senderUserId_clientMessageId: { senderUserId: forwarderUserId, clientMessageId },
      },
    });
    // Idempotent: a re-forward of the same source→target returns the prior row
    // WITHOUT a new insert — `created:false` so the caller doesn't double-count
    // `forwardCount`.
    if (existing) return { message: this.rowToDto(existing), created: false };

    const rowToDto = this.rowToDto;
    return this.prisma.$transaction(async (tx) => {
      const created = await this.allocateAndCreate(tx, {
        chatId: targetChatId,
        senderUserId: forwarderUserId,
        clientMessageId,
        kind: source.kind,
        text: source.text,
        mediaObjectKey: source.mediaObjectKey,
        imageWidth: source.imageWidth,
        imageHeight: source.imageHeight,
        durationSec: source.durationSec,
        waveform:
          source.waveform === null ? Prisma.JsonNull : (source.waveform as Prisma.InputJsonValue),
        mediaMimeType: source.mediaMimeType,
        videoDurationSec: source.videoDurationSec,
        videoWidth: source.videoWidth,
        videoHeight: source.videoHeight,
        latitude: source.latitude,
        longitude: source.longitude,
        locationName: source.locationName,
        contactName: source.contactName,
        contactPhoneE164: source.contactPhoneE164,
        documentTitle: source.documentTitle,
        documentSizeBytes: source.documentSizeBytes,
        forwardedFromMessageId: source.id,
        replyToMessageId: null,
      });
      return { message: rowToDto(created), created: true };
    });
  }

  /**
   * Shared message-creation tail used by `send` + `forwardInto`: allocate the
   * per-chat sequence under an advisory lock, create the row, bump the chat's
   * lastMessage pointer + the sender's own read cursor. The caller owns all
   * validation; this just does the locked write.
   */
  private async allocateAndCreate(
    tx: Prisma.TransactionClient,
    data: Omit<Prisma.MessageUncheckedCreateInput, 'sequence'>,
  ): Promise<MessageRow> {
    const chatId = data.chatId;
    const key = chatIdToAdvisoryKey(chatId);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock($1::bigint)`, key);

    const max = await tx.message.aggregate({ where: { chatId }, _max: { sequence: true } });
    const next = (max._max.sequence ?? 0n) + 1n;

    const created = await tx.message.create({ data: { ...data, sequence: next } });

    await tx.chat.update({
      where: { id: chatId },
      data: { lastMessageId: created.id, lastMessageAt: created.createdAt },
    });
    // Sender's own read position advances to the message they just authored.
    await tx.chatMember.update({
      where: { chatId_userId: { chatId, userId: data.senderUserId } },
      data: { lastReadSequence: next },
    });

    return created;
  }
}

export function chatIdToAdvisoryKey(chatId: string): bigint {
  // Stable bigint derived from the chat-id UUID. Take the first 8 hex bytes,
  // reinterpret as a signed bigint (Postgres accepts signed bigint advisory keys).
  const hex = chatId.replace(/-/g, '').slice(0, 16);
  const unsigned = BigInt(`0x${hex}`);
  const signed = unsigned >= 1n << 63n ? unsigned - (1n << 64n) : unsigned;
  return signed;
}
