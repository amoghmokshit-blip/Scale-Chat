# Design Spec — Profile Page v2 (Contact Profile redesign)

| | |
|---|---|
| **Date** | 2026-05-27 |
| **Owner** | Surya (founder) + Claude |
| **BRD** | [`docs/brd/1-on-1.md` §15](../../brd/1-on-1.md) |
| **Figma** | file `JYhOHnaEDgGYNxJShD9WDK`, 1-on-1 frame `1:3877` ("Profile Info Page"); group `143:762` = out of scope |
| **Status** | Approved 2026-05-27; awaiting implementation plan |

This spec is the implementation contract. The BRD is the scope of record; where they overlap, this spec is the more detailed authority.

---

## 1. Context — what exists today

The Contact Profile screen already ships:

- **Screen:** `my-app/src/app/contact/[id]/index.tsx` — a `FlatList` with a `Hero` (`ListHeaderComponent`) plus section rows (Conversation, Contact details, Groups, Premium, destructive). Reached via `chat/[id].tsx` header tap → `router.push('/contact/[id]', { id: counterpart.id })`.
- **Backend:** `GET /users/:id/profile-card` → `UserProfileCard` (`packages/shared/src/schemas/profile-card.ts`): `{ id, fullName, phoneE164, avatarUri, bio, isPremium, createdAt, commonChatId, isBlocked }`. Privacy-gated (403 `profile_not_visible` unless shared chat or saved contact). Sub-route `contact/[id]/media.tsx` renders the media gallery from `GET /chats/:chatId/media`.
- **Already-working backends to reuse:** calls (`chatRepository.startCall(chatId, kind)` → `/chat/call`), mute (`PATCH /chats/:id/mute` + `MutePickerSheet`), clear (`PATCH /chats/:id/clear`), block/unblock (`POST/DELETE /users/:id/block`), media gallery (`GET /chats/:chatId/media?kind=`).

**The redesign is in place.** No new route for the main screen; the chat-header tap target is unchanged.

### Key constraint discovered

`Message` persists **only** `documentSizeBytes`; IMAGE/VOICE/VIDEO have no size column (`schema.prisma` ~L272–295). Byte-accurate storage totals therefore require a new column (§5, P2-Storage).

---

## 2. Architecture & phasing

Approach A (foundation-first). Two phases; P2 is four independent vertical slices.

```
P1 (mobile only) ── redesign + wire existing backends ── shippable alone
P2 (4 slices, parallelizable):
   P2-Search   backend GET search   + search overlay
   P2-Storage  backend GET storage  + Manage Storage screen   (+ migration: mediaSizeBytes)
   P2-Theme    backend PATCH theme   + theme picker            (+ migration: ChatMember.chatTheme)
   P2-Privacy  no backend            + Privacy sub-screen
```

Each P2 slice follows the repo's back/front tranche convention (e.g. 2.E-back / 2.E-front): backend lands with e2e cases, mobile lands with Jest cases + mock-repo parity.

---

## 3. Phase P1 — redesign + wiring (mobile only)

### 3.1 Visual structure (Figma `1:3877`, frame 392×852)

| Region | Spec |
|---|---|
| Screen bg | `#09080e` (near-black). Add token `Brand.profileBg` (or reuse `theme.background` if close enough on-device — decide during pixel-tuning). |
| Hero banner | bg `#6672f7` ≈ existing `theme.headerCard`; **keep `theme.headerCard`** for light/dark parity. 179px tall, bottom radius 18. Back button = `#d7daff` circle (token `Brand.profileBackCircle`) with dark chevron; top-right overflow (⋯) reserved (no-op P1 or opens existing per-chat options sheet). |
| Avatar | 126px ring (`Union`) + 112px image, centered, overlapping banner bottom. Reuse `Avatar` component at size 112 inside a ring wrapper. |
| Name / phone | name `#ededed` 20px semibold; phone `#ededed` 13.4px light (`formatProfilePhone` already in the file). |
| Action tiles | Row of 4 tiles, bg `#272727` (= `Brand.chatComposerBg`), radius ≈19, ~82×93, icon (white, ~24) above label (white, ~9–11). New component `ProfileActionTile`. |
| Options list | One card, bg `#272727`, radius 20; rows = icon + label (white 13.3px) + chevron; hairline dividers. Reuse/replace the existing `OptionRow`. |
| Footer | One card, bg `#272727`; destructive rows text `#ff2a2d` (token `Brand.destructiveRed`). |

**Tokens to add** to `my-app/src/constants/theme.ts` (`Brand` namespace): `profileBg`, `profileCard` (= `#272727`, or alias `chatComposerBg`), `profileBackCircle` (`#d7daff`), `destructiveRed` (`#ff2a2d`). Reuse `headerCard`, `chatComposerBg`. **Do not add Poppins** — use the shipped font stack (theme.ts Typography note).

### 3.2 Action tiles → behavior

