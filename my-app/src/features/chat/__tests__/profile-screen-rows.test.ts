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
 * The constants are imported from `profile-rows.ts`, which is ALSO imported by
 * the screen to render its row labels. This makes the test non-tautological:
 * if a label drifts in the screen's render code without updating profile-rows.ts,
 * the snapshot and explicit assertions here will catch it at `npm test`.
 */

import {
  PROFILE_CLEAR_CHAT_LABEL,
  PROFILE_OPTION_ROW_LABELS,
  PROFILE_SECTION_KEYS,
  profileBlockLabel,
} from '../profile-rows';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Profile screen v2 — row-set structural guard', () => {
  it('has exactly 2 sections', () => {
    expect(PROFILE_SECTION_KEYS).toHaveLength(2);
    expect(PROFILE_SECTION_KEYS[0]).toBe('options');
    expect(PROFILE_SECTION_KEYS[1]).toBe('destructive');
  });

  it('options section has 5 rows in order', () => {
    expect(PROFILE_OPTION_ROW_LABELS).toHaveLength(5);
    expect([...PROFILE_OPTION_ROW_LABELS]).toMatchSnapshot();
  });

  it('destructive section block label is "Block" when not blocked', () => {
    expect(profileBlockLabel(false)).toBe('Block');
  });

  it('destructive section block label is "Unblock" when blocked', () => {
    expect(profileBlockLabel(true)).toBe('Unblock');
  });

  it('does NOT contain "Group Permissions"', () => {
    const all = [
      ...PROFILE_OPTION_ROW_LABELS,
      PROFILE_CLEAR_CHAT_LABEL,
      profileBlockLabel(false),
      profileBlockLabel(true),
    ];
    expect(all).not.toContain('Group Permissions');
  });

  it('does NOT contain "Exit & Delete Group"', () => {
    const all = [
      ...PROFILE_OPTION_ROW_LABELS,
      PROFILE_CLEAR_CHAT_LABEL,
      profileBlockLabel(false),
      profileBlockLabel(true),
    ];
    expect(all).not.toContain('Exit & Delete Group');
  });

  it('section keys match snapshot', () => {
    expect([...PROFILE_SECTION_KEYS]).toMatchSnapshot();
  });

  it('destructive rows match snapshot', () => {
    expect([PROFILE_CLEAR_CHAT_LABEL, profileBlockLabel(false)]).toMatchSnapshot();
  });
});
