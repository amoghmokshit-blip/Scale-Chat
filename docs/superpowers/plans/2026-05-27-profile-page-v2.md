# Profile Page v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the 1-on-1 Contact Profile screen (`/contact/[id]`) to the Figma "Profile Info Page" (`1:3877`) and add four net-new capabilities (in-chat Search, Manage Storage, Chat Theme, Privacy sub-screen).

**Architecture:** In-place restyle of the existing `contact/[id]/index.tsx` (keep the FlatList-with-hero F1 fix). Phase P1 wires only already-shipped backends and ships independently. Phase P2 is four parallel vertical slices (backend + mobile), each landing with e2e + Jest coverage, mirroring this repo's back/front tranche convention.

**Tech Stack:** Expo SDK 56 / RN 0.85 / expo-router (mobile); NestJS + Fastify + Prisma 7 + Postgres (backend); `@scalechat/shared` zod; Jest (mobile) + jest-e2e against `test_e2e` schema (backend).

**Spec:** [`docs/superpowers/specs/2026-05-27-profile-page-v2-design.md`](../specs/2026-05-27-profile-page-v2-design.md) · **BRD:** [`docs/brd/1-on-1.md` §15](../../brd/1-on-1.md)

---

## Build order & dependencies

```
P1 (mobile redesign + wiring)              ← MUST land first; the P2 slices wire rows onto the P1 screen
 ├─ P2-Search   (backend + mobile)         ┐
 ├─ P2-Storage  (migration + backend + UI) │ independent of each other;
 ├─ P2-Theme    (migration + backend + UI) │ parallelizable after P1
 └─ P2-Privacy  (mobile only)              ┘
```

**Why P1 first:** every P2 slice changes `contact/[id]/index.tsx` to point its row at a real destination. Building P1 first gives them a stable screen to wire into; the agent sections below were written against the current screen, with notes — when executing, wire P2 rows onto the **P1-redesigned** screen (the row `onPress` targets are unchanged regardless).

**Shared-file coordination:**
- `my-app/src/features/chat/copy.ts` + its snapshot — touched by P1, P2-Search, P2-Theme, P2-Privacy. Re-run `npx jest -u --testPathPattern=copy` at the end of each slice; review the `.snap` diff for additions only (no deletions).
- `my-app/src/constants/theme.ts` `Brand` tokens — `profileBg`/`profileBackCircle`/`destructiveRed` are added in **P1 Task 1**. P2-Privacy must **reuse** `Brand.destructiveRed` (do not re-add). P2-Theme adds `Brand.chatThemes`.
- `contact/[id]/index.tsx` — P1 rewrites it; P2 slices each change one row's `onPress` + mount one picker/sheet. Land P2 slices sequentially through this file, or rebase carefully if parallel.

---

## Cross-cutting decisions (from the 5-agent review — 2026-05-27)

These resolve risks the review surfaced. They are binding for implementation:

1. **Search scroll-to-message — in-window only this tranche.** `FlatList` holds only the loaded page; jumping to a hit older than the window requires looped `loadOlder` + re-measure, which is fragile. Ship: scroll to hits in the loaded window (`scrollToIndex` + `onScrollToIndexFailed` fallback to bottom); for out-of-window hits, navigate to the thread (lands at bottom) — a "jump to any sequence" deep-paginate is a deferred follow-up. (Agent-2 R1.)

2. **Search filter is `text IS NOT NULL` + `contains`, NOT `kind = 'TEXT'`.** Prisma `contains` on nullable `text` already excludes non-text rows; hard-coding `kind: 'TEXT'` would wrongly exclude future caption-bearing kinds. (Agent-2 R2.)

3. **Search hit field is `senderUserId`** — but **verify the privacy interceptor** (`apps/api/src/common/interceptors/`) does not flag it on the new DTO; if it does, rename to `authorUserId` in the shared schema. Resolve during the backend task, not after. (Agent-2 R8.)

4. **"Free up space" is a confirm + stub this tranche.** SDK 56 `expo-image` has no public cache-clear API and `expo-file-system.cacheDirectory` is app-wide, not per-chat. Ship the screen + the confirm dialog + a stubbed action (`Alert` "Done"); real per-chat device-cache eviction is deferred until a named-subdirectory caching layer exists. The server never deletes media here (shared + ref-counted, Tranche 2.E K12). (Agent-3 R4.)

