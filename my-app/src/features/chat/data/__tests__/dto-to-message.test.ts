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

describe('dtoToMessage — forward / pin metadata (Tranche 2.E)', () => {
  it('carries forwardedFromMessageId through so the bubble shows the Forwarded label', () => {
    const SRC = '33333333-0000-4000-8000-000000000003';
    const dto = makeDto({ forwardedFromMessageId: SRC });
    const m = dtoToMessage(dto, COUNTERPART_ID);
    expect(m.forwardedFromMessageId).toBe(SRC);
  });

  it('defaults forward / pin fields when the server omits them (legacy / in-flight rows)', () => {
    // makeDto base has no forward/pin fields — the mapper must still yield safe defaults.
    const m = dtoToMessage(makeDto({}), COUNTERPART_ID);
    expect(m.forwardedFromMessageId).toBeNull();
    expect(m.forwardCount).toBe(0);
    expect(m.pinnedAt).toBeNull();
  });

  it('passes forwardCount + pinnedAt through when present', () => {
    const PINNED_AT = '2026-05-25T11:00:00.000Z';
    const m = dtoToMessage(makeDto({ forwardCount: 4, pinnedAt: PINNED_AT }), COUNTERPART_ID);
    expect(m.forwardCount).toBe(4);
    expect(m.pinnedAt).toBe(PINNED_AT);
  });
});

describe('dtoToMessage — DOCUMENT + VIDEO (Tranche 2.C)', () => {
  it('maps a DOCUMENT message', () => {
    const dto = makeDto({
      kind: 'DOCUMENT',
      text: null,
      mediaUrl: 'https://cdn.example.com/chat-media/abcd1234/x.pdf',
      mediaMimeType: 'application/pdf',
      documentTitle: 'Q3 report.pdf',
      documentSizeBytes: 248_000,
    });
    const m = dtoToMessage(dto, COUNTERPART_ID) as Extract<ReturnType<typeof dtoToMessage>, { type: 'document' }>;
    expect(m.type).toBe('document');
    expect(m.fileName).toBe('Q3 report.pdf');
    expect(m.sizeBytes).toBe(248_000);
    expect(m.mimeType).toBe('application/pdf');
    expect(m.mediaUrl).toBe('https://cdn.example.com/chat-media/abcd1234/x.pdf');
  });

  it('maps a VIDEO message with dims + duration', () => {
    const dto = makeDto({
      kind: 'VIDEO',
      text: null,
      mediaUrl: 'https://cdn.example.com/chat-media/abcd1234/v.mp4',
      mediaMimeType: 'video/mp4',
      videoWidth: 1080,
      videoHeight: 1920,
      videoDurationSec: 42,
    });
    const m = dtoToMessage(dto, COUNTERPART_ID) as Extract<ReturnType<typeof dtoToMessage>, { type: 'video' }>;
    expect(m.type).toBe('video');
    expect(m.width).toBe(1080);
    expect(m.height).toBe(1920);
    expect(m.durationSec).toBe(42);
  });

  it('falls back to a 16:9 box (not 0) when a VIDEO row omits dims', () => {
    const dto = makeDto({ kind: 'VIDEO', text: null, videoWidth: null, videoHeight: null });
    const m = dtoToMessage(dto, COUNTERPART_ID) as Extract<ReturnType<typeof dtoToMessage>, { type: 'video' }>;
    expect(m.width).toBe(16);
    expect(m.height).toBe(9);
  });
});

describe('dtoToMessage — LOCATION + CONTACT_CARD (Tranche 2.D)', () => {
  it('maps a LOCATION message', () => {
    const dto = makeDto({ kind: 'LOCATION', text: null, latitude: 19.076, longitude: 72.8777, locationName: 'Mumbai' });
    const m = dtoToMessage(dto, COUNTERPART_ID) as Extract<ReturnType<typeof dtoToMessage>, { type: 'location' }>;
    expect(m.type).toBe('location');
    expect(m.latitude).toBe(19.076);
    expect(m.longitude).toBe(72.8777);
    expect(m.locationName).toBe('Mumbai');
  });

  it('maps a LOCATION with no name (null)', () => {
    const dto = makeDto({ kind: 'LOCATION', text: null, latitude: 1, longitude: 2, locationName: null });
    const m = dtoToMessage(dto, COUNTERPART_ID) as Extract<ReturnType<typeof dtoToMessage>, { type: 'location' }>;
    expect(m.locationName).toBeNull();
  });

  it('maps a CONTACT_CARD message', () => {
    const dto = makeDto({ kind: 'CONTACT_CARD', text: null, contactName: 'Priya', contactPhoneE164: '+919620304050' });
    const m = dtoToMessage(dto, COUNTERPART_ID) as Extract<ReturnType<typeof dtoToMessage>, { type: 'contact' }>;
    expect(m.type).toBe('contact');
    expect(m.contactName).toBe('Priya');
    expect(m.contactPhoneE164).toBe('+919620304050');
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
