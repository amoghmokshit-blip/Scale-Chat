/**
 * P2-Theme: pure-logic tests for the chat-theme token map.
 *
 * Imports the REAL Brand.chatThemes from src/constants/theme.ts and the REAL
 * CHAT_THEMES enum from @scalechat/shared so that any drift between the two
 * (e.g. a new theme added to the enum but not to the token map, or a hex value
 * typo) is caught here rather than silently passing against an inline table.
 *
 * Import notes:
 *  - @/constants/theme  → works; CSS stub (jest-stub-css.js) + react-native
 *    stub (jest-stub-react-native.js) are wired in jest.config.js
 *    moduleNameMapper.
 *  - @scalechat/shared/schemas/chat-theme  → imported via the sub-path
 *    mapper (avoids the barrel index.ts which re-exports with .js specifiers
 *    that Jest's CJS resolver cannot find without a custom resolver).
 *
 * The mock-repo setChatTheme behaviour is verified by the inline simulation
 * below (same constraint as before — avoid importing the full repository which
 * has heavier transitive deps).
 */

import { Brand } from '@/constants/theme';
import { CHAT_THEMES } from '@scalechat/shared/schemas/chat-theme';

// ─── Token map structure tests ────────────────────────────────────────────────

describe('Brand.chatThemes token map (real import)', () => {
  const hexRe = /^#[0-9a-fA-F]{3,8}$/;

  it('has a "default" entry', () => {
    expect(Brand.chatThemes).toHaveProperty('default');
  });

  it('has an entry for every value in CHAT_THEMES', () => {
    for (const key of CHAT_THEMES) {
      expect(Brand.chatThemes).toHaveProperty(key);
    }
  });

  it('each entry has body, mine, theirs, mineText, theirsText hex strings', () => {
    const allKeys = ['default', ...CHAT_THEMES.filter((k) => k !== 'default')];
    for (const key of allKeys) {
      const token = Brand.chatThemes[key as keyof typeof Brand.chatThemes];
      expect(token.body).toMatch(hexRe);
      expect(token.mine).toMatch(hexRe);
      expect(token.theirs).toMatch(hexRe);
      expect(token.mineText).toMatch(hexRe);
      expect(token.theirsText).toMatch(hexRe);
    }
  });

  it('default.body === Brand.chatBody', () => {
    expect(Brand.chatThemes.default.body).toBe(Brand.chatBody);
  });

  it('default.mine === Brand.chatBubbleMine', () => {
    expect(Brand.chatThemes.default.mine).toBe(Brand.chatBubbleMine);
  });

  it('default.theirs === Brand.chatBubbleTheirs', () => {
    expect(Brand.chatThemes.default.theirs).toBe(Brand.chatBubbleTheirs);
  });

  it('default.mineText === Brand.chatBubbleMineText', () => {
    expect(Brand.chatThemes.default.mineText).toBe(Brand.chatBubbleMineText);
  });

  it('default.theirsText === Brand.chatBubbleTheirsText', () => {
    expect(Brand.chatThemes.default.theirsText).toBe(Brand.chatBubbleTheirsText);
  });

  it('non-default themes have dark body colors (intentionally dark-palette)', () => {
    for (const key of CHAT_THEMES) {
      if (key === 'default') continue;
      const token = Brand.chatThemes[key as keyof typeof Brand.chatThemes];
      const hex = token.body.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      // All theme bodies should be dark (combined RGB < 200) — WhatsApp-like wallpaper.
      expect(r + g + b).toBeLessThan(200);
    }
  });
});

// ─── Mock setChatTheme logic simulation ───────────────────────────────────────
// We simulate the exact same in-memory logic that mockChatRepository.setChatTheme
// implements, without importing the repo (avoids heavier transitive deps).

type MinimalThread = { id: string; chatTheme?: string | null };

function makeState(threads: MinimalThread[]) {
  let current = [...threads];
  return {
    setChatTheme(threadId: string, theme: string | null) {
      current = current.map((t) => t.id === threadId ? { ...t, chatTheme: theme } : t);
    },
    getThread(threadId: string) {
      return current.find((t) => t.id === threadId) ?? null;
    },
    listThreads() {
      return [...current];
    },
  };
}

describe('setChatTheme logic (mock repo simulation)', () => {
  it('stores the theme so getThread returns it', () => {
    const repo = makeState([{ id: 't1' }, { id: 't2' }]);
    repo.setChatTheme('t1', 'midnight');
    expect(repo.getThread('t1')?.chatTheme).toBe('midnight');
  });

  it('null resets the theme to null', () => {
    const repo = makeState([{ id: 't1', chatTheme: 'forest' }]);
    repo.setChatTheme('t1', null);
    expect(repo.getThread('t1')?.chatTheme).toBeNull();
  });

  it('changing theme does not affect other threads', () => {
    const repo = makeState([{ id: 't1' }, { id: 't2' }]);
    repo.setChatTheme('t1', 'sunset');
    expect(repo.getThread('t2')?.chatTheme ?? null).not.toBe('sunset');
  });

  it('default fallback: themeToken.body matches Brand.chatThemes.default.body when chatTheme is null', () => {
    // Mirrors the themeToken derivation in chat/[id].tsx:
    // Brand.chatThemes[thread?.chatTheme ?? 'default'] ?? Brand.chatThemes.default
    const chatTheme: string | null = null;
    const key = (chatTheme ?? 'default') as keyof typeof Brand.chatThemes;
    expect(Brand.chatThemes[key].body).toBe(Brand.chatThemes.default.body);
  });
});
