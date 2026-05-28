import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatKind, MessageKind, Prisma } from '@prisma/client';
import {
  ChatFilterCriteriaSchema,
  ChatThemeEnum,
  brandAsMasked,
  type ChatFilter,
  type ChatFilterCriteria,
  type ChatFilterRow,
  type ChatListItem,
  type ChatListResponse,
  type ClearChatResponse,
  type CreateChatFilterBody,
  type CreateGroupBody,
  type CreateOneOnOneBody,
  type CreateSuperGroupBody,
  type MarkReadBody,
  type MuteChatBody,
  type MuteChatResponse,
  type SetChatThemeBody,
  type SetChatThemeResponse,
} from '@scalechat/shared';

import { PrismaService } from '../../common/prisma/prisma.service';
import { buildPage, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { createHash } from 'crypto';

type ChatCursor = { lastMessageAt: string | null; id: string };

function isChatCursor(raw: unknown): raw is ChatCursor {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (r.lastMessageAt === null || typeof r.lastMessageAt === 'string') && typeof r.id === 'string';
}

function previewForMessage(m: {
  kind: MessageKind;
  text: string | null;
  durationSec: number | null;
}): string {
  switch (m.kind) {
    case 'TEXT':
      return m.text ?? '';
    case 'VOICE': {
      const secs = m.durationSec ?? 0;
      const mm = Math.floor(secs / 60);
      const ss = (secs % 60).toString().padStart(2, '0');
      return `Voice note · ${mm}:${ss}`;
    }
    case 'IMAGE':
      return 'Photo';
    case 'VIDEO':
      return '📹 Video';
    case 'DOCUMENT':
      return '📄 Document';
    case 'LOCATION':
    case 'LOCATION_LIVE':
      return '📍 Location';
    case 'CONTACT_CARD':
      return '👤 Contact';
    case 'POLL':
      return '📊 Poll';
    case 'CALL_EVENT':
      return m.text ?? 'Call';
    case 'SYSTEM':
    default:
      return '';
  }
}

/**
 * Stable 64-bit-fitting integer derived from sorted user-pair UUIDs. Used as
 * the key for `pg_advisory_xact_lock`, which Postgres takes as a `bigint`.
 *
 * We hash → take the first 8 bytes → interpret as a signed BigInt (Postgres
 * accepts signed). This is safe under collisions for the 1-on-1 idempotency
 * lock because the worst case is two unrelated user-pairs serialising on the
 * same advisory lock (negligible cost).
 */
function pairAdvisoryKey(a: string, b: string): bigint {
  const [x, y] = [a, b].sort();
  const buf = createHash('sha256').update(`${x}|${y}`).digest();
  const view = buf.subarray(0, 8);
  return view.readBigInt64BE(0);
}

@Injectable()
export class ChatsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    cursor: string | undefined,
    limit: number,
    filter: ChatFilter,
    customFilterId?: string,
  ): Promise<ChatListResponse> {
    const c = decodeCursor(cursor, isChatCursor);

    // When a custom filter is selected, load + ownership-check + parse it. The
    // preset `filter` arg is ignored. Custom criteria is folded into the same
    // chat/memberWhere construction below so pagination cursors remain valid.
    let criteria: ChatFilterCriteria | undefined;
    let postQueryUnread = filter === 'UNREAD';
    if (customFilterId) {
      const row = await this.prisma.userChatFilter.findFirst({
        where: { id: customFilterId, userId },
      });
      if (!row) {
        throw new NotFoundException({ code: 'filter_not_found', message: 'Filter not found.' });
      }
      const parsed = ChatFilterCriteriaSchema.safeParse(row.criteria);
      if (!parsed.success) {
        throw new BadRequestException({
          code: 'filter_corrupt',
          message: 'Stored filter criteria failed validation. Recreate the filter.',
        });
      }
      criteria = parsed.data;
      postQueryUnread = criteria.unread === true;
    }

    // Build chat-level (kind) predicates from preset OR custom kinds.
    let chatWhere: Prisma.ChatWhereInput | undefined;
    if (criteria?.kinds && criteria.kinds.length > 0) {
      chatWhere = { kind: { in: criteria.kinds as ChatKind[] } };
    } else if (filter === 'GROUP') {
      chatWhere = { kind: { in: [ChatKind.GROUP, ChatKind.SUPER_GROUP] } };
    } else if (filter === 'SUPER_GROUP') {
      chatWhere = { kind: ChatKind.SUPER_GROUP };
    }

    // Member-level (favourite/archive/muted) predicates. Custom criteria wins
    // when present; preset semantics applies otherwise.
    const memberWhere: Prisma.ChatMemberWhereInput = {
      userId,
      leftAt: null,
      ...(chatWhere ? { chat: chatWhere } : {}),
      ...(criteria
        ? {
            ...(criteria.favourite === true ? { favouriteAt: { not: null } } : {}),
            ...(criteria.favourite === false ? { favouriteAt: null } : {}),
            ...(criteria.archived === true ? { archivedAt: { not: null } } : {}),
            ...(criteria.archived === false ? { archivedAt: null } : {}),
            ...(criteria.mutedExcluded === true ? { mutedUntil: null } : {}),
          }
        : {
            ...(filter === 'FAVOURITES' ? { favouriteAt: { not: null } } : {}),
            ...(filter === 'UNREAD' ? { archivedAt: null } : {}),
          }),
    };

    const members = await this.prisma.chatMember.findMany({
      where: memberWhere,
      include: {
        chat: {
          include: {
            lastMessage: true,
            members: {
              where: { userId: { not: userId }, leftAt: null },
              include: { user: { select: { id: true, fullName: true, avatarUri: true } } },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ chat: { lastMessageAt: { sort: 'desc', nulls: 'last' } } }, { chatId: 'desc' }],
      take: limit + 1,
      ...(c ? { skip: 1, cursor: { id: c.id } } : {}),
    });

    const items: ChatListItem[] = members
      .map((m) => {
        const chat = m.chat;
        const last = chat.lastMessage;
        const sequence = last ? last.sequence.toString() : null;

        // Unread = lastMessage.sequence - lastReadSequence (if non-negative).
        const lastSeq = last ? last.sequence : 0n;
        const unread = lastSeq > m.lastReadSequence ? Number(lastSeq - m.lastReadSequence) : 0;

        // Server-side UNREAD filter is post-query because the unread *count* is computed
        // here (Prisma can't express `lastMessage.sequence > member.lastReadSequence`).
        if (postQueryUnread && unread === 0) return null;

        const counterpart = chat.kind === 'ONE_ON_ONE' ? chat.members[0]?.user ?? null : null;
        const title =
          chat.kind === 'ONE_ON_ONE'
            ? counterpart?.fullName ?? 'Direct chat'
            : chat.title ?? 'Group';

        const counterpartDto = counterpart
          ? brandAsMasked({
              id: counterpart.id,
              displayName: counterpart.fullName,
              avatarUri: counterpart.avatarUri,
            })
          : null;

        const item: ChatListItem = {
          id: chat.id,
          kind: chat.kind,
          title,
          avatarUri: chat.avatarUri ?? counterpart?.avatarUri ?? null,
          counterpart: counterpartDto,
          lastMessage: last
            ? {
                id: last.id,
                senderUserId: last.senderUserId,
                kind: last.kind,
                preview: previewForMessage(last),
                createdAt: last.createdAt.toISOString(),
                sequence: sequence ?? '0',
              }
            : null,
          unreadCount: unread,
          isPinned: m.pinnedAt !== null,
          isArchived: m.archivedAt !== null,
          isFavourite: m.favouriteAt !== null,
          isMuted: m.mutedUntil !== null && m.mutedUntil > new Date(),
        };

        return item;
      })
      .filter((it): it is ChatListItem => it !== null);

    return buildPage(items, limit, (last) =>
      encodeCursor<ChatCursor>({
        lastMessageAt: last.lastMessage?.createdAt ?? null,
        id: last.id,
      })
    );
  }

  async createOneOnOne(callerUserId: string, body: CreateOneOnOneBody): Promise<{ chatId: string }> {
    // Resolve target user — either by id or phone.
    const target = body.contactUserId
      ? await this.prisma.user.findUnique({ where: { id: body.contactUserId } })
      : await this.prisma.user.findUnique({ where: { phoneE164: body.phoneE164! } });

    if (!target) {
      throw new NotFoundException({
        code: 'recipient_not_found',
        message: 'No ScaleChat account is registered to that contact yet.',
      });
    }
    if (target.id === callerUserId) {
      throw new ForbiddenException({
        code: 'cannot_chat_self',
        message: 'You cannot start a chat with yourself.',
      });
    }

    const key = pairAdvisoryKey(callerUserId, target.id);

    return this.prisma.$transaction(async (tx) => {
      // Serialise on the deterministic pair key so concurrent requests can't
      // race to create two chats. The lock auto-releases at transaction end.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock($1::bigint)`, key);

      const existing = await tx.chat.findFirst({
        where: {
          kind: 'ONE_ON_ONE',
          AND: [
            { members: { some: { userId: callerUserId, leftAt: null } } },
            { members: { some: { userId: target.id, leftAt: null } } },
          ],
        },
        select: { id: true },
      });

      if (existing) return { chatId: existing.id };

      const created = await tx.chat.create({
        data: {
          kind: 'ONE_ON_ONE',
          createdByUserId: callerUserId,
          members: {
            createMany: {
              data: [
                { userId: callerUserId, role: 'MEMBER' },
                { userId: target.id, role: 'MEMBER' },
              ],
            },
          },
        },
        select: { id: true },
      });
      return { chatId: created.id };
    });
  }

  async createGroup(callerUserId: string, body: CreateGroupBody): Promise<{ chatId: string }> {
    // Ensure all proposed members exist.
    const memberCount = await this.prisma.user.count({
      where: { id: { in: body.memberUserIds } },
    });
    if (memberCount !== body.memberUserIds.length) {
      throw new NotFoundException({
        code: 'member_missing',
        message: 'One or more members no longer exist.',
      });
    }

    // Drop the caller from the members list to avoid the unique (chatId, userId) clash
    // when we add them with role ADMIN explicitly below.
    const memberIds = body.memberUserIds.filter((id) => id !== callerUserId);

    const created = await this.prisma.chat.create({
      data: {
        kind: 'GROUP',
        title: body.title,
        avatarUri: body.avatarUri ?? null,
        createdByUserId: callerUserId,
        members: {
          createMany: {
            data: [
              { userId: callerUserId, role: 'ADMIN' },
              ...memberIds.map((id) => ({ userId: id, role: 'MEMBER' as const })),
            ],
          },
        },
      },
      select: { id: true },
    });
    return { chatId: created.id };
  }

  async createSuperGroup(
    callerUserId: string,
    body: CreateSuperGroupBody
  ): Promise<{ chatId: string }> {
    // Resolve members from phones; unknown phones get rejected (must already exist on platform).
    const users = await this.prisma.user.findMany({
      where: { phoneE164: { in: body.memberPhoneE164s } },
      select: { id: true, phoneE164: true },
    });

    if (users.length !== body.memberPhoneE164s.length) {
      const found = new Set(users.map((u) => u.phoneE164));
      const missing = body.memberPhoneE164s.filter((p) => !found.has(p));
      throw new NotFoundException({
        code: 'members_not_on_platform',
        message: `Some phones are not yet on ScaleChat: ${missing.slice(0, 3).join(', ')}${
          missing.length > 3 ? ', …' : ''
        }`,
      });
    }

    const memberRows = users
      .filter((u) => u.id !== callerUserId)
      .map((u) => ({ userId: u.id, role: 'MEMBER' as const }));

    const created = await this.prisma.chat.create({
      data: {
        kind: 'SUPER_GROUP',
        title: body.title,
        description: body.description ?? null,
        avatarUri: body.avatarUri ?? null,
        createdByUserId: callerUserId,
        members: {
          createMany: {
            data: [{ userId: callerUserId, role: 'ADMIN' }, ...memberRows],
          },
        },
      },
      select: { id: true },
    });
    return { chatId: created.id };
  }

  async markRead(userId: string, chatId: string, body: MarkReadBody): Promise<void> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true, lastReadSequence: true },
    });
    if (!member) {
      throw new NotFoundException({ code: 'chat_not_found', message: 'Chat not found.' });
    }

    const incoming = BigInt(body.uptoSequence);
    // Don't move backwards — read receipts are monotonic.
    if (incoming <= member.lastReadSequence) return;

    await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { lastReadSequence: incoming },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    // For each chat the user is in, bump lastReadSequence to the chat's last message sequence.
    const memberships = await this.prisma.chatMember.findMany({
      where: { userId, leftAt: null },
      include: { chat: { include: { lastMessage: { select: { sequence: true } } } } },
    });

    await this.prisma.$transaction(
      memberships
        .filter((m) => m.chat.lastMessage && m.chat.lastMessage.sequence > m.lastReadSequence)
        .map((m) =>
          this.prisma.chatMember.update({
            where: { id: m.id },
            data: { lastReadSequence: m.chat.lastMessage!.sequence },
          })
        )
    );
  }

  async toggleFavourite(userId: string, chatId: string): Promise<{ isFavourite: boolean }> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!member) {
      throw new NotFoundException({ code: 'chat_not_found', message: 'Chat not found.' });
    }
    const next = member.favouriteAt === null ? new Date() : null;
    await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { favouriteAt: next },
    });
    return { isFavourite: next !== null };
  }

  async toggleArchive(userId: string, chatId: string): Promise<{ isArchived: boolean }> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!member) {
      throw new NotFoundException({ code: 'chat_not_found', message: 'Chat not found.' });
    }
    const next = member.archivedAt === null ? new Date() : null;
    await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { archivedAt: next },
    });
    return { isArchived: next !== null };
  }

  /**
   * Idempotent setter — bulk multi-select fan-outs hit this so spam-tapping
   * doesn't flip state. Sister to `toggleFavourite`, which the per-chat header
   * still uses. NOP when the value already matches.
   */
  async setFavourite(
    userId: string,
    chatId: string,
    value: boolean,
  ): Promise<{ isFavourite: boolean }> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!member) {
      throw new NotFoundException({ code: 'chat_not_found', message: 'Chat not found.' });
    }
    const currentlyFav = member.favouriteAt !== null;
    if (currentlyFav === value) return { isFavourite: value };
    await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { favouriteAt: value ? new Date() : null },
    });
    return { isFavourite: value };
  }

  async setArchive(
    userId: string,
    chatId: string,
    value: boolean,
  ): Promise<{ isArchived: boolean }> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!member) {
      throw new NotFoundException({ code: 'chat_not_found', message: 'Chat not found.' });
    }
    const currentlyArchived = member.archivedAt !== null;
    if (currentlyArchived === value) return { isArchived: value };
    await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { archivedAt: value ? new Date() : null },
    });
    return { isArchived: value };
  }

  /**
   * Mute notifications for a chat. The client picks the preset (8h, 1 week,
   * always) by passing `until = now + preset` or `null` to unmute. The push
   * fanout worker (Phase E) reads `ChatMember.mutedUntil` and skips delivery
   * to muted memberships.
   */
  async setMute(
    userId: string,
    chatId: string,
    body: MuteChatBody,
  ): Promise<MuteChatResponse> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!member) {
      throw new NotFoundException({ code: 'chat_not_found', message: 'Chat not found.' });
    }
    const until = body.until ? new Date(body.until) : null;
    await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { mutedUntil: until },
    });
    return {
      chatId,
      mutedUntil: until ? until.toISOString() : null,
    };
  }

  /**
   * Per-user "Clear chat". Sets `clearedAt = now`; subsequent message-list
   * reads filter to `createdAt > clearedAt` (handled in MessagesService.list).
   * Counterpart's history is untouched — matches WhatsApp.
   *
   * Idempotent — re-calling resets the cutoff forward.
   */
  async clearChat(userId: string, chatId: string): Promise<ClearChatResponse> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!member) {
      throw new NotFoundException({ code: 'chat_not_found', message: 'Chat not found.' });
    }
    const now = new Date();
    await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { clearedAt: now },
    });
    return { chatId, clearedAt: now.toISOString() };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // User-defined custom filters (Contact Page "Add" chip)
  // ───────────────────────────────────────────────────────────────────────────

  async listFilters(userId: string): Promise<{ items: ChatFilterRow[] }> {
    const rows = await this.prisma.userChatFilter.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    const items: ChatFilterRow[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      criteria: ChatFilterCriteriaSchema.parse(r.criteria),
      createdAt: r.createdAt.toISOString(),
    }));
    return { items };
  }

  async createFilter(userId: string, body: CreateChatFilterBody): Promise<ChatFilterRow> {
    const row = await this.prisma.userChatFilter.create({
      data: {
        userId,
        name: body.name,
        criteria: body.criteria as Prisma.InputJsonValue,
      },
    });
    return {
      id: row.id,
      name: row.name,
      criteria: ChatFilterCriteriaSchema.parse(row.criteria),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async deleteFilter(userId: string, filterId: string): Promise<void> {
    const result = await this.prisma.userChatFilter.deleteMany({
      where: { id: filterId, userId },
    });
    if (result.count === 0) {
      throw new NotFoundException({ code: 'filter_not_found', message: 'Filter not found.' });
    }
  }

  /**
   * Set (or clear) the per-user per-chat theme override.
   *
   * Mirrors the setMute/clearChat pattern: findUnique → 404 if missing → update.
   * A defence-in-depth parse of non-null theme values guards against any future
   * gap between the controller's ZodValidationPipe and this layer.
   */
  async setTheme(
    userId: string,
    chatId: string,
    body: SetChatThemeBody,
  ): Promise<SetChatThemeResponse> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!member) {
      throw new NotFoundException({ code: 'chat_not_found', message: 'Chat not found.' });
    }
    if (body.theme !== null) {
      const parsed = ChatThemeEnum.safeParse(body.theme);
      if (!parsed.success) {
        throw new BadRequestException({ code: 'unknown_theme', message: `Unknown theme: ${body.theme}` });
      }
    }
    await this.prisma.chatMember.update({
      where: { id: member.id },
      data: { chatTheme: body.theme },
    });
    return { theme: body.theme };
  }
}