5. **`Message.mediaSizeBytes` is internal-only** — added to the DB + populated on send, but NOT exposed on `MessageDto` (no wire-contract change). Storage endpoint reads it via aggregate query. Pre-migration rows count but contribute 0 bytes (UI disclaimer). (Agent-3 R1/R6.)

6. **Chat Theme themes the bubbles too, not just the background.** Theming only the body bg looks broken (forest-green body + purple bubbles). Plumb the theme token's `mine`/`theirs`/text colors into `MessageBubble` within this tranche. Also wire the per-chat options sheet "Chat Wallpaper" row to the same picker (kill the dead Coming-Soon path). (Agent-4 R2/R5.)

7. **Theme non-member guard returns 404 `chat_not_found`**, matching the existing `chats.service` mutator convention (`setMute`/`clear` throw `NotFoundException`). The spec's "403 not_a_member" is relaxed to 404 here for consistency; the e2e asserts `[403,404]`. (Agent-4 R1.)

8. **Privacy block-state sync via `useFocusEffect` refetch.** The profile screen re-fetches `getProfileCard` on focus so returning from the Privacy sub-screen re-syncs `isBlocked` — no shared store, no prop-drilling. (Agent-5 R1.)

9. **Drop `bio` from the v2 hero banner** — Figma `1:3877` shows only name + phone in the banner. (Agent-1 R8.)

10. **Mute state on the profile has no cold-start server source** (the profile-card DTO has no `mutedUntil`). The Notifications tile starts "bell" and flips on user action — same accepted gap as the thread screen. Full sync is deferred (would need `GET /chats/:id` on profile open). (Agent-1 R1.)

---

## Phase P1 — Redesign + wire existing backends (mobile only)

**Verified signatures (Agent-1):** `chatRepository.startCall?(threadId, kind): Promise<CallTokenResponse>` (with `{callId, accessToken, wsUrl}`); `muteChat?(threadId, until: Date|null): Promise<{chatId, mutedUntil}>`; `clearChat?(threadId)`; `blockUser?/unblockUser?(userId): Promise<BlockStatusResponse>`. `ensureCallPermissions(kind)` at `src/lib/call-permissions.ts`. `MutePickerSheet` props `{visible, counterpartName, onClose, onPick:(until:Date|null)=>void}`. `ComingSoonSheet` props `{visible, icon?, title, body, footnote?, onClose}`. `Avatar` props `{contact, size?}`. `Brand.chatComposerBg === '#272727'` already exists. Jest = pure-logic `.test.ts` in `src/**/__tests__/`, no RN render.

### File structure (P1)

| Path | Action | Responsibility |
|---|---|---|
| `my-app/src/constants/theme.ts` | Modify | Add `Brand.profileBg`/`profileBackCircle`/`destructiveRed` |
| `my-app/src/features/chat/components/profile-action-tile.tsx` | Create | Dark action tile (icon+label, disabled guard) |
| `my-app/src/features/chat/copy.ts` | Modify | Add `ChatCopy.profile` (coming-soon + clear-chat copy) |
| `my-app/src/app/contact/[id]/index.tsx` | Modify | v2 layout (banner/avatar/tile-row/options card/destructive footer) |
| `my-app/src/features/chat/__tests__/profile-tile.test.ts` | Create | disabled-guard unit test |
| `my-app/src/features/chat/__tests__/profile-screen-rows.test.ts` | Create | row-set structural snapshot |

### Task P1.1 — Brand tokens

- [ ] Add to `Brand` in `my-app/src/constants/theme.ts` (after `chatVoiceUnplayed`):
  ```ts
  /** Contact Profile v2 (Figma 1:3877). */
  profileBg: '#09080e',
  profileBackCircle: '#d7daff',
  destructiveRed: '#ff2a2d',
  ```
- [ ] `cd my-app && npx tsc --noEmit` → clean.
- [ ] Commit: `feat(theme): profile v2 tokens (profileBg/profileBackCircle/destructiveRed)`

### Task P1.2 — `ProfileActionTile` (TDD)

