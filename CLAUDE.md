# ScaleChat — Monorepo Root

> See [`my-app/CLAUDE.md`](my-app/CLAUDE.md) for the full product / architecture brief. This file is just the map.

## Layout

```
.
├── my-app/                 # Expo mobile app (current dir for frontend work)
├── apps/
│   └── api/                # NestJS backend (Fastify + Prisma + Redis)
├── packages/
│   └── shared/             # zod schemas, branded types, phone helpers
├── docs/                   # BRDs, architecture notes
└── Scalechat Pdf (2).pdf   # canonical product pitch
```

## Common commands

From the repo root:

```bash
# Install everything (npm workspaces)
npm install

# Mobile
cd my-app && npm run start

# API (dev)
npm run api:dev

# API (build + start prod-style)
npm run api:build && npm run api:start

# Prisma
npm --workspace=apps/api run prisma:generate
npm --workspace=apps/api run prisma:migrate

# Shared package (rebuild after editing zod schemas)
npm run shared:build

# One-shot dev DB bootstrap (start docker + apply pending migrations + regen client + rebuild shared)
# Run this once after pulling a branch that touches schema.prisma OR packages/shared.
npm run db:setup
npm run db:setup:dry           # walk through every step without executing it
# Flags: --no-docker (skip docker start), --skip-shared (skip shared:build)
```

## Where backend work lives

`apps/api/` — read its [`README.md`](apps/api/README.md) before changing anything in `apps/api/src/common/` (privacy interceptor, refresh-rotation, JWT). Those are load-bearing for chat once it ships.

## Working principles (coding discipline)

> Behavioral guidelines to reduce common mistakes. These bias toward caution over speed — for trivial tasks, use judgment.

**1. Think before coding** — Don't assume. Don't hide confusion. Surface tradeoffs.
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what's confusing, and ask.

**2. Simplicity first** — Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked; no abstractions for single-use code.
- No "flexibility"/"configurability" that wasn't requested; no error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

