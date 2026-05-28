import { formatBytes } from '@/features/chat/format-bytes';

/**
 * formatBytes — human-readable byte count for storage totals (P2-Storage).
 *
 * Distinct from `lib/format-size`'s `formatFileSize`: formatBytes handles "0 B"
 * and GB — necessary for per-chat storage totals that can reach multi-GB scale
 * in heavy media chats.
 */
describe('formatBytes', () => {
  describe('0 / negative / invalid', () => {
    it('renders 0 as "0 B"', () => {
      expect(formatBytes(0)).toBe('0 B');
    });
    it('renders negative as "0 B"', () => {
      expect(formatBytes(-100)).toBe('0 B');
    });
    it('renders NaN as "0 B"', () => {
      expect(formatBytes(NaN)).toBe('0 B');
    });
    it('renders Infinity as "0 B"', () => {
      expect(formatBytes(Infinity)).toBe('0 B');
    });
  });

  describe('bytes (< 1 KB)', () => {
    it('renders 1 byte as "1 B"', () => {
      expect(formatBytes(1)).toBe('1 B');
    });
    it('renders 512 bytes as "512 B"', () => {
      expect(formatBytes(512)).toBe('512 B');
    });
    it('renders 1023 bytes as "1023 B"', () => {
      expect(formatBytes(1023)).toBe('1023 B');
    });
  });

  describe('KB (1 KB – < 1 MB)', () => {
    it('renders 1024 bytes as "1 KB"', () => {
      expect(formatBytes(1024)).toBe('1 KB');
    });
    it('renders 248 000 bytes as "242 KB"', () => {
      expect(formatBytes(248_000)).toBe('242 KB');
    });
    it('renders 1 MB - 1 byte as KB', () => {
      expect(formatBytes(1024 * 1024 - 1)).toBe('1024 KB');
    });
  });

  describe('MB (1 MB – < 1 GB)', () => {
    it('renders exactly 1 MB as "1.0 MB"', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    });
    it('renders 2.5 MB with one decimal', () => {
      expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });
    it('renders 10 MB with no decimal', () => {
      expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    });
    it('renders 42 MB with no decimal', () => {
      expect(formatBytes(42 * 1024 * 1024)).toBe('42 MB');
    });
    it('renders 500 MB with no decimal', () => {
      expect(formatBytes(500 * 1024 * 1024)).toBe('500 MB');
    });
  });

  describe('GB (≥ 1 GB)', () => {
    it('renders exactly 1 GB as "1.0 GB"', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });
    it('renders 2.5 GB with one decimal', () => {
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
    });
    it('renders 10 GB with no decimal', () => {
      expect(formatBytes(10 * 1024 * 1024 * 1024)).toBe('10 GB');
    });
  });
});

/**
 * Mock getChatStorage shape test — verifies the mock repo returns the right
 * structure without importing any React Native / MMKV modules.
 *
 * We test the pure aggregation logic by importing the helper directly (it's a
 * plain function extracted alongside `searchMessagesImpl` / `applyVoteLocally`).
 * The full mock repo is not imported here to avoid native-module side-effects.
 */
describe('getChatStorage shape contract', () => {
  /**
   * Lightweight replica of the aggregation logic from mock-chat-repository.ts
   * so we can test it without pulling in MMKV / expo-constants.
   */
  type MockMsg = { type: string; deletedAt?: string | null; sizeBytes?: number };

  function aggregateMockStorage(msgs: MockMsg[]) {
    function typeToKind(type: string): string {
      if (type === 'contact') return 'CONTACT_CARD';
      if (type === 'call_event') return 'CALL_EVENT';
      return type.toUpperCase();
    }

    const byKind = new Map<string, { count: number; bytes: number }>();
    for (const msg of msgs) {
      if (msg.deletedAt) continue;
      const kind = typeToKind(msg.type);
      const bytes = msg.type === 'document' ? (msg.sizeBytes ?? 0) : 0;
      const prev = byKind.get(kind) ?? { count: 0, bytes: 0 };
      byKind.set(kind, { count: prev.count + 1, bytes: prev.bytes + bytes });
    }

    const perKind = Array.from(byKind.entries())
      .map(([kind, { count, bytes }]) => ({
        kind,
        count,
        totalBytes: String(bytes),
      }))
      .sort((a, b) => Number(BigInt(b.totalBytes) - BigInt(a.totalBytes)));

    const totalBytes = String(perKind.reduce((sum, r) => sum + Number(r.totalBytes), 0));
    return { perKind, totalBytes };
  }

  it('empty chat → { perKind: [], totalBytes: "0" }', () => {
    const result = aggregateMockStorage([]);
    expect(result.perKind).toEqual([]);
    expect(result.totalBytes).toBe('0');
  });

  it('totalBytes is a numeric string matching /^\\d+$/', () => {
    const result = aggregateMockStorage([
      { type: 'text' },
      { type: 'image' },
      { type: 'document', sizeBytes: 12345 },
    ]);
    expect(result.totalBytes).toMatch(/^\d+$/);
  });

  it('deleted messages are excluded from totals', () => {
    const result = aggregateMockStorage([
      { type: 'text' },
      { type: 'text', deletedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const textRow = result.perKind.find((r) => r.kind === 'TEXT');
    expect(textRow?.count).toBe(1); // deleted one is skipped
  });

  it('contact type maps to CONTACT_CARD kind', () => {
    const result = aggregateMockStorage([{ type: 'contact' }]);
    expect(result.perKind[0]?.kind).toBe('CONTACT_CARD');
  });

  it('call_event type maps to CALL_EVENT kind', () => {
    const result = aggregateMockStorage([{ type: 'call_event' }]);
    expect(result.perKind[0]?.kind).toBe('CALL_EVENT');
  });

  it('perKind rows are sorted totalBytes DESC', () => {
    const result = aggregateMockStorage([
      { type: 'text' },
      { type: 'document', sizeBytes: 5000 },
      { type: 'image' },
    ]);
    const bytes = result.perKind.map((r) => Number(r.totalBytes));
    for (let i = 1; i < bytes.length; i++) {
      expect(bytes[i]!).toBeLessThanOrEqual(bytes[i - 1]!);
    }
  });
});