- [ ] Write `my-app/src/features/chat/__tests__/profile-tile.test.ts` asserting the disabled guard: a `handlePress` that returns early when `disabled` and calls `onPress` otherwise (pure-logic, no RN render). Run → fail.
- [ ] Create `profile-action-tile.tsx` (full code in Agent-1 §Task 2): `Pressable` with `bg Brand.chatComposerBg`, radius 19, `minHeight 86`, white 24px `Feather` icon + 10px white label; `disabled` → 0.4 opacity + ignore taps; `accessibilityState={{disabled}}`.
- [ ] Run → pass. Commit: `feat(profile): ProfileActionTile + disabled-guard test`

### Task P1.3 — `ChatCopy.profile`

- [ ] Add the `profile` block to `copy.ts` (Agent-1 §Task 3): `searchTitle/Body`, `chatThemeTitle/Body`, `manageStorageTitle/Body`, `privacyTitle/Body`, `clearChatConfirmTitle/Body/Cta`. (Privacy/theme/storage copy will be superseded by their P2 slices — keep P1 coming-soon copy distinct keys.)
- [ ] `npx jest -u --testPathPattern=copy`. Commit: `feat(profile): ChatCopy.profile block`

### Task P1.4 — Rewrite `contact/[id]/index.tsx` to v2

**Preserve verbatim:** the F1 Fabric-layout comment (L150–157) + the FlatList-with-hero pattern. **Do not** revert to sibling ScrollView.

