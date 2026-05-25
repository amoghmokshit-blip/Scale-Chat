import { createHash } from 'node:crypto';

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SERVER_ONLY_KINDS, type ForwardResponse, type ForwardSkipReason } from '@scalechat/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { BlocksService } from '../blocks/blocks.service';
import { MessagesService } from '../messages/messages.service';

/**
 * Forward a message into one or more other 1-on-1 chats (Tranche 2.E).
 *
 * Per-target partial success: a target the forwarder isn't a member of, or
 * where either party blocked the other, is recorded in `skipped` (not a 4xx);
 * delivered targets still land. The source message's `forwardCount` is bumped
 * by the number of NEWLY-created copies only (idempotent re-forwards don't
 * double-count). Forwarding is blocked for tombstones + server-only kinds.
 */
@Injectable()
export class ForwardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly messages: MessagesService,
  ) {}

  async forward(
    forwarderUserId: string,
    sourceMessageId: string,
    targetChatIds: string[],
  ): Promise<ForwardResponse> {
    const source = await this.messages.getMessageRow(sourceMessageId);
    if (!source) {
      throw new NotFoundException({ code: 'message_not_found', message: 'Message not found.' });
    }
    if (source.deletedAt !== null || SERVER_ONLY_KINDS.has(source.kind)) {
      throw new ForbiddenException({
        code: 'source_not_forwardable',
        message: 'This message cannot be forwarded.',
      });
    }
    if (!(await this.isMember(forwarderUserId, source.chatId))) {
      throw new ForbiddenException({
        code: 'not_a_member',
        message: 'You are not a member of the source chat.',
      });
    }

    const items: ForwardResponse['items'] = [];
    const skipped: { chatId: string; reason: ForwardSkipReason }[] = [];
    let createdCount = 0;

    // Sequential (not Promise.all) keeps per-chat advisory-lock contention sane.
    for (const targetChatId of Array.from(new Set(targetChatIds))) {
      if (!(await this.isMember(forwarderUserId, targetChatId))) {
        skipped.push({ chatId: targetChatId, reason: 'not_a_member' });
        continue;
      }
      const counterpartId = await this.counterpartOf(targetChatId, forwarderUserId);
      if (counterpartId && (await this.blocks.isBlockedEitherWay(forwarderUserId, counterpartId))) {
        skipped.push({ chatId: targetChatId, reason: 'peer_blocked' });
        continue;
      }
      const clientMessageId = forwardClientMessageId(sourceMessageId, forwarderUserId, targetChatId);
      const { message, created } = await this.messages.forwardInto(
        forwarderUserId,
        targetChatId,
        source,
        clientMessageId,
      );
      items.push(message);
      if (created) createdCount += 1;
    }

    if (createdCount > 0) {
      await this.prisma.message.update({
        where: { id: sourceMessageId },
        data: { forwardCount: { increment: createdCount } },
      });
    }

    return { items, skipped };
  }

  private async isMember(userId: string, chatId: string): Promise<boolean> {
    const m = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { leftAt: true },
    });
    return m != null && m.leftAt === null;
  }

  private async counterpartOf(chatId: string, userId: string): Promise<string | null> {
    const other = await this.prisma.chatMember.findFirst({
      where: { chatId, userId: { not: userId }, leftAt: null },
      select: { userId: true },
    });
    return other?.userId ?? null;
  }
}

/**
 * Deterministic idempotency key for a forward. The source/forwarder/target
 * triple is three UUIDs (110+ chars) — too long for `clientMessageId`
 * (VarChar(64)) — so we hash it. `'fwd_'` (4) + 56 hex chars = 60 ≤ 64.
 */
function forwardClientMessageId(sourceId: string, forwarderId: string, targetChatId: string): string {
  const hash = createHash('sha256').update(`${sourceId}:${forwarderId}:${targetChatId}`).digest('hex');
  return `fwd_${hash.slice(0, 56)}`;
}