| Tile | Wiring (P1) |
|---|---|
| Voice Call | `startCall('VOICE')` — lift the `startCall` callback pattern from `chat/[id].tsx` (pre-grant mic via `src/lib/call-permissions.ts`, then `chatRepository.startCall(commonChatId, 'VOICE')` → `router.push('/chat/call', …)`). Requires `commonChatId`; if null, disable the tile (no chat to call into). |
| Video Call | `startCall('VIDEO')` (pre-grant mic+camera). |
| Notifications | Open existing `MutePickerSheet`; tile icon reflects muted state (`bell` ↔ `bell-off`). Needs the chat's `isMuted` — fetch via existing chat detail or thread state; pass through. |
| Search | P1: route to `ComingSoonSheet`. P2-Search replaces with the search overlay. |

### 3.3 Options list rows (P1 state)

| Row | Icon | P1 behavior |
|---|---|---|
| Media, Links & Docs | `image` | push `contact/[id]/media` (exists) when `commonChatId`, else Coming-Soon |
| Chat Theme | `droplet` | Coming-Soon (P2-Theme) |
| Notifications | `bell` | open `MutePickerSheet` |
| Manage Storage | `hard-drive` | Coming-Soon (P2-Storage) |
| Privacy | `lock` | Coming-Soon (P2-Privacy) |

`Group Permissions` is **omitted**.

### 3.4 Destructive footer (P1)

- **Clear Chat** → confirm `Alert` → `chatRepository.clearChat(commonChatId)` (exists). Disabled if no `commonChatId`.
- **Block / Unblock** → reuse the existing `handleToggleBlock` logic already in the file (optimistic, revert-on-failure).

`Exit & Delete Group` is **not** rendered.

### 3.5 Files touched (P1)

- `my-app/src/app/contact/[id]/index.tsx` — rewrite layout to the v2 structure; keep the `FlatList`-with-hero pattern (preserves the F1 Fabric-layout fix — see code comment L150–157; **do not** revert to sibling ScrollView).
- `my-app/src/features/chat/components/profile-action-tile.tsx` — **new** tile component.
- `my-app/src/constants/theme.ts` — new tokens (§3.1).
- Reuse: `Avatar`, `MutePickerSheet`, `ComingSoonSheet`, `call-permissions`, `startCall` pattern.

### 3.6 P1 testing

- Jest: a copy/snapshot test for the new screen's row set; a unit test for the "tile disabled when `commonChatId == null`" guard.
- Manual (emulator, live backend): open profile → 4 tiles render → Voice Call rings peer → Notifications toggles mute pip → Media opens gallery → Clear Chat confirms → Block flips label. Screenshot each.

---

## 4. Phase P2-Search — in-chat message search

### 4.1 Backend

- **Endpoint:** `GET /chats/:chatId/messages/search?q=<str>&cursor=<seq>&limit=<n>` (JWT-guarded).
- **Service:** member-gated (403 `not_a_member`); `q` trimmed, min length 1, max 100; case-insensitive `contains` on `Message.text`; **excludes** tombstones (`deletedAt != null`) and messages at/under the caller's `ChatMember.clearedAt` (mirror the existing `list()` clear filter); `kind = TEXT` (and caption-bearing kinds if any) only. Order DESC by `sequence`; cursor = sequence; `limit` clamped to 50.
- **Response:** `{ items: MessageSearchHit[], nextCursor: string | null }` where `MessageSearchHit = { messageId, sequence, snippet, createdAt, senderUserId }`. New shared schema `packages/shared/src/schemas/message-search.ts`.
- **No migration.** Postgres `ILIKE`/`contains`. (Note for scale: a `pg_trgm` GIN index on `text` is a later optimization, out of scope.)

### 4.2 Mobile

- Repo: `searchMessages(chatId, q, opts)` on `ChatRepository` (api + mock).
- UI: search overlay launched from the Search tile — debounced input (`useDeferredValue`), hit list (snippet + time + sender). Tap a hit → navigate to `chat/[id]` and scroll to the message (`FlatList` ref + `scrollToIndex`/sequence lookup; if not in the loaded window, page to it).
- Mock: filter the seeded thread by substring.

### 4.3 Tests

- e2e: match found; tombstone excluded; cleared-before excluded; non-member 403; empty `q` 400.
- Jest: mock `searchMessages` returns expected hits; overlay renders/empties.

---

## 5. Phase P2-Storage — manage storage

### 5.1 Migration

Add `mediaSizeBytes BigInt?` to `Message`. Populate on **send** from the `sizeBytes` the client already passes to `POST /media/upload-url` — thread it through the send DTO → create-data. Documents keep `documentSizeBytes`; aggregation reads `COALESCE(mediaSizeBytes, documentSizeBytes, 0)`. Pre-existing rows have NULL → counted, 0 bytes (documented as a known limitation in the UI: "sizes shown for media sent after this update").

### 5.2 Backend