- [ ] Expand `SheetKind` → `'voiceCall'|'videoCall'|'notifications'|'search'|'chatTheme'|'manageStorage'|'privacy'|null`.
- [ ] Add local `const [isMuted, setIsMuted] = useState(false)` (no server source — decision #10).
- [ ] Add `handleMute(until)`, `startCall(kind)` (mirror `chat/[id].tsx` L124–153 but use `card.commonChatId`), `handleClearChat()` (confirm Alert → `clearChat`). Full code in Agent-1 §Task 4.
- [ ] Rebuild `Hero`: `theme.headerCard` banner (179 min-height, bottom radius 18), `Brand.profileBackCircle` back circle, name (`#EDEDED` 20 semibold) + phone (13 regular) — **no bio** (decision #9). Avatar 112 inside a 128 ring overlapping the banner (`marginTop:-64`). **Verify Android clip (Agent-1 R2)** — if clipped, switch the ring to `position:'absolute', bottom:-64` inside the banner.
- [ ] Action-tile row: 4 `ProfileActionTile` — Voice/Video (`disabled={!card.commonChatId}` → `startCall`), Notifications (`icon={isMuted?'bell-off':'bell'}`, `disabled={!card.commonChatId}` → `setSheet('notifications')`), Search (→ `setSheet('search')`, P2-Search later swaps to a `router.push('/chat/search')`).
- [ ] Rebuild `sectionsData`: **Options card** (Media Links&Docs → media route; Chat Theme → `setSheet('chatTheme')`; Notifications → `setSheet('notifications')`, disabled if no chat; Manage Storage → `setSheet('manageStorage')`; Privacy → `setSheet('privacy')`). **Destructive footer** (Clear Chat → `handleClearChat`, disabled if no chat; Block/Unblock → existing `handleToggleBlock`). No Group Permissions, no Exit&Delete, no Contact-Details/Common-Groups sections.
- [ ] Add `disabled?: boolean` to the in-file `OptionRow`; change destructive tint `'#FF5C5C'` → `Brand.destructiveRed`. Remove the now-unused `CallButton` helper + `bio`/`showEncryption` paths (encryption moves to P2-Privacy).
- [ ] Sheets at bottom: `MutePickerSheet` (notifications) + `ComingSoonSheet` for search/chatTheme/manageStorage/privacy. Root bg → `Brand.profileBg`.
- [ ] `npm test` green. Manual emulator smoke (live backend): 4 tiles, Voice Call rings, mute pip flips, Media opens gallery, Clear Chat confirms, Block flips.
- [ ] Commit: `feat(profile): v2 redesign — banner/avatar/tiles/options/footer + wire calls·mute·clear·block`

### Task P1.5 — Row-set structural test

- [ ] Create `profile-screen-rows.test.ts` (Agent-1 §Task 5): assert 2 sections, 5 options rows in order, block-label flip, and absence of `Group Permissions`/`Exit & Delete Group`. `npx jest -u`. Commit: `test(profile): v2 row-set snapshot`
- [ ] Update root `CLAUDE.md` §10 + create `docs/progress/profile-page-v2.md`.

---

## Phase P2-Search — in-chat message search

### File structure
Create: `packages/shared/src/schemas/message-search.ts`, `apps/api/test/search.e2e-spec.ts`, `my-app/src/app/chat/search.tsx`. Modify: shared `index.ts`; `messages.service.ts` (+`searchMessages`); `messages.controller.ts` (+`@Get('messages/search')` — declare BEFORE `@Get('messages')`); `chat-repository.ts`/`api-chat-repository.ts`/`mock-chat-repository.ts` (+`searchMessages`); `chat/_layout.tsx` (register modal); `contact/[id]/index.tsx` (Search tile → push); `copy.ts` (+`search`).

### Tasks (TDD; full code in Agent-2 output)
- [ ] **Shared schema** `message-search.ts`: `MessageSearchHitSchema {messageId, sequence, snippet, createdAt, senderUserId}`, `MessageSearchPageSchema = paginatedResponse(hit)`, `MessageSearchQuerySchema {q: trim min1 max100, cursor?, limit: coerce 1..50 default 20}`. Export from index; `npm run shared:build`. Commit.
- [ ] **Service** `MessagesService.searchMessages(userId, chatId, q, cursor, limit)`: `loadMemberOrThrow` → `clearedFilter = clearedAt ? {createdAt:{gt}} : {}` → `findMany({where:{chatId, deletedAt:null, text:{contains:q, mode:'insensitive'}, ...clearedFilter, ...(cursor?{sequence:{lt}}:{})}, orderBy:{sequence:'desc'}, take:limit+1})` → `buildPage` + `buildSnippet` (±20 chars). **No `kind` filter (decision #2).** Add a `// pg_trgm GIN index is the scale follow-up` comment. **Verify the privacy interceptor allows `senderUserId` (decision #3)** — rename to `authorUserId` if flagged.
- [ ] **Controller** `@Get('messages/search')` before `@Get('messages')`, `ZodValidationPipe(MessageSearchQuerySchema)`.
- [ ] **e2e** `search.e2e-spec.ts` — 5 cases (match found / tombstone excluded / cleared-before excluded / non-member 403 / empty q 400). Write RED first, then green. Commit: `feat(search): backend GET messages/search (5 e2e green)`
- [ ] **Mobile repo** `searchMessages?(chatId, q, opts?)` on interface + api (`apiClient.get` with `URLSearchParams`) + mock (filter in-memory snapshot, same snippet logic). Commit.
- [ ] **Search screen** `chat/search.tsx` modal (register in `chat/_layout.tsx`): auto-focused `TextInput`, `useDeferredValue` debounce, `FlatList` of hits (snippet + time + sender), tap → `router.back()` + pass `highlightSequence` param. In `chat/[id].tsx`, `useEffect` on `highlightSequence` → `scrollToIndex` if in window, `onScrollToIndexFailed` fallback (decision #1). Add `ChatCopy.search`. Commit.
- [ ] **Jest** `search-messages.test.ts` (mock filter + limit + excludes deleted). Wire Search tile in `contact/[id]/index.tsx` → `router.push('/chat/search', {threadId: commonChatId})`. Commit.

---

## Phase P2-Storage — manage storage

### File structure
Create: migration `add_media_size_bytes`, `packages/shared/src/schemas/chat-storage.ts`, `my-app/src/app/contact/[id]/storage.tsx`, `apps/api/test/storage.e2e-spec.ts`, `my-app/src/__tests__/storage-screen.test.ts`. Modify: `schema.prisma` (+`mediaSizeBytes BigInt?`), `messages.service.ts` (MessageRow + send create-data + forwardInto + `getChatStorage`), `messages.controller.ts` (+`@Get('storage')`), shared `messages.ts` (`SendMessageSchema` +`mediaSizeBytes?`) + `index.ts`, `chat-repository.ts`/api/mock, `api-chat-repository.ts` send-body (thread `sizeBytes` into all media branches).

### Tasks (TDD; full code in Agent-3 output)
- [ ] **Migration:** add `mediaSizeBytes BigInt?` to `Message`; `npx prisma migrate dev --name add_media_size_bytes` → SQL `ALTER TABLE "messages" ADD COLUMN "mediaSizeBytes" BIGINT;`. Commit migration file.
- [ ] **Shared:** `SendMessageSchema` += `mediaSizeBytes: z.number().int().positive().max(104_857_600).optional()`. New `chat-storage.ts`: `ChatStorageKindRowSchema {kind: MessageKindEnum, count, totalBytes: string /^\d+$/}`, `ChatStorageSummarySchema {perKind[], totalBytes}`. Export; `npm run shared:build`.
- [ ] **Backend persist on send:** add `mediaSizeBytes: bigint|null` to `MessageRow`; in `send()` create-data set `mediaSizeBytes: MEDIA_BACKED_KINDS.has(body.kind) && body.mediaSizeBytes!==undefined ? BigInt(body.mediaSizeBytes) : null`; clone in `forwardInto`. **Not added to `MessageDto` (decision #5).**
- [ ] **Storage service** `getChatStorage(userId, chatId)`: `assertMember` → `$queryRaw` `SELECT kind, COUNT(*)::bigint, SUM(COALESCE("mediaSizeBytes","documentSizeBytes",0))::bigint GROUP BY kind WHERE chatId AND deletedAt IS NULL`; BigInt→string. Controller `@Get('storage')`.
- [ ] **e2e** `storage.e2e-spec.ts` — 4 cases (non-member 403 / empty="0" / TEXT counted 0 bytes / IMAGE bytes after direct-Prisma insert). Insert media rows directly via `prisma.message.create` to bypass R2 presign (Agent-3). Commit: `feat(storage): mediaSizeBytes + GET storage (4 e2e green)`
- [ ] **Mobile:** thread `sizeBytes` into api send-body for voice/image/document/video; `getChatStorage` on interface+api+mock (map mock `type`→`kind`, `'contact'`→`'CONTACT_CARD'`). `storage.tsx` screen (sibling of `media.tsx`): per-kind rows (icon+label+count+`formatBytes`), total card with disclaimer, "Free up space" = confirm + stub (decision #4). Jest `storage-screen.test.ts` (formatBytes table + mock shape). Wire Manage Storage row → `router.push('/contact/[id]/storage', {id, chatId})`. Commit.

---

## Phase P2-Theme — per-chat chat theme

### File structure
Create: migration `add_chat_theme`, `packages/shared/src/schemas/chat-theme.ts`, `my-app/src/features/chat/components/chat-theme-picker.tsx`, `my-app/src/features/chat/__tests__/chat-theme.test.ts`. Modify: `schema.prisma` (`ChatMember.chatTheme String? @db.VarChar(32)`), shared `messages.ts` (`ChatDetailSchema` +`chatTheme`) + `index.ts`, `chats.service.ts` (+`setTheme`), `chats.controller.ts` (+`@Patch(':id/theme')`), `messages.service.ts` `getChat()` (+`chatTheme`), `chat-repository.ts`/api/mock, `theme.ts` (+`Brand.chatThemes`), `types.ts` (`Thread.chatTheme`), `chat/[id].tsx` (apply theme bg + bubble colors), `contact/[id]/index.tsx` (Chat Theme row → picker), `copy.ts`.

**Allowlist (4):** `default | midnight | forest | sunset`; token map (body/mine/theirs/mineText/theirsText) in Agent-4 output. `null` = default.

### Tasks (TDD; full code in Agent-4 output)
- [ ] **Migration + schema:** `ALTER TABLE "chat_members" ADD COLUMN "chat_theme" VARCHAR(32);`; `chatTheme String? @db.VarChar(32) @map("chat_theme")`. `prisma:generate`.
- [ ] **Shared** `chat-theme.ts`: `ChatThemeEnum = z.enum([...])`, `CHAT_THEMES`, `SetChatThemeSchema {theme: enum.nullable()}`, `SetChatThemeResponse`. Extend `ChatDetailSchema` += `chatTheme: ChatThemeEnum.nullable().default(null)`. Export; build.
- [ ] **Service** `ChatsService.setTheme(userId, chatId, body)`: `findUnique(chatId_userId)` → 404 `chat_not_found` if missing (decision #7) → `ChatThemeEnum.safeParse` defence (400 `unknown_theme`) → `update({chatTheme})` → return `{theme}`. Controller `@Patch(':id/theme')`. `getChat()` return += `chatTheme: member.chatTheme ?? null`.
- [ ] **e2e** add 5 cases to `chat.e2e-spec.ts` (persists+surfaced / unknown 400 / null reset / non-member [403,404] / other member unaffected). Commit: `feat(theme): ChatMember.chatTheme + PATCH theme (5 e2e green)`
- [ ] **Mobile:** `Brand.chatThemes` token map + `ChatThemeToken` type; `Thread.chatTheme`; `detailToThread` carries it; `setChatTheme` on interface+api(`apiClient.patch`+notify)+mock(in-memory map + patch getThread). `chat-theme-picker.tsx` swatch grid (Default + 4, mini bubble previews). Wire Chat Theme row → picker (optimistic + revert). In `chat/[id].tsx`: derive `themeToken` and apply `body` to FlatList container **and plumb `mine/theirs/text` into `MessageBubble` (decision #6)**; also wire the per-chat options-sheet "Chat Wallpaper" row to the picker. Jest `chat-theme.test.ts` (token map completeness + mock set/reset). Commit.

---

## Phase P2-Privacy — privacy sub-screen (mobile only)

### File structure
Create: `my-app/src/app/contact/[id]/privacy.tsx`, `my-app/src/features/chat/__tests__/privacy-copy.test.ts`. Modify: `copy.ts` (+`privacy`), `contact/[id]/index.tsx` (Privacy row → push + `useFocusEffect` resync + remove inline encryption sheet). **Reuse** `Brand.destructiveRed` from P1 (do not re-add).

### Tasks (TDD; full code in Agent-5 output)
- [ ] **Copy** `ChatCopy.privacy` (block/unblock labels+hints+alert title fns+bodies+failed; encryption label/hint/title/body — exact copy from current `index.tsx`; disappearing label/hint). `npx jest -u --testPathPattern=copy`.
- [ ] **Jest** `privacy-copy.test.ts`: copy keys present + non-empty; `blockAlertTitle`/`unblockAlertTitle` callable; mock `blockUser`→`{isBlocked:true}`, `unblockUser`→`{isBlocked:false}`. Write before screen.
- [ ] **Screen** `privacy.tsx` (sibling under `contact/_layout.tsx`): params `{id, contactName, isBlocked: 'true'|'false'}`; local `isBlocked` state from param; rows — Encryption (→ `ComingSoonSheet` w/ existing copy), Disappearing messages (disabled placeholder), Block/Unblock (destructive, optimistic toggle + revert, in-file `PrivacyRow`). Full code in Agent-5 §Task 5.
- [ ] **Wire** in `contact/[id]/index.tsx`: Privacy row `onPress` → `router.push('/contact/[id]/privacy', {id: card.id, contactName: card.fullName, isBlocked: String(isBlocked)})`; add `useFocusEffect(useCallback(()=>{ if(card) void chatRepository.getProfileCard?.(card.id).then(f=>f&&setIsBlocked(f.isBlocked)); },[card]))` to resync (decision #8); remove the now-dead `showEncryption` state + sheet. Commit: `feat(privacy): privacy sub-screen + focus-resync`

---

## Self-review (writing-plans)

- **Spec coverage:** P1 ↔ spec §3; P2-Search ↔ §4; P2-Storage ↔ §5; P2-Theme ↔ §6; P2-Privacy ↔ §7; repo methods (§8) appear in each slice; all three endpoints (§9) covered. ✔
- **Placeholders:** none — every code-bearing step references the agent sections' real code; the only "stub" (Free up space) is an explicit product decision (#4), not a gap.
- **Type consistency:** `searchMessages`/`getChatStorage`/`setChatTheme` names match across interface + api + mock + spec §8/§15.5. `mediaSizeBytes`, `chatTheme`, `ChatThemeEnum`, `ChatStorageSummary` consistent across migration → schema → service → mobile.
- **Gaps fixed inline:** non-member status (404, decision #7), bubble-theming scope (#6), search field/filter (#2/#3), free-up-space stub (#4) — all resolved above so executors don't rediscover them.

## Execution

Each slice = its own PR with e2e/Jest green + `CLAUDE.md` §10 + `docs/progress/profile-page-v2.md` updated (or `[skip-claudemd]`). Land **P1 first**, then the four P2 slices.
