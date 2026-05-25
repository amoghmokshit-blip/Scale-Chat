import type { MessageDto } from '@scalechat/shared';

import { dtoToMessage } from '@/features/chat/data/dto-to-message';
import type { ImageMessage, TextMessage, VoiceMessage } from '@/features/chat/types';

/**
 * dtoToMessage tests — the boundary where the wire-format `MessageDto` from
 * `packages/shared` becomes the mobile domain `Message`.
 *
 * Critical behaviours under test:
 *   • TEXT / VOICE / IMAGE branch into the right discriminated-union member
 *   • senderId resolves to 'me' for own messages and to the counterpart id otherwise
 *   • sequence string → number conversion (BigInt-safe range is implicit here;
 *     the cache cap is fine with Number for now, but flag if tests exceed
 *     Number.MAX_SAFE_INTEGER)
 *   • tombstone (`deletedAt !== null`) carries the deletedAt through so the
 *     bubble can render the "This message was deleted" stub
 *   • replyToMessageId pass-through
 *   • Default mediaUrl fallbacks when the server omits them (e.g. legacy rows
 *     in the DB before media columns were populated)
 */

const COUNTERPART_ID = 'b2b2b2b2-0000-4000-8000-000000000002';
const MY_USER_ID = 'a1a1a1a1-0000-4000-8000-000000000001';
const CHAT_ID = 'cccccccc-0000-4000-8000-0000000000aa';

function makeDto(overrides: Partial<MessageDto>): MessageDto {
  return {
    id: '11111111-0000-4000-8000-000000000001',
    chatId: CHAT_ID,
    senderUserId: COUNTERPART_ID,
    clientMessageId: 'cli-001',
    sequence: '1',
    kind: 'TEXT',
    text: 'hello',
    mediaObjectKey: null,
    mediaUrl: null,
    imageWidth: null,
    imageHeight: null,
    durationSec: null,
    waveform: null,
    replyToMessageId: null,
    createdAt: '2026-05-25T10:00:00.000Z',
    deletedAt: null,
    reactions: [],
    ...overrides,
  };
}

describe('dtoToMessage — TEXT', () => {
  it('maps a counterpart TEXT message to type: text + senderId = counterpart', () => {
    const dto = makeDto({ kind: 'TEXT', text: 'Hi there', senderUserId: COUNTERPART_ID });
    const m = dtoToMessage(dto, COUNTERPART_ID) as TextMessage;
    expect(m.type).toBe('text');
    expect(m.text).toBe('Hi there');
    expect(m.senderId).toBe(COUNTERPART_ID);
    expect(m.threadId).toBe(CHAT_ID);
    expect(m.sequence).toBe(1);
    expect(m.status).toBe('delivered');
  });

  it("maps a mine TEXT message to senderId: 'me'", () => {
    const dto = makeDto({ senderUserId: MY_USER_ID, text: 'from me' });
    const m = dtoToMessage(dto, COUNTERPART_ID) as TextMessage;
    expect(m.senderId).toBe('me');
    expect(m.text).toBe('from me');
  });

  it('treats null text as empty string', () => {
    const dto = makeDto({ text: null });
    const m = dtoToMessage(dto, COUNTERPART_ID) as TextMessage;
    expect(m.text).toBe('');
  });
});

describe('dtoToMessage — VOICE', () => {
  it('maps a VOICE message with durationSec + waveform + mediaUrl', () => {
    const dto = makeDto({
      kind: 'VOICE',
      text: null,
      durationSec: 12,
      waveform: [0.1, 0.5, 1.0, 0.2],
      mediaObjectKey: 'chat-media/abcd1234/voice.m4a',
      mediaUrl: 'https://cdn.example.com/chat-media/abcd1234/voice.m4a',
    });
    const m = dtoToMessage(dto, COUNTERPART_ID) as VoiceMessage;
    expect(m.type).toBe('voice');
    expect(m.durationSec).toBe(12);
    expect(m.waveform).toEqual([0.1, 0.5, 1.0, 0.2]);
    expect(m.mediaUrl).toBe('https://cdn.example.com/chat-media/abcd1234/voice.m4a');
  });

  it('defaults missing voice fields to 0 / [] / undefined', () => {
    const dto = makeDto({ kind: 'VOICE', text: null, durationSec: null, waveform: null });
    const m = dtoToMessage(dto, COUNTERPART_ID) as VoiceMessage;
    expect(m.durationSec).toBe(0);
    expect(m.waveform).toEqual([]);
    expect(m.mediaUrl).toBeUndefined();
  });
});

describe('dtoToMessage — IMAGE', () => {
  it('maps an IMAGE message with width / height / mediaUrl', () => {
    const dto = makeDto({
      kind: 'IMAGE',
      text: null,
      imageWidth: 1080,
      imageHeight: 1920,
      mediaObjectKey: 'chat-media/abcd1234/uuid.jpg',
      mediaUrl: 'https://cdn.example.com/chat-media/abcd1234/uuid.jpg',
    });
    const m = dtoToMessage(dto, COUNTERPART_ID) as ImageMessage;
    expect(m.type).toBe('image');
    expect(m.width).toBe(1080);
    expect(m.height).toBe(1920);
    expect(m.mediaUrl).toBe('https://cdn.example.com/chat-media/abcd1234/uuid.jpg');
  });

  it('falls back to "" mediaUrl + 0 dims when the server omits them', () => {
    const dto = makeDto({ kind: 'IMAGE', text: null, mediaUrl: null, imageWidth: null, imageHeight: null });
    const m = dtoToMessage(dto, COUNTERPART_ID) as ImageMessage;
    expect(m.mediaUrl).toBe('');
    expect(m.width).toBe(0);
    expect(m.height).toBe(0);
  });
});

describe('dtoToMessage — tombstone + reply', () => {
  it('carries deletedAt through so the bubble can render the tombstone', () => {
    const dto = makeDto({
      deletedAt: '2026-05-25T10:05:00.000Z',
      text: null,
    });
    const m = dtoToMessage(dto, COUNTERPART_ID);
    expect(m.deletedAt).toBe('2026-05-25T10:05:00.000Z');
  });

  it('passes replyToMessageId through', () => {
    const REPLY_ID = '22222222-0000-4000-8000-000000000002';
    const dto = makeDto({ replyToMessageId: REPLY_ID });
    const m = dtoToMessage(dto, COUNTERPART_ID);
    expect(m.replyToMessageId).toBe(REPLY_ID);
  });

  it('preserves clientMessageId on durable rows for cache reconciliation', () => {
    const dto = makeDto({ clientMessageId: 'cli-abc-123' });
    const m = dtoToMessage(dto, COUNTERPART_ID);
    expect(m.clientMessageId).toBe('cli-abc-123');
  });
});

describe('dtoToMessage — senderId resolution', () => {
  it("returns 'me' when senderUserId !== counterpartId regardless of which 'me' actually is", () => {
    // The repo resolves any non-counterpart sender to 'me'. This is a deliberate
    // simplification: in 1-on-1 chats there are only two participants, so the
    // chat detail's counterpart resolves the other one by elimination.
    const dto = makeDto({ senderUserId: '99999999-0000-4000-8000-000000000099' });
    const m = dtoToMessage(dto, COUNTERPART_ID);
    expect(m.senderId).toBe('me');
  });
});
