import type { MessageDto } from '@scalechat/shared';

import type { Message, MessageStatus } from '../types';

/**
 * Pure DTO → domain conversion.
 *
 * Extracted from `api-chat-repository.ts` so it can be unit-tested without
 * pulling in MMKV, socket.io, or expo-constants. Re-exported from the repo
 * for backwards compatibility.
 *
 * `senderId` collapses to `'me'` for any non-counterpart sender — safe in
 * 1-on-1 chats where there are exactly two participants. When group chats
 * land this must change to compare against the actual signed-in user id.
 */
export function dtoToMessage(m: MessageDto, counterpartId: string): Message {
  const base = {
    id: m.id,
    threadId: m.chatId,
    senderId: m.senderUserId === counterpartId ? counterpartId : 'me',
    sequence: Number(m.sequence),
    createdAt: m.createdAt,
    status: 'delivered' as MessageStatus,
    clientMessageId: m.clientMessageId,
    replyToMessageId: m.replyToMessageId,
    deletedAt: m.deletedAt,
    // Reactions ride on every MessageDto (defaulted to `[]` server-side per
    // shared zod schema). Carry through so the bubble can render pills.
    reactions: m.reactions ?? [],
  };
  if (m.kind === 'VOICE') {
    return {
      ...base,
      type: 'voice',
      durationSec: m.durationSec ?? 0,
      waveform: m.waveform ?? [],
      mediaUrl: m.mediaUrl ?? undefined,
    };
  }
  if (m.kind === 'IMAGE') {
    return {
      ...base,
      type: 'image',
      mediaUrl: m.mediaUrl ?? '',
      width: m.imageWidth ?? 0,
      height: m.imageHeight ?? 0,
    };
  }
  return { ...base, type: 'text', text: m.text ?? '' };
}
