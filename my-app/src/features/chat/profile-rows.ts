/**
 * Single source of truth for Profile screen v2 row structure (Figma 1:3877).
 *
 * Imported by BOTH `src/app/contact/[id]/index.tsx` (renders from these)
 * AND `src/features/chat/__tests__/profile-screen-rows.test.ts` (asserts against these),
 * making the row-set test non-tautological: if a label drifts in the screen, the
 * test catches it on the next `npm test`.
 */

/** Keys for the two sections rendered by the screen. */
export const PROFILE_SECTION_KEYS = ['options', 'destructive'] as const;
export type ProfileSectionKey = (typeof PROFILE_SECTION_KEYS)[number];

/** Option-card row labels in render order (options Section). */
export const PROFILE_OPTION_ROW_LABELS = [
  'Media, Links & Docs',
  'Chat Theme',
  'Notifications',
  'Manage Storage',
  'Privacy',
] as const;

/** Destructive-footer first-row label (always fixed). */
export const PROFILE_CLEAR_CHAT_LABEL = 'Clear Chat' as const;

/** Returns the block-row label, mirroring the screen's ternary. */
export function profileBlockLabel(isBlocked: boolean): string {
  return isBlocked ? 'Unblock' : 'Block';
}