- **Endpoint:** `GET /chats/:chatId/storage` (JWT, member-gated 403 `not_a_member`).
- **Service:** `groupBy` `kind` over non-deleted messages in the chat → `{ count, totalBytes }` per kind; plus a grand `totalBytes`.
- **Response:** `ChatStorageSummary = { perKind: Array<{ kind: MessageKind, count: number, totalBytes: string /* BigInt */ }>, totalBytes: string }`. New shared schema. BigInt serialized as string (matches the repo's sequence convention).

### 5.3 Mobile

- Repo: `getChatStorage(chatId)` (api + mock).
- UI: Manage Storage screen (new route `contact/[id]/storage.tsx` or modal) — per-kind rows (icon, "N items", human size) + total bar; "Free up space" clears the **device-local** media cache for this chat (no server delete — server media is shared). Confirm before clearing.

### 5.4 Tests

- e2e: aggregation sums correctly across kinds; member-gate 403; size from `mediaSizeBytes` after a send.
- Jest: `getChatStorage` mock → screen renders per-kind + total; "Free up space" calls the cache-clear.

---

## 6. Phase P2-Theme — per-chat chat theme

### 6.1 Migration

Add `chatTheme String?` to `ChatMember` (per-user-per-chat, so each side can theme independently — matches WhatsApp). Nullable = default theme.

### 6.2 Backend

- **Endpoint:** `PATCH /chats/:chatId/theme` body `{ theme: string | null }` (JWT, member-gated). `theme` validated against an allowlist of named themes (shared enum, e.g. `default | midnight | forest | sunset | ...`); `null` resets. Writes `ChatMember.chatTheme` for the caller's membership. Returns `{ theme: string | null }`.
- Surface the value on chat detail (`GET /chats/:chatId`) so the thread can render it on load (extend `ChatDetail` with `chatTheme`).

### 6.3 Mobile

- Repo: `setChatTheme(chatId, theme)` (api + mock).
- UI: theme picker (grid of swatches) from the Chat Theme row; optimistic apply. The chat thread background (`chat/[id].tsx`) reads `chatTheme` and maps it to a background token/gradient. Define the theme→token map in `theme.ts`.

### 6.4 Tests

- e2e: set theme persists per-user; invalid theme 400; reset to null; non-member 403; the other member's theme is unaffected.
- Jest: picker selects → `setChatTheme` called; thread bg maps theme→token.

---

## 7. Phase P2-Privacy — privacy sub-screen

No backend (composes existing). New route `contact/[id]/privacy.tsx` (or modal):

- **Block / Unblock** — reuse existing endpoints + optimistic toggle.
- **Encryption** — info row ("Secured in transit"), same copy as the current `showEncryption` sheet.
- **Disappearing messages** — placeholder row, disabled, "Coming soon" (consistent with BRD §11/§12 retention default).

Tests: Jest — rows render; Block toggles via mock; encryption info opens.

---

## 8. Repository interface additions (`my-app/src/features/chat/data/chat-repository.ts`)

```ts
searchMessages(chatId: string, q: string, opts?: { cursor?: string; limit?: number }): Promise<MessageSearchPage>;
getChatStorage(chatId: string): Promise<ChatStorageSummary>;
setChatTheme(chatId: string, theme: string | null): Promise<void>;
```

Both `api-chat-repository.ts` and `mock-chat-repository.ts` implement all three. Mock returns deterministic seeded data so `EXPO_PUBLIC_USE_MOCKS=true` dev works offline (CLAUDE.md §3).

---

## 9. API summary (new endpoints)

| Method | Path | Auth | Returns | Errors |
|---|---|---|---|---|
| GET | `/chats/:chatId/messages/search?q=&cursor=&limit=` | JWT | `{ items: MessageSearchHit[], nextCursor }` | 400 empty/too-long `q`; 403 `not_a_member` |
| GET | `/chats/:chatId/storage` | JWT | `ChatStorageSummary` | 403 `not_a_member` |
| PATCH | `/chats/:chatId/theme` | JWT | `{ theme }` | 400 `unknown_theme`; 403 `not_a_member` |

Shared schemas (new): `message-search.ts`, `chat-storage.ts`, `chat-theme.ts` under `packages/shared/src/schemas/`, re-exported from the package index; rebuild via `npm run shared:build`.

---

## 10. Out of scope

- Group profile (`143:762`), `Group Permissions` — Super Group BRD.
- Real disappearing-messages behavior, end-to-end encryption — labels/placeholders only.
- Editing your **own** profile — Settings/Profile BRD.
- Server-side media deletion from "Free up space" (device cache only; server media is shared and ref-counted per Tranche 2.E K12).
- `pg_trgm` search index (scale optimization).

---

## 11. Working-agreement reminder

Every behavior-changing commit updates root `CLAUDE.md` §10 status table + `docs/progress/<slice>.md` in the same PR, or carries `[skip-claudemd] <reason>` (my-app/CLAUDE.md §7). Suggested progress doc: `docs/progress/profile-page-v2.md`.
