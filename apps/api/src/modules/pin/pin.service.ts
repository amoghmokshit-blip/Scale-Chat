import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MAX_PINNED_PER_CHAT, type MessageDto, type PinListResponse } from '@scalechat/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { MessagesService, chatIdToAdvisoryKey } from '../messages/messages.service';

/**
 * Pin / unpin messages within a chat (Tranche 2.E). Max 3 pinned per chat.
 *
 * The cap is enforced under the same per-chat advisory lock the send path uses,
 * so two concurrent pins can't both pass the count check and produce a 4th pin.
 * Every path asserts the message actually belongs to `chatId` (a member of chat
 * B must not be able to pin a message that lives in chat A).
 */
@Injectable()
export class PinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  async pin(userId: string, chatId: string, messageId: string): Promise<MessageDto> {
    await this.assertMemberAndMessage(userId, chatId, messageId, { rejectTombstone: true });

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock($1::bigint)`,
        chatIdToAdvisoryKey(chatId),
      );
      const current = await tx.message.findUnique({
        where: { id: messageId },
        select: { pinnedAt: true },
      });
      // Already pinned → idempotent no-op (don't consume a cap slot twice).
      if (current?.pinnedAt) return;
      const pinnedCount = await tx.message.count({
        where: { chatId, pinnedAt: { not: null }, deletedAt: null },
      });
      if (pinnedCount >= MAX_PINNED_PER_CHAT) {
        throw new ConflictException({
          code: 'pin_cap_exceeded',
          message: `A chat can have at most ${MAX_PINNED_PER_CHAT} pinned messages. Unpin one first.`,
        });
      }
      await tx.message.update({
        where: { id: messageId },
        data: { pinnedAt: new Date(), pinnedByUserId: userId },
      });
    });

    return this.requireDto(messageId);
  }

  async unpin(userId: string, chatId: string, messageId: string): Promise<MessageDto> {
    await this.assertMemberAndMessage(userId, chatId, messageId, { rejectTombstone: false });
    // Idempotent — clearing an already-unpinned message is a no-op.
    await this.prisma.message.update({
      where: { id: messageId },
      data: { pinnedAt: null, pinnedByUserId: null },
    });
    return this.requireDto(messageId);
  }

  async listPins(userId: string, chatId: string): Promise<PinListResponse> {
    await this.assertMember(userId, chatId);
    const rows = await this.prisma.message.findMany({
      where: { chatId, pinnedAt: { not: null }, deletedAt: null },
      orderBy: { pinnedAt: 'desc' },
      take: MAX_PINNED_PER_CHAT,
    });
    return { items: rows.map(this.messages.rowToDto) };
  }

  private async assertMember(userId: string, chatId: string): Promise<void> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { leftAt: true },
    });
    if (!member || member.leftAt !== null) {
      throw new ForbiddenException({ code: 'not_a_member', message: 'You are not a member of this chat.' });
    }
  }

  /** Member check + the message exists AND belongs to `chatId` (no cross-chat pin). */
  private async assertMemberAndMessage(
    userId: string,
    chatId: string,
    messageId: string,
    opts: { rejectTombstone: boolean },
  ): Promise<void> {
    await this.assertMember(userId, chatId);
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { chatId: true, deletedAt: true },
    });
    if (!message || message.chatId !== chatId) {
      throw new NotFoundException({
        code: 'message_not_in_chat',
        message: 'Message not found in this chat.',
      });
    }
    if (opts.rejectTombstone && message.deletedAt !== null) {
      throw new ForbiddenException({
        code: 'message_deleted',
        message: 'Cannot pin a deleted message.',
      });
    }
  }

  private async requireDto(messageId: string): Promise<MessageDto> {
    const row = await this.messages.getMessageRow(messageId);
    if (!row) {
      throw new NotFoundException({ code: 'message_not_found', message: 'Message not found.' });
    }
    return this.messages.rowToDto(row);
  }
}
