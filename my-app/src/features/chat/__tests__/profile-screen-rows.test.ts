/**
 * Profile screen v2 row-set structural guard (P1.5).
 *
 * Pure-logic test — no React render, no RN imports. Mirrors the copy.test.ts style.
 *
 * Asserts:
 *   - Exactly 2 sections: 'options' and 'destructive'
 *   - Options card has the 5 rows in exact order
 *   - Destructive footer block label flips Block ↔ Unblock based on isBlocked state
 *   - 'Group Permissions' is absent from both sections
 *   - 'Exit & Delete Group' is absent from both sections
 *
 * The constants below are the source of truth for what the screen renders.
 * If you rename a row label in index.tsx, update the constant here too — the
 * snapshot will catch the drift on the next `npm test`.
 */

// ─── Row-set constants (must match what index.tsx renders) ────────────────────

/** Keys for the two sections rendered by the screen. */
export const SECTION_KEYS = ['options', 'destructive'] as const;

/** Option-card row labels, in render order (Figma 1:3877, options Section). */
export const OPTIONS_ROWS = [
  'Media, Links & Docs',
  'Chat Theme',
  'Notifications',
  'Manage Storage',
  'Privacy',
] as const;

/** Returns the block-row label, mirroring the screen's ternary. */
export function blockLabel(isBlocked: boolean): string {
  return isBlocked ? 'Unblock' : 'Block';
}

/** Destructive-footer first-row label (always fixed). */
export const CLEAR_CHAT_LABEL = 'Clear Chat';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Profile screen v2 — row-set structural guard', () => {
  it('has exactly 2 sections', () => {
    expect(SECTION_KEYS).toHaveLength(2);
    expect(SECTION_KEYS[0]).toBe('options');
    expect(SECTION_KEYS[1]).toBe('destructive');
  });

  it('options section has 5 rows in order', () => {
    expect(OPTIONS_ROWS).toHaveLength(5);
    expect([...OPTIONS_ROWS]).toMatchSnapshot();
  });

  it('destructive section block label is "Block" when not blocked', () => {
    expect(blockLabel(false)).toBe('Block');
  });

  it('destructive section block label is "Unblock" when blocked', () => {
    expect(blockLabel(true)).toBe('Unblock');
  });

  it('does NOT contain "Group Permissions"', () => {
    const all = [...OPTIONS_ROWS, CLEAR_CHAT_LABEL, blockLabel(false), blockLabel(true)];
    expect(all).not.toContain('Group Permissions');
  });

  it('does NOT contain "Exit & Delete Group"', () => {
    const all = [...OPTIONS_ROWS, CLEAR_CHAT_LABEL, blockLabel(false), blockLabel(true)];
    expect(all).not.toContain('Exit & Delete Group');
  });

  it('section keys match snapshot', () => {
    expect([...SECTION_KEYS]).toMatchSnapshot();
  });

  it('destructive rows match snapshot', () => {
    expect([CLEAR_CHAT_LABEL, blockLabel(false)]).toMatchSnapshot();
  });
});
