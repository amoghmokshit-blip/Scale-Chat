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
    // Forward / pin metadata (Tranche 2.E). `?? null` / `?? 0` guard against
    // in-flight DTOs (socket replays, mock rows) authored before these columns.
    forwardedFromMessageId: m.forwardedFromMessageId ?? null,
    forwardCount: m.forwardCount ?? 0,
    pinnedAt: m.pinnedAt ?? null,
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
  if (m.kind === 'DOCUMENT') {
    return {
      ...base,
      type: 'document',
      mediaUrl: m.mediaUrl ?? '',
      fileName: m.documentTitle ?? 'Document',
      sizeBytes: m.documentSizeBytes ?? 0,
      mimeType: m.mediaMimeType ?? 'application/octet-stream',
    };
  }
  if (m.kind === 'VIDEO') {
    return {
      ...base,
      type: 'video',
      mediaUrl: m.mediaUrl ?? '',
      // Fallback to a 16:9 box (not 0) so a malformed/replayed row without dims
      // doesn't collapse the bubble to zero height.
      width: m.videoWidth ?? 16,
      height: m.videoHeight ?? 9,
      durationSec: m.videoDurationSec ?? 0,
    };
  }
  if (m.kind === 'LOCATION') {
    return {
      ...base,
      type: 'location',
      latitude: m.latitude ?? 0,
      longitude: m.longitude ?? 0,
      locationName: m.locationName ?? null,
    };
  }
  if (m.kind === 'CONTACT_CARD') {
    return {
      ...base,
      type: 'contact',
      contactName: m.contactName ?? '',
      contactPhoneE164: m.contactPhoneE164 ?? '',
    };
  }
  if (m.kind === 'POLL' && m.poll) {
    return {
      ...base,
      type: 'poll',
      pollMessageId: m.poll.pollMessageId,
      question: m.poll.question,
      multiSelect: m.poll.multiSelect,
      anonymous: m.poll.anonymous,
      closedAt: m.poll.closedAt,
      totalVoters: m.poll.totalVoters,
      options: m.poll.options,
    };
  }
  if (m.kind === 'CALL_EVENT') {
    const text = m.text ?? 'Call';
    return {
      ...base,
      type: 'call_event',
      text,
      callKind: text.toLowerCase().includes('video') ? 'VIDEO' : 'VOICE',
    };
  }
  return { ...base, type: 'text', text: m.text ?? '' };
}
