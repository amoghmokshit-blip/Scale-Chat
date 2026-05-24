import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageKind, Prisma } from '@prisma/client';
import type {
  ChatDetailDto,
  MediaUploadKind,
  MessageDeleteScope,
  MessageDto,
  MessageListResponse,
  SendMessageBody,
} from '@scalechat/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { buildPage, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
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
      replyToMessageId: m.replyToMessageId,
      createdAt: m.createdAt.toISOString(),
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    };
  };
}

@Injectable()
export class MessagesService {
  private readonly rowToDto: (m: MessageRow) => MessageDto;
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
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

  async getChat(userId: string, chatId: string): Promise<ChatDetailDto> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      include: {
        chat: {
          include: {
            members: {
              where: { userId: { not: userId }, leftAt: null },
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
    const counterpart = chat.kind === 'ONE_ON_ONE' ? chat.members[0]?.user ?? null : null;
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
    };
  }

  async list(
    userId: string,
    chatId: string,
    cursor: string | undefined,
    limit: number,
    direction: 'asc' | 'desc' = 'desc'
  ): Promise<MessageListResponse> {
    await this.assertMember(userId, chatId);

    const c = decodeCursor(cursor, isMessageCursor);

    // Fetch in the requested direction so the cursor selects "newer than" vs
    // "older than" the anchor. We always sort items asc before returning so
    // the client doesn't have to think about it.
    const rows = await this.prisma.message.findMany({
      where: { chatId },
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

    // Validate the supplied object key belongs to this sender for IMAGE/VOICE
    // before we touch the DB. Stops a client pasting an arbitrary key.
    if (body.kind === 'IMAGE' || body.kind === 'VOICE') {
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

    // Allocate sequence under per-chat advisory lock so concurrent sends are
    // strictly ordered. The lock key is the chat-id as bigint (first 8 bytes).
    return this.prisma.$transaction(async (tx) => {
      const key = chatIdToAdvisoryKey(chatId);
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock($1::bigint)`, key);

      const max = await tx.message.aggregate({
        where: { chatId },
        _max: { sequence: true },
      });
      const next = (max._max.sequence ?? 0n) + 1n;

      const created = await tx.message.create({
        data: {
          chatId,
          senderUserId: userId,
          clientMessageId: body.clientMessageId,
          sequence: next,
          kind: body.kind,
          text: body.kind === 'TEXT' ? body.text ?? null : null,
          mediaObjectKey: body.kind === 'IMAGE' || body.kind === 'VOICE' ? body.mediaObjectKey ?? null : null,
          imageWidth: body.kind === 'IMAGE' ? body.imageWidth ?? null : null,
          imageHeight: body.kind === 'IMAGE' ? body.imageHeight ?? null : null,
          durationSec: body.kind === 'VOICE' ? body.durationSec ?? null : null,
          waveform:
            body.kind === 'VOICE' && body.waveform ? (body.waveform as Prisma.InputJsonValue) : Prisma.JsonNull,
          replyToMessageId: body.replyToMessageId ?? null,
        },
      });

      await tx.chat.update({
        where: { id: chatId },
        data: { lastMessageId: created.id, lastMessageAt: created.createdAt },
      });

      // Sender's own read position advances to the message they just sent.
      await tx.chatMember.update({
        where: { chatId_userId: { chatId, userId } },
        data: { lastReadSequence: next },
      });

      return rowToDto(created);
    });
  }
}

function chatIdToAdvisoryKey(chatId: string): bigint {
  // Stable bigint derived from the chat-id UUID. Take the first 8 hex bytes,
  // reinterpret as a signed bigint (Postgres accepts signed bigint advisory keys).
  const hex = chatId.replace(/-/g, '').slice(0, 16);
  const unsigned = BigInt(`0x${hex}`);
  const signed = unsigned >= 1n << 63n ? unsigned - (1n << 64n) : unsigned;
  return signed;
}
