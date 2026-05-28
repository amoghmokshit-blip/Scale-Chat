# Progress — Profile Page v2 (Contact Profile redesign)

> Slice tracker for the Profile Page v2 work. BRD: [`docs/brd/1-on-1.md` §15](../brd/1-on-1.md). Spec: [`docs/superpowers/specs/2026-05-27-profile-page-v2-design.md`](../superpowers/specs/2026-05-27-profile-page-v2-design.md). Plan: [`docs/superpowers/plans/2026-05-27-profile-page-v2.md`](../superpowers/plans/2026-05-27-profile-page-v2.md).

## Status

| Phase | State | Notes |
|---|---|---|
| **P1 — redesign + wire existing** | ✅ **Landed 2026-05-27** | Mobile-only. Branch `feat/profile-page-v2`. |
| **P2-Search (in-chat message search)** | ✅ **Landed 2026-05-27** | `GET /chats/:id/messages/search` (6 e2e) + search overlay + scroll-to-hit |
| **P2-Storage (manage storage)** | ✅ **Landed 2026-05-27** | Migration `mediaSizeBytes` + `GET /chats/:id/storage` (4 e2e) + Manage Storage screen (free-up-space = confirm+stub) |
| **P2-Theme (per-chat theme)** | ✅ **Landed 2026-05-27** | Migration `ChatMember.chatTheme` + `PATCH /chats/:id/theme` (5 e2e) + picker; themes thread bg **and** bubbles |
| **P2-Privacy (privacy sub-screen)** | ✅ **Landed 2026-05-27** | Mobile-only; Block/Encryption/Disappearing-placeholder + focus-resync of block state |

**Full-suite verification (2026-05-27):** backend `npm run api:test:e2e` → **68 passed** / 6 pre-existing todo (7 suites); mobile `npm test` → **160 passed** / 2 skipped (14 suites). 2 dev-DB migrations applied + `prisma migrate status` in sync. Each slice landed via implementer → spec review → quality review → fix round.

### Ultrareview fixes (2026-05-27, after PR #5 opened)

A cloud multi-agent review (`/ultrareview`) found 6 valid issues the per-slice reviews missed (notably two RN-render bugs the pure-logic Jest harness can't catch). All fixed + pushed:

| Bug | Fix |
|---|---|
| **bug_003** (Android crash) | `SearchHitRow` nested `<View>` in `<Text>` → changed outer to `Pressable`. **Emulator-verified**: search results render on Android, no crash. |
| **bug_002** (theme not live on API) | `apiChatRepository.setChatTheme` now calls `notify()` (every other mutator did) so the thread re-derives the theme without a manual refresh. |
| **bug_009** (search re-scroll) | scroll-to-hit effect re-fired on every message-list change; added a `handledHighlightRef` so it scrolls exactly once per highlight request. |
| **bug_016** (search over-match) | `searchMessages` now escapes LIKE metachars (`\`,`%`,`_`) before `contains` (`buildSnippet` keeps the raw `q`); +1 e2e case (`user_name` ≠ `userXname`). |
| **bug_001** (media fallback) | Media row no-chat fallback opened the "Search coming soon" sheet → added a `'media'` `SheetKind` + copy. |
| **bug_004** (nit: picker seed) | profile theme picker checkmark now seeded from `getThread(commonChatId).chatTheme`. |

Post-fix full suites: backend **69 e2e**, mobile **160 Jest** green.

### Known minor debt
- Mobile test harness gained a `react-native` → minimal stub + CSS stub in `jest.config.js` so pure-logic tests can import `theme.ts` (which imports `@/global.css` + `Platform`). Consistent with the project's no-RN-render test philosophy; a future component-rendering test would need the `jest-expo` preset instead.
- "Free up space" (Storage) is a confirm + stub — real per-chat device-cache eviction is deferred (SDK 56 has no per-chat cache-clear API; server media is shared/ref-counted).
- In-chat search scroll-to-hit handles in-window messages only; jumping to a hit older than the loaded page is deferred (lands at the thread without scroll).
- Privacy mock-repo Jest cases are `describe.skip` (MMKV-under-Jest limitation, same as other repo suites); copy assertions are live.

## P1 — what landed (2026-05-27)

Redesigned `my-app/src/app/contact/[id]/index.tsx` in place to the Figma "Profile Info Page" frame (`1:3877`). **Strictly 1-on-1**; group variant (`143:762`) deferred to Super Group BRD.

**Files:**
- `src/constants/theme.ts` — new `Brand` tokens `profileBg` (`#09080e`), `profileBackCircle` (`#d7daff`), `destructiveRed` (`#ff2a2d`).
- `src/features/chat/components/profile-action-tile.tsx` — **new** dark action tile (icon + label, disabled guard, `accessibilityState`).
- `src/features/chat/profile-rows.ts` — **new** single-source-of-truth row constants (`PROFILE_SECTION_KEYS`, `PROFILE_OPTION_ROW_LABELS`, clear-chat + block labels), imported by both the screen and its test so the structural test guards real drift.
- `src/features/chat/copy.ts` — `ChatCopy.profile` (coming-soon + clear-chat copy).
- `src/app/contact/[id]/index.tsx` — v2 layout: banner + ringed avatar (overlap via `marginTop:-64`; fallback to `absolute` noted if Android Fabric clips), 4 action tiles, options card (5 rows), destructive footer (Clear Chat + Block/Unblock). **F1 FlatList-with-hero pattern preserved.** Removed: `CallButton`, bio, Contact-details/Common-groups/Premium sections, Report row, `showEncryption`, `useAuth`.
- Tests: `__tests__/profile-tile.test.ts` (disabled guard) + `__tests__/profile-screen-rows.test.ts` (row-set structural guard).

**Wired (all to already-shipped backends):**
- Voice/Video tiles → live `startCall('VOICE'|'VIDEO')` → `/chat/call` (replaces the old Coming-Soon).
- Notifications (tile + row) → `MutePickerSheet` → `PATCH /chats/:id/mute`; tile icon reflects `isMuted`.
- Media, Links & Docs → existing media gallery sub-route.
- Clear Chat → `PATCH /chats/:id/clear` (confirm Alert). Block/Unblock → existing endpoints (optimistic, revert-on-failure).
- Chat Theme / Manage Storage / Privacy / Search rows → `ComingSoonSheet` until their P2 slice lands.

**Known P1 gaps (intentional, per 5-agent review):**
- Notifications mute state starts unmuted on cold open (profile-card DTO has no `mutedUntil`; flips on user action) — same accepted gap as the thread screen.
- Tiles requiring a chat (`commonChatId`) are disabled when no 1-on-1 chat exists yet.

**Tests:** 103/103 Jest green (10 suites). `tsc --noEmit` shows only pre-existing repo-wide jest-types + RN/React JSX-interop errors (not introduced here).

**Commits (branch `feat/profile-page-v2`):** docs `1251c88`; tokens `7210670`; tile `4b31def`; copy `51c53c3`; screen `3939541`; row test `f923f23`; review polish `71f66a4`.

## P2 — next

Each slice is a backend (e2e) + mobile (Jest + mock parity) vertical slice per the plan. Land after P1. P2-Privacy is mobile-only; P2-Storage and P2-Theme need migrations. See the plan's "Cross-cutting decisions" for the binding resolutions (search in-window scroll, free-up-space stub, theme bubbles, 404 non-member, focus-resync).