**3. Surgical changes** — Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting; don't refactor what isn't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions that *your* changes orphaned; leave pre-existing dead code alone (mention it, don't delete it).
- The test: every changed line should trace directly to the request.

**4. Goal-driven execution** — Define success criteria, then loop until verified.
- "Add validation" → write tests for invalid inputs, then make them pass.
- "Fix the bug" → write a test that reproduces it, then make it pass.
- "Refactor X" → ensure tests pass before and after.
- For multi-step tasks, state a brief plan with a verify step for each item.

## Status snapshot

> Per `my-app/CLAUDE.md` §7 working agreement, every behavior-changing commit must update this table AND the matching `docs/progress/<slice>.md` file in the same PR, or include `[skip-claudemd] <reason>` in the message. Self-learning loop — see `docs/progress/contact-page.md` for the canonical example.
>
> **1-on-1 slice handoff:** Tranche 1.A landed 2026-05-25. Remaining work (Phases 1–6, ~13 PRs) is enumerated as a checklist in [`docs/progress/1-on-1-production.md` § Tranche 1.B+ — Remaining-work handoff](docs/progress/1-on-1-production.md#tranche-1b--remaining-work-handoff-planned-2026-05-25). Any contributor (human or Claude) picking up this slice should read that section first and tick `[ ]` → `[x]` in the PR that lands each item.
> **PR 2 (Phase 4.2 — Jest harness)** landed 2026-05-25: `npm test` from `my-app/` runs 4 suites / 45 tests (format-time, phone, dto-to-message, copy snapshot) using `babel-jest` + `babel-preset-expo` (not the heavy `jest-expo` preset — see `docs/progress/1-on-1-production.md` § Phase 4.2 for why).
> **PR 3 (Phase 4.1 — Backend e2e)** landed 2026-05-25: `npm run api:test:e2e` boots Nest+Fastify against an isolated `test_e2e` schema and runs 7 REST happy-path cases for chat one-on-one create idempotency, message send idempotency, report 409, block 403 `peer_blocked`, mute, clear-per-user, non-member 403. Socket.IO cases (3, 4, 5) + Phase 2 cases (10–13) are queued as `it.todo` and land with their feature PRs.
> **PR 4 (Phase 2.1 — Reactions backend)** landed 2026-05-25: `MessageReaction` Prisma model + migration `20260525120000_add_message_reactions` + `ReactionsModule` (`POST/DELETE /messages/:id/reactions`) + `MessagesGateway.emitReactionUpdated` socket broadcast + `MessageDto.reactions: ReactionAggregate[]` (defaulted to `[]`). E2e case 10 green. Mobile UI (picker + pill row + bubble render) queued for next session.
>
> **BRD authored 2026-05-25 — 1-on-1 chat expansion** (no tranches landed yet): [`docs/progress/1-on-1-chat-expansion.md`](docs/progress/1-on-1-chat-expansion.md) operationalizes deferred Phase D (Reactions UI, Forward, Pin, Message Info) + new scope (extended attachments: Documents, Video, Location, Contact Card, Poll + Voice/Video Calls — **100ms provisional**, LiveKit Cloud POC before 2.H). Reconciliation revisions R1–R7 baked into body 2026-05-25; 5-agent review applied 2026-05-25 (shrank Tranche 2.0 to docs-only). 8 active tranches in revised order: **2.0** (dev pipeline docs) → 2.A ∥ 2.B (parallel: reactions UI + schema foundation) → 2.E (Forward + Pin + Message-Info) → 2.H (calls signalling backend, BullMQ ring-timeout, `user:{userId}` socket room) → 2.I (Call UI + push wakeup + **EAS migration**) → 2.C (DOC + VIDEO) → 2.D (LOCATION + CONTACT_CARD) → 2.F (Polls). 2.G (Scheduled-send) deferred to v1.1. Scope is **strictly 1-on-1**; Super Groups deferred to a separate future BRD.
>
> **Tranche 2.0 (dev pipeline docs)** landed 2026-05-25 (`e70ce46`): `my-app/instruction-to-run-the-app.md` created (fixes the broken `my-app/CLAUDE.md` row 9 reference + documents the correct backend port 4000 + emulator `10.0.2.2` networking), `my-app/CLAUDE.md` gains §7.5 Build pipeline subsection codifying dev-client-only Android flow, 3 helper npm scripts added to `my-app/package.json` (`prebuild:android`, `dev:android`, `dev:start`). **Zero native deps installed; zero prebuilds run** — those happen per-feature-tranche as needed. iOS + EAS deferred to Tranche 2.I when call testing requires real-device distribution. A Knowledge base of 10 native-dep gotchas (MultiDex, Gradle heap, ABI restrict, Maps API key, AudioFocus collision, `Duplicate jniLibs` warning, CNG-style gitignored android/, port 4000, Fabric compat, first-build time) is captured in `docs/progress/1-on-1-chat-expansion.md` § "Knowledge base for future native-dep tranches" — gates relevant later tranches.
>
> **Tranche 2.A (Reactions mobile UI)** landed 2026-05-25 (`c23365f` + mock follow-up): long-press reactions strip (`😅 👍 😆 😍 ❤️ 💯 🙏` + picker chip), `rn-emoji-keyboard@^1.7.0` full picker (pure-JS, Expo-Go-compatible), reactions pill row under bubbles, `chatSocket.onReactionUpdated` socket sync, optimistic `addReaction`/`removeReaction` on both api + mock repos (`bumpReactionLocally` with restore-on-failure). `MessageDto.reactions` (PR 4 backend) now plumbed through `dto-to-message.ts` → `types.ts` → bubble. Mock repo + seed support reactions for offline dev (CLAUDE.md §3). **QA-passed on Android emulator** (mock mode): strip renders above action sheet, picker opens + dark-themed, emoji-select → pill `😀 1` renders. 50/50 Jest green. Files: `reactions-strip.tsx`, `reactions-pill-row.tsx`, `emoji-picker-modal.tsx` (new) + edits to `message-action-sheet.tsx`, `message-bubble.tsx`, `chat/[id].tsx`, `chat-socket.ts`, `chat-repository.ts`, `api-chat-repository.ts`, `mock-chat-repository.ts`, `seed.ts`, `dto-to-message.ts`, `types.ts`.
>
> **Tranche 2.E-back (Forward + Pin backend)** landed 2026-05-25: 2 new modules cloning the reactions/blocks shape. **Forward** (`POST /messages/:id/forward {targetChatIds[1..20]}`) — per-target partial success (`items`+`skipped`), deterministic **hashed** `clientMessageId` (`fwd_`+sha256 to fit `VarChar(64)` — a 3-agent review caught that the raw triple overflows), blocks tombstone + server-only kinds, `forwardCount` bumps only on newly-created copies, clones content + drops `replyToMessageId`. **Pin** (`PATCH/DELETE /chats/:id/messages/:mid/pin` + `GET /chats/:id/pins`) — 3-pin cap enforced under `pg_advisory_xact_lock(chatId)` (race-safe), cross-chat guard (404), idempotent unpin. New `emitMessagePinned`/`emitMessageUnpinned` gateway events + `message:pinned`/`message:unpinned` SocketEvents + `forward.ts`/`pin.ts` shared schemas. Extracted `MessagesService.allocateAndCreate` (shared lock-tail for `send`+`forwardInto`). **31/31 e2e green** (+5 cases). **Split by a 3-agent review**: mobile UI = **2.E-front** (pending); **Message-Info deferred** (read-status-only duplicates the read-tick; no `readAt`); pin tap-to-scroll deferred (display-only strip). Knowledge-base K12 added: R2 media-delete must ref-count `forwardedFromMessageId` chains.
>
> **Tranche 2.B (Schema foundation)** landed 2026-05-25: backend-only keystone unblocking 2.C/2.D/2.F. `MessageKind` enum +7 values (`DOCUMENT, VIDEO, LOCATION, LOCATION_LIVE, CONTACT_CARD, POLL, CALL_EVENT`); Migration A (`20260525211223_expand_message_kind_and_media_fields`) adds 16 nullable `Message` columns (`mediaMimeType`, `video*`, `latitude/longitude/locationName/liveLocationExpiresAt`, `contact*`, `document*`, `forwardedFromMessageId/forwardCount`, `pinned*`) + 2 indexes + 2 FKs. `MediaService` accepts DOCUMENT (100MB, pdf/doc/xls/ppt/csv/zip) + VIDEO (80MB, mp4/mov/webm) via a per-kind `CONTENT_RULES`/`MEDIA_RULES` map. `SendMessageSchema` gains discriminated `superRefine` branches (DOCUMENT/VIDEO/LOCATION/CONTACT_CARD) + a `SERVER_ONLY_KINDS` guard (`SYSTEM/POLL/CALL_EVENT/LOCATION_LIVE` → 400 `kind_not_allowed_from_client`, enforced in shared zod AND `messages.service`). `messages.service` create-data + `rowToDto` + `MessageDto` carry all new fields; chat-list `previewForMessage` handles new kinds ("📄 Document", "📍 Location", etc.). **26/26 e2e green** (5 new cases); fixed `jest-e2e.config.js` `maxWorkers: 1` (2-suite parallel run was deadlocking on the shared `test_e2e` TRUNCATE). Forward/Pin columns land here per the BRD's one-foundational-migration decision (endpoints ship in 2.E). **Note:** `StarredMessage` model is pre-existing un-migrated schema-drift (Star feature deferred) — deliberately excluded from Migration A. **Note:** local e2e in this env needs `TEST_DATABASE_URL_BASE`/`TEST_REDIS_URL` overrides to point at the docker pg on 5432/6379 (config defaults to a dedicated 5433/6380 test instance).

| Slice | Mobile | Backend | Notes |
|---|---|---|---|
| Welcome / Terms / Phone | ✅ | n/a | UI only |
| Contact Page (chat list home) | ✅ live | ✅ live | Figma "Contact Page" frame (Base / 3-dot / Plus / Filter variants). Theme toggle, /new-chat → real /contacts, multi-select bulk actions, user-defined filters. See `docs/progress/contact-page.md`. |
| Device Contacts Sync | ✅ live | ✅ live | PR 6 complete (6.1+6.2+6.3+6.4). Backend: `/contacts/discover` (stateless, 10/min, no `userId` leak) + `/contacts/bulk` (idempotent batch save, 5/min, transactional dedup); 13/13 e2e green. Frontend: `expo-contacts` plugin, `useDeviceContacts` state-machine hook (chunked discovery, 24h MMKV cache), `/import-contacts` modal with 5 UI states, "Pick from phonebook" entry in Add Contact. **Requires `npx expo prebuild && expo run:android` to pick up the native module.** See `docs/progress/device-contacts.md`. |
| OTP request | ✅ (mock) | ✅ | MSG91 + Redis + rate limit |
| OTP verify | ✅ mock + real | ✅ argon2 + Redis | argon2-compares against Redis, attempts counter with lockout, burns key on success, mints JWT pair, marks `otp_requests` row VERIFIED |
| Profile (`/me`) | ✅ (mock + real) | ✅ | JWT-guarded GET + PATCH |
| Refresh / signout | ✅ (mock + real) | ✅ | Family rotation, replay detect |
| 1-on-1 chat (Figma) | ✅ pixel-tuned | n/a | gradient header, lime call buttons, purple/cream bubble pair, dark composer, day-divider pill, tombstones |
| 1-on-1 chat (live) | ✅ optimistic + reverse paginated | ✅ REST + Socket.IO | GET/POST `/chats/:id/messages?direction=desc&cursor=…`; Socket.IO `/chat` namespace with Redis adapter; REST send broadcasts via the gateway so both transports see the same `message:new` event; in-memory message cache fed by socket; `sending` / `failed` tick state; FlatList pulls older pages on scroll-up |
| Typing indicator | ✅ live | ✅ Redis TTL | Gateway `typing:ping` (5s TTL) → `typing:update`; client emits at most every 2.5s while typing; receiver shows animated three-dot indicator under the counterpart name |
| Presence (online/last seen) | ✅ live | ✅ Redis counters | `presence:count:{userId}` INCR on connect, DECR on disconnect; on `count==0` server writes `lastSeenAt` and broadcasts. Client header subline shows "Online" / "last seen 5m ago" |
| Read receipts | ✅ live + cold-start | ✅ | `chat:read` broadcast on REST mark-read. Api repo subscribes to `chatSocket.onReadReceipt` and flips cached mine-messages with `sequence ≤ uptoSequence` to `status: 'read'` — peer-only filter (own-device reads ignored). Sender's bubble tick flips lime live. **Cold-start (2026-05-25):** `ChatDetailSchema.counterpartLastReadSequence` plumbs the peer's read cursor; `listMessages` flips already-read mine-bubbles to lime double-tick on initial load. |
| Call buttons (Coming-Soon) | ✅ | n/a | Header voice/video buttons open the new `ComingSoonSheet` (Figma-aligned dark slab + lime CTA). Copy in `ChatCopy.comingSoon.{voiceCall,videoCall}` per BRD §4.19 — "free for everyone — not behind any premium plan". Reused later by Chat Theme + Export Chat (Phase C). |
| Voice progressive load | ✅ | n/a | `ActivityIndicator` in the voice-bubble play button while `useAudioPlayerStatus.isLoaded === false` so the bubble doesn't look unresponsive on slow Indian connections during the first R2 stream. |
| Reply to message | ✅ | ✅ | `replyToMessageId` plumbed through send (REST + socket); composer reply-preview banner with dismiss; quoted preview rendered inside the reply bubble |
| Delete for everyone | ✅ + tombstones | ✅ | `DELETE /chats/:id/messages/:msgId?scope=everyone`, sender-only, 60-min edit window; soft-delete + `message:deleted` broadcast; client renders "This message was deleted" |
| Long-press action sheet | ✅ | n/a | Reply / Pin·Unpin / Forward / Copy (text) / Delete for everyone (mine) / Report (counterpart, non-tombstone) — modal sheet. Pin/Forward gated on durable `status` (optimistic row's id == clientMessageId would 404). |
| Pin / Unpin message | ✅ (2.E-front-pin) | ✅ (2.E-back) | `PATCH/DELETE /chats/:id/messages/:mid/pin` (+ `GET /chats/:id/pins`); 3-pin cap → 409 `pin_cap_exceeded` (advisory-locked), cross-chat 404. Mobile: Pin/Unpin toggle row (`bookmark`, after Reply) on mine + theirs → optimistic `pinnedAt` flip (exact rollback) → bubble pin **pip** (grey, away from ticks, gated on `!deletedAt`). `chatSocket.onMessagePinned/onMessageUnpinned` keep the pip live (unpinned hard-sets null). Cap-409 → Alert. `pinMessage`/`unpinMessage` on `ChatRepository` (api + mock; mock fakes the 3-cap). **Pinned strip deferred** (cache-derivation was broken — re-fetch-on-event if ever) — Pin ships as a marker, not user-complete until an aggregated view lands. |
| Forward message | ✅ (2.E-front-forward) | ✅ (2.E-back) | `POST /messages/:id/forward { targetChatIds[1..20] }` (per-target partial success: `{items, skipped}`; clones content, drops reply + reactions, sets `forwardedFromMessageId`; `forwardCount` bumps on created copies). Mobile: action-sheet Forward row → **sibling** `chat/forward.tsx` modal picker (**single-select**, source thread excluded) → inline lime "Sent ✓" → auto-dismiss back to source (no destination-jump). Forwarded bubble shows a per-side "↪ Forwarded" label. `forwardMessage` on `ChatRepository` (api + mock). 5-agent-reviewed; multi-select + pinned-strip cut/deferred. |
| Report message | ✅ | ✅ new Reports module | `POST /messages/:id/report` (JWT, body `{ reason, note? }`). Verifies reporter is a chat member; 400 `cannot_report_self`; 409 `already_reported` (unique `(messageId, reporterUserId, reason)`). Never broadcasts; report rows live server-side only. Mobile picker: Spam / Harassment / Inappropriate content / Impersonation / Other. |
| Contact Profile screen | ✅ live (F1 fixed 2026-05-25) | ✅ 3 endpoints + `isBlocked` in profile-card | Figma `1:6560` / `1:6666`. Tap chat header avatar → `/contact/[id]`. Hero (avatar/name/+91 phone) + Voice/Video → Coming-Soon + Media gallery sub-route ("Media & Voice" — Links/Docs deferred to Tranche 2) + Encryption info + Common Groups (empty) + Premium-gated "Add to Super Group" (BRD §3.4). Destructive footer Block/Unblock now wired to real endpoints with optimistic UI. Backend: `GET /users/:id/profile-card` (privacy-filtered, 403 unless shared chat or contact; returns `isBlocked` for the viewer), `GET /chats/:chatId/media?kind=` (gallery), `GET /contacts/:contactUserId/common-groups` (returns `[]` until groups ship). F1 fix: `contact/[id]/index.tsx` rewritten with `FlatList.ListHeaderComponent` hero — the prior `ScrollView` sibling layout collapsed the first section's height on warm re-entry under RN 0.85 Fabric. |
| Image messages | ✅ pick + capture + bubble + viewer | ✅ R2 + key validation | Figma `1:3098` attachment sheet → `expo-image-picker` (gallery/camera) → presigned PUT to Cloudflare R2 → `POST /chats/:id/messages` with `mediaObjectKey`. Image bubble renders against intrinsic dims, tap → full-screen pinch-zoom viewer. Optimistic `uploading → sending → delivered` ticks. |
| Voice notes (record + play) | ✅ recorder overlay + playable bubble | ✅ R2 + key validation | Figma `1:3698` recorder overlay (`expo-audio` `useAudioRecorder`, HIGH_QUALITY m4a/AAC, animated waveform, 5-min cap). Bubble swaps the static visual for `expo-audio.useAudioPlayer` with progressive lime fill. |
| Location + Contact messages | ✅ (2.D) pickers + cards | ✅ (2.B) validators | **Tranche 2.D** — attach **Location** → privacy confirm → `expo-location` current position (timeout + last-known fallback, no AVD hang) + `reverseGeocodeAsync` place name → **LocationCard** tile (faux-map gradient + pin + "Open in Maps", universal `https` maps URL — no react-native-maps / no Maps API key). attach **Contact** → `chat/pick-contact.tsx` modal (`expo-contacts/legacy`, searchable, `toE164Loose` normalize, unsendable rows disabled) → **ContactCard** (formatted number, tap `tel:`). Both non-media (TEXT-like send). New shared `InfoCardBubble` (DocumentBubble migrated onto it). Previews "📍 Location" / "👤 Contact". Real map preview + doc-style static thumbnail deferred (need Maps API key). |
| Document + Video messages | ✅ (2.C) pick + bubbles + viewer | ✅ (2.B) R2 + validators | **Tranche 2.C** — first tranche needing new native deps (`expo-document-picker` + `expo-video`) + a prebuild. Combined **Gallery** tile picks photos+videos (`expo-image-picker` `mediaTypes:['images','videos']`, branch on `asset.type`); **Document** tile → `expo-document-picker`. Client `validateMediaPick` guard (MIME allowlist + size>0/≤cap + filename≤255) before presign. DOCUMENT bubble (icon+name+size, tap → `expo-web-browser`) renders inside the standard bubble; VIDEO bubble is a polished aspect tile (play button + duration pill, no list-mounted player) → tap → full-screen `expo-video` `VideoViewer` (mounted only while open, pause-before-close). Caps DOC 100MB / VIDEO 80MB; previews "📄 Document" / "📹 Video". Real video poster frames + doc download/share deferred. |
| Media uploads | ✅ presigned PUT | ✅ Cloudflare R2 | `POST /media/upload-url` returns `{ objectKey, uploadUrl, publicUrl, expiresAt }` (5-min TTL). Server validates that the inbound `mediaObjectKey` carries the sender's `userIdFirst8` prefix and the right extension for the message kind. |
| Per-chat options sheet (3-dot) | ✅ wired | ✅ | BRD §3.6. Chat-header `more-vertical` opens `PerChatOptionsSheet` with View contact / Search / Mute (toggles → `MutePickerSheet` 8h / 1w / Always) / Starred / Wallpaper / Clear chat / Export chat / Block contact rows. Mute bell-off pip on header avatar. |
| Block / Unblock (1-on-1) | ✅ wired | ✅ `BlocksModule` | `POST /users/:id/block` + `DELETE /users/:id/block` (idempotent, JWT-guarded). `BlocksService.isBlockedEitherWay` rejects sends in either direction with 403 `peer_blocked`. Block state is surfaced on `UserProfileCard.isBlocked` for the Contact Profile destructive footer (label flips Block↔Unblock; optimistic toggle with revert-on-failure). |
| Mute chat | ✅ wired | ✅ | `PATCH /chats/:id/mute` body `{ until: ISO\|null }`. `until: null` unmutes. Picker presets: 8h / 1w / Always. Push worker (Phase E) will read `ChatMember.mutedUntil` to skip muted memberships. |
| Clear chat | ✅ wired | ✅ | `PATCH /chats/:id/clear` writes `ChatMember.clearedAt = NOW()`. Per-user only — counterpart still sees the prior history. `GET /chats/:id/messages` filters `createdAt > clearedAt` for the caller. |
| Super Groups | 🚫 | 🚫 | After 1-on-1 |

## Chat backend (REST shape today)

| Endpoint | Purpose |
|---|---|
| `GET /chats` | Contact-page list |
| `POST /chats/one-on-one` | Create-or-return 1-on-1 chat (advisory-locked on user-pair) |
| `GET /chats/:chatId` | Full thread detail (counterpart, lastReadSequence) |
| `GET /chats/:chatId/messages?cursor=&limit=` | Paginated message history |
| `POST /chats/:chatId/messages` | Send. Idempotent on `(senderUserId, clientMessageId)` |
| `PATCH /chats/:id/read` | Bump `lastReadSequence` (monotonic) |
| `PATCH /chats/read-all` | Mark every membership read |
| `PATCH /chats/:id/favourite`, `/archive` | Toggles |
| `DELETE /chats/:id/messages/:msgId?scope=everyone` | Soft-delete a message. Sender-only, 60-min edit window. Server zeroes content + broadcasts `message:deleted` |
| `POST /media/upload-url` | Mint a 5-min presigned PUT URL to Cloudflare R2. Body `{ kind: 'IMAGE'\|'VOICE', contentType, sizeBytes }`. Server validates content-type allowlist + per-kind size cap (10 MB image / 5 MB voice), generates `chat-media/{userIdFirst8}/{uuid}.{ext}` key, returns `{ objectKey, uploadUrl, publicUrl, expiresAt }`. Rate-limited 30/min/user. Returns 503 when `R2_*` env vars are unset. |
| `POST /messages/:messageId/report` | File a moderation report. Body `{ reason: ReportReason, note? }`. JWT-guarded; reporter must be a chat member. 400 `cannot_report_self`, 409 `already_reported` (unique `(messageId, reporterUserId, reason)`). |
| `GET /users/:id/profile-card` | Privacy-filtered public profile of another user. 403 `profile_not_visible` unless viewer shares a chat OR has target saved as a contact. Returns `{ id, fullName, phoneE164, avatarUri, bio, isPremium, createdAt, commonChatId }`. |
| `GET /chats/:chatId/media?kind=IMAGE\|VOICE&cursor=&limit=&direction=` | Per-chat media gallery for the Contact Profile screen. Filters tombstones; reuses message cursor scheme; limit clamped to 60. |
| `GET /contacts/:contactUserId/common-groups` | GROUP / SUPER_GROUP chats both users are active in. Returns `{ items: [] }` until groups ship; shape is stable for client wiring. |

### Chat Socket.IO gateway (`/chat` namespace)

| Event | Direction | Purpose |
|---|---|---|
| `message:send` | C→S | Send a message (incl. `replyToMessageId`); server validates, persists with idempotent advisory-locked sequence, acks with the durable `MessageDto` |
| `message:new` | S→C | Broadcast on `chat:{chatId}` room when a message lands (socket OR REST) |
| `message:deleted` | S→C | Broadcast on tombstone — clients flip the cached row to "This message was deleted" |
| `session:resume` | C→S | "Catch me up since `lastSeenSequence`" — replies with missed messages in chronological order |
| `chat:read` | S→C | A peer's `lastReadSequence` advanced (REST mark-read triggers this) |
| `typing:ping` | C→S | Client emits while user is typing; server stores `typing:{chatId}:{userId}` with 5s TTL and re-broadcasts |
| `typing:update` | S→C | Peer is typing — client expires after 4.5s without a refresh |
| `presence:request` | C→S | Bootstrap: returns `{ isOnline, lastSeenAt }` for the given userIds and subscribes the caller to future updates |
| `presence:update` | S→C | A user's presence changed (connect ↔ disconnect edge) |

Connection: `io(${API_URL}/chat, { auth: { token: <jwt> } })`. JWT verified in `handleConnection`; user auto-joins `chat:{chatId}` rooms for every active membership. Horizontal scaling via Upstash Redis adapter.

Mobile selects between mock and real via `EXPO_PUBLIC_USE_MOCKS` (defaults to mock in `__DEV__`). Both impls satisfy `ChatRepository`. The real impl maintains an in-memory message cache fed by socket events so screens never need to refetch.

### Media wire-format additions

The `MessageDto` includes three new fields when `kind` is `IMAGE` or `VOICE`:

- `mediaUrl: string | null` — public R2 CDN URL computed by the server from `mediaObjectKey`. Null on TEXT, SYSTEM, and deleted messages.
- `imageWidth: number | null` / `imageHeight: number | null` — IMAGE only. Drive the bubble's aspect-ratio reservation so the layout doesn't shift when the image finishes loading.

Send payload for IMAGE: `{ kind: 'IMAGE', mediaObjectKey, imageWidth, imageHeight }`. Send payload for VOICE: `{ kind: 'VOICE', mediaObjectKey, durationSec, waveform }`. The server's send path validates `mediaObjectKey` against the sender's user-id prefix before persisting (stops a client pasting an arbitrary key).
