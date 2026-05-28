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
>
> **Per-tranche history** (BRD, design decisions, migrations, knowledge-base gotchas K1–K13, file lists, e2e counts, sequencing) lives in the progress docs — don't duplicate it here:
> - 1-on-1 chat expansion (Tranches 2.0–2.I): [`docs/progress/1-on-1-chat-expansion.md`](docs/progress/1-on-1-chat-expansion.md)
> - 1-on-1 production hardening (PRs 2–4, Phases 1–6): [`docs/progress/1-on-1-production.md`](docs/progress/1-on-1-production.md)
> - Profile Page v2 (P1 + P2 slices): [`docs/progress/profile-page-v2.md`](docs/progress/profile-page-v2.md)
> - Contact Page (canonical self-learning loop example): [`docs/progress/contact-page.md`](docs/progress/contact-page.md)
> - Device Contacts Sync (PR 6.1–6.4): [`docs/progress/device-contacts.md`](docs/progress/device-contacts.md)
> - Calls provider POC (100ms → LiveKit decision + live-test checklist): [`docs/architecture/calls-provider-poc.md`](docs/architecture/calls-provider-poc.md)
> - iOS push/CallKit enablement checklist: [`docs/architecture/ios-enablement-checklist.md`](docs/architecture/ios-enablement-checklist.md)

| Slice | Mobile | Backend | Notes |
|---|---|---|---|
| Welcome / Terms / Phone | ✅ | n/a | UI only |
| Contact Page (chat list home) | ✅ live | ✅ live | Figma "Contact Page" frame (Base / 3-dot / Plus / Filter variants). Theme toggle, /new-chat → real /contacts, multi-select bulk actions, user-defined filters. See `docs/progress/contact-page.md`. |
| Device Contacts Sync | ✅ live | ✅ live | PR 6 complete (6.1+6.2+6.3+6.4). Backend: `/contacts/discover` (stateless, 10/min, no `userId` leak) + `/contacts/bulk` (idempotent batch save, 5/min, transactional dedup); 13/13 e2e green. Frontend: `expo-contacts` plugin, `useDeviceContacts` state-machine hook (chunked discovery, 24h MMKV cache), `/import-contacts` modal with 5 UI states. **WhatsApp-style auto-import (2026-05-27):** the "+" menu "Add Contact" opens `/import-contacts` directly; on permission grant, matches are **auto-saved** via `addMany` (no checkboxes / no Save button / no blocking Alert) — read-only list with an inline "Added N" status; manual single-add stays reachable via a secondary "Add a number manually" link. **WhatsApp-style New Chat picker + tap-to-chat (2026-05-27):** `(modals)/new-chat.tsx` rebuilt as an A→Z `SectionList` with a right-edge fast-scroll index (`alpha-index-bar.tsx` + `contact-sections.ts`), sticky headers, search-collapses-to-flat, and an "Invite a friend" footer (`Share.share`). Tapping an imported `MatchRow` (now a `Pressable`) opens the chat directly. New shared `useStartChat()` hook + first-class `ChatRepository.createOneOnOne` (mock has a pending-threads map → chat appears in the home list on first send; fixes new-chat under `USE_MOCKS=true`). 92/92 Jest. **Requires `npx expo prebuild && expo run:android` to pick up the native module.** See `docs/progress/device-contacts.md`. |
| OTP request | ✅ (mock) | ✅ worldwide | Provider seam (`OtpVerificationProvider`): **TwilioVerifyProvider** (prod, when `TWILIO_*` env set) or **DevVerifyProvider** (argon2 + Redis + MSG91/console fallback). Country allow-list gate (`OTP_ALLOWED_COUNTRIES`, libphonenumber-based) rejects unsupported markets with 400 `country_not_supported` **before any provider spend** — primary SMS-pumping / AIT defense. New `OTP_COUNTRY_BLOCKED` security event for monitoring. Per-phone + per-IP rate limits unchanged. Design: [`docs/progress/otp-research.md`](docs/progress/otp-research.md). |
| OTP verify | ✅ mock + real | ✅ provider seam | Production-wired through `OtpService.verify()` → bound provider. **Twilio path:** delegates code generation + storage + attempts to Twilio Verify (managed); maps 60202 → `attempts_exceeded`, 60600 → `provider_error`; one Redis key (`otp-session:<phone>`) correlates `sessionRef` back to the audit row. **Dev path:** argon2-compares against Redis, attempts counter with lockout, burns key on success. Both paths upsert User + mint JWT pair + mark `otp_requests` row VERIFIED + tag `provider` column for audit correlation. |
| Profile (`/me`) | ✅ (mock + real) | ✅ | JWT-guarded GET + PATCH |
| Refresh / signout | ✅ (mock + real) | ✅ | Family rotation, replay detect |
| 1-on-1 chat (Figma) | ✅ pixel-tuned | n/a | gradient header, lime call buttons, purple/cream bubble pair, dark composer, day-divider pill, tombstones |
| 1-on-1 chat (live) | ✅ optimistic + reverse paginated | ✅ REST + Socket.IO | GET/POST `/chats/:id/messages?direction=desc&cursor=…`; Socket.IO `/chat` namespace with Redis adapter; REST send broadcasts via the gateway so both transports see the same `message:new` event; in-memory message cache fed by socket; `sending` / `failed` tick state; FlatList pulls older pages on scroll-up. **Keyboard fix (2026-05-27):** thread uses `react-native-keyboard-controller`'s `KeyboardAvoidingView` (root wrapped in `KeyboardProvider`) with `behavior="padding"` on both platforms + `keyboardVerticalOffset={insets.top + 80}` (the `ChatHeader` height) — the old RN `KeyboardAvoidingView` was a no-op on Android under edge-to-edge (SDK 56), so the keyboard covered the composer. |
| Typing indicator | ✅ live | ✅ Redis TTL | Gateway `typing:ping` (5s TTL) → `typing:update`; client emits at most every 2.5s while typing; receiver shows animated three-dot indicator under the counterpart name |
| Presence (online/last seen) | ✅ live | ✅ Redis counters | `presence:count:{userId}` INCR on connect, DECR on disconnect; on `count==0` server writes `lastSeenAt` and broadcasts. Client header subline shows "Online" / "last seen 5m ago" |
| Read receipts | ✅ live + cold-start | ✅ | `chat:read` broadcast on REST mark-read. Api repo subscribes to `chatSocket.onReadReceipt` and flips cached mine-messages with `sequence ≤ uptoSequence` to `status: 'read'` — peer-only filter (own-device reads ignored). Sender's bubble tick flips lime live. **Cold-start (2026-05-25):** `ChatDetailSchema.counterpartLastReadSequence` plumbs the peer's read cursor; `listMessages` flips already-read mine-bubbles to lime double-tick on initial load. |
| Voice / Video calls (1-on-1) | ✅ live (2.I) | ✅ live (2.H PR-2, **LiveKit**) | Header voice/video buttons → `startCall` → mint token (`POST /calls/token`) → `chat/call.tsx` LiveKit `<LiveKitRoom>` (audio always, camera for VIDEO; mute/camera/hangup; abnormal-termination → hangup; AudioSession reclaims focus). Incoming via `call:ring` socket (+ Expo push wakeup) → `chat/incoming-call.tsx` (accept/decline, auto-dismiss on taken/ended). Server: full lifecycle (RINGING→ACCEPTED/DECLINED/MISSED/COMPLETED, advisory-lock first-accept-wins, BullMQ 30s ring-timeout, block-aware), CALL_EVENT thread pill, LiveKit `WebhookReceiver` (room_finished → COMPLETED). Push: `UserDevice` + `POST /push/tokens` + `notifyCall` (Expo push, mute-bypassed). iOS push/CallKit scaffolded — see `docs/architecture/ios-enablement-checklist.md`. Provider POC §8.1: 100ms→LiveKit. **Post-2-party-QA fixes (PR #3, I.11/I.12):** chat socket reopens on REST token refresh (`api-client`→`chatSocket.restart()`, login-symmetric — aged-session cold launch self-heals so `call:ring` arrives without a re-login); call screens pre-gate mic/camera (`src/lib/call-permissions.ts`) before `<LiveKitRoom>` connects (no first-call mid-connect bounce; deny → Alert + decline). **Verified live 2026-05-26** — full 2-party voice call on two emulators against the real LiveKit cloud: ring → accept → 94s connected call → COMPLETED → "Voice call · 1m 34s" CALL_EVENT on both sides; both fixes confirmed in the call. |
| Voice progressive load | ✅ | n/a | `ActivityIndicator` in the voice-bubble play button while `useAudioPlayerStatus.isLoaded === false` so the bubble doesn't look unresponsive on slow Indian connections during the first R2 stream. |
| Reply to message | ✅ | ✅ | `replyToMessageId` plumbed through send (REST + socket); composer reply-preview banner with dismiss; quoted preview rendered inside the reply bubble |
| Delete for everyone | ✅ + tombstones | ✅ | `DELETE /chats/:id/messages/:msgId?scope=everyone`, sender-only, 60-min edit window; soft-delete + `message:deleted` broadcast; client renders "This message was deleted" |
| Long-press action sheet | ✅ | n/a | Reply / Pin·Unpin / Forward / Copy (text) / Delete for everyone (mine) / Report (counterpart, non-tombstone) — modal sheet. Pin/Forward gated on durable `status` (optimistic row's id == clientMessageId would 404). |
| Pin / Unpin message | ✅ (2.E-front-pin) | ✅ (2.E-back) | `PATCH/DELETE /chats/:id/messages/:mid/pin` (+ `GET /chats/:id/pins`); 3-pin cap → 409 `pin_cap_exceeded` (advisory-locked), cross-chat 404. Mobile: Pin/Unpin toggle row (`bookmark`, after Reply) on mine + theirs → optimistic `pinnedAt` flip (exact rollback) → bubble pin **pip** (grey, away from ticks, gated on `!deletedAt`). `chatSocket.onMessagePinned/onMessageUnpinned` keep the pip live (unpinned hard-sets null). Cap-409 → Alert. `pinMessage`/`unpinMessage` on `ChatRepository` (api + mock; mock fakes the 3-cap). **Pinned strip deferred** (cache-derivation was broken — re-fetch-on-event if ever) — Pin ships as a marker, not user-complete until an aggregated view lands. |
| Forward message | ✅ (2.E-front-forward) | ✅ (2.E-back) | `POST /messages/:id/forward { targetChatIds[1..20] }` (per-target partial success: `{items, skipped}`; clones content, drops reply + reactions, sets `forwardedFromMessageId`; `forwardCount` bumps on created copies). Mobile: action-sheet Forward row → **sibling** `chat/forward.tsx` modal picker (**single-select**, source thread excluded) → inline lime "Sent ✓" → auto-dismiss back to source (no destination-jump). Forwarded bubble shows a per-side "↪ Forwarded" label. `forwardMessage` on `ChatRepository` (api + mock). 5-agent-reviewed; multi-select + pinned-strip cut/deferred. |
| Report message | ✅ | ✅ new Reports module | `POST /messages/:id/report` (JWT, body `{ reason, note? }`). Verifies reporter is a chat member; 400 `cannot_report_self`; 409 `already_reported` (unique `(messageId, reporterUserId, reason)`). Never broadcasts; report rows live server-side only. Mobile picker: Spam / Harassment / Inappropriate content / Impersonation / Other. |
| Contact Profile screen | ✅ live · **v2 redesign P1 landed 2026-05-27** | ✅ 3 endpoints + `isBlocked` in profile-card | **Profile Page v2 (Figma `1:3877`)** — P1 redesign landed: purple banner + 126px ringed avatar, **4 dark action tiles** (Voice Call/Video Call → live `startCall`; Notifications → `MutePickerSheet`; Search → coming-soon), grouped options list (Media Links & Docs / Chat Theme / Notifications / Manage Storage / Privacy — `Group Permissions` dropped for 1-on-1), destructive footer (Clear Chat + Block/Unblock — `Exit & Delete Group` adapted). Tokens `Brand.profileBg/profileBackCircle/destructiveRed` + `ProfileActionTile`; row labels single-sourced in `features/chat/profile-rows.ts`. **P2 slices all landed 2026-05-27** — **Search** (`GET /chats/:id/messages/search`, overlay + scroll-to-hit), **Manage Storage** (`Message.mediaSizeBytes` migration + `GET /chats/:id/storage` + screen; free-up-space stub), **Chat Theme** (`ChatMember.chatTheme` migration + `PATCH /chats/:id/theme` + picker; themes thread bg **and** bubbles), **Privacy sub-screen** (`contact/[id]/privacy.tsx`: Block/Encryption/Disappearing + focus-resync). Full-suite: **68 backend e2e + 160 mobile Jest green.** See `docs/superpowers/plans/2026-05-27-profile-page-v2.md` + `docs/progress/profile-page-v2.md`. Prior (`1:6560`/`1:6666`): tap chat header avatar → `/contact/[id]`; `GET /users/:id/profile-card` (privacy-filtered, 403 unless shared chat or contact; `isBlocked`), `GET /chats/:chatId/media?kind=`, `GET /contacts/:contactUserId/common-groups` (`[]` until groups). F1 fix: `FlatList.ListHeaderComponent` hero (the prior `ScrollView` sibling layout collapsed section height on warm re-entry under RN 0.85 Fabric) — **preserved in v2.** |
| Image messages | ✅ pick + capture + bubble + viewer | ✅ R2 + key validation | Figma `1:3098` attachment sheet → `expo-image-picker` (gallery/camera) → presigned PUT to Cloudflare R2 → `POST /chats/:id/messages` with `mediaObjectKey`. Image bubble renders against intrinsic dims, tap → full-screen pinch-zoom viewer. Optimistic `uploading → sending → delivered` ticks. |
| Voice notes (record + play) | ✅ recorder overlay + playable bubble | ✅ R2 + key validation | Figma `1:3698` recorder overlay (`expo-audio` `useAudioRecorder`, HIGH_QUALITY m4a/AAC, animated waveform, 5-min cap). Bubble swaps the static visual for `expo-audio.useAudioPlayer` with progressive lime fill. **Unmount-crash fixed 2026-05-26**: the `player.pause()` cleanup in `voice-player.tsx` is now wrapped in try/catch — `useAudioPlayer` auto-releases on unmount/`[player]`-change, so the bare cleanup was calling a released shared object → app white-screen (see `docs/progress/1-on-1-chat-expansion.md` K13). |
| Location + Contact messages | ✅ (2.D) pickers + cards | ✅ (2.B) validators | **Tranche 2.D** — attach **Location** → privacy confirm → `expo-location` current position (timeout + last-known fallback, no AVD hang) + `reverseGeocodeAsync` place name → **LocationCard** tile (faux-map gradient + pin + "Open in Maps", universal `https` maps URL — no react-native-maps / no Maps API key). attach **Contact** → `chat/pick-contact.tsx` modal (`expo-contacts/legacy`, searchable, `toE164Loose` normalize, unsendable rows disabled) → **ContactCard** (formatted number, tap `tel:`). Both non-media (TEXT-like send). New shared `InfoCardBubble` (DocumentBubble migrated onto it). Previews "📍 Location" / "👤 Contact". Real map preview + doc-style static thumbnail deferred (need Maps API key). |
| Document + Video messages | ✅ (2.C) pick + bubbles + viewer | ✅ (2.B) R2 + validators | **Tranche 2.C** — first tranche needing new native deps (`expo-document-picker` + `expo-video`) + a prebuild. Combined **Gallery** tile picks photos+videos (`expo-image-picker` `mediaTypes:['images','videos']`, branch on `asset.type`); **Document** tile → `expo-document-picker`. Client `validateMediaPick` guard (MIME allowlist + size>0/≤cap + filename≤255) before presign. DOCUMENT bubble (icon+name+size, tap → `expo-web-browser`) renders inside the standard bubble; VIDEO bubble is a polished aspect tile (play button + duration pill, no list-mounted player) → tap → full-screen `expo-video` `VideoViewer` (mounted only while open, pause-before-close). Caps DOC 100MB / VIDEO 80MB; previews "📄 Document" / "📹 Video". Real video poster frames + doc download/share deferred. |
| Media uploads | ✅ presigned PUT | ✅ Cloudflare R2 | `POST /media/upload-url` returns `{ objectKey, uploadUrl, publicUrl, expiresAt }` (5-min TTL). Server validates that the inbound `mediaObjectKey` carries the sender's `userIdFirst8` prefix and the right extension for the message kind. |
| Per-chat options sheet (3-dot) | ✅ wired | ✅ | BRD §3.6. Chat-header `more-vertical` opens `PerChatOptionsSheet` with View contact / Search / Mute (toggles → `MutePickerSheet` 8h / 1w / Always) / Starred / Wallpaper / Clear chat / Export chat / Block contact rows. Mute bell-off pip on header avatar. |
| Block / Unblock (1-on-1) | ✅ wired | ✅ `BlocksModule` | `POST /users/:id/block` + `DELETE /users/:id/block` (idempotent, JWT-guarded). `BlocksService.isBlockedEitherWay` rejects sends in either direction with 403 `peer_blocked`. Block state is surfaced on `UserProfileCard.isBlocked` for the Contact Profile destructive footer (label flips Block↔Unblock; optimistic toggle with revert-on-failure). |
| Mute chat | ✅ wired | ✅ | `PATCH /chats/:id/mute` body `{ until: ISO\|null }`. `until: null` unmutes. Picker presets: 8h / 1w / Always. Push worker (Phase E) will read `ChatMember.mutedUntil` to skip muted memberships. |
| Clear chat | ✅ wired | ✅ | `PATCH /chats/:id/clear` writes `ChatMember.clearedAt = NOW()`. Per-user only — counterpart still sees the prior history. `GET /chats/:id/messages` filters `createdAt > clearedAt` for the caller. |
| Polls (1-on-1) | ✅ (2.F-front) | ✅ (2.F-back) | Paperclip → Poll tile → compose-poll modal (question + 2–10 options + multi-select switch, anonymous hidden per BRD) → `PollBubble` (radio/checkbox + count + fill bar + "N voted" subline; disabled when closed) → `MessageActionSheet` "Close poll" row for own polls. Optimistic vote via pure `applyVoteLocally` helper (single-replace vs multi-diff matches server). Mock repo has full parity for `EXPO_PUBLIC_USE_MOCKS=true` offline dev. Backend: `PollsModule` (4 endpoints), Migration B (`poll_messages`/`poll_options`/`poll_votes`), `pg_advisory_xact_lock(pollMessageId)` for race-safe voting, `MessagesService.createServerAuthored` (reused by 2.H for CALL_EVENT), per-viewer `poll:voted` broadcast via new `user:{userId}` room. **7 backend e2e + 9 mobile Jest cases green**. |
| Voice/Video calls (signalling backend) | 🚫 queued (2.I) | ✅ (2.H-back, PR-1 stub) | New `CallsModule`: `/calls/token` (initiator + ring callee), `/calls/:id/accept` under `pg_advisory_xact_lock(callId)` for multi-device first-accept-wins, `/calls/:id/decline`, `/calls/:id/hangup`, `/calls/webhooks/100ms` (HMAC-SHA256 verify), `GET /chats/:chatId/calls` (history). BullMQ 30s ring-timeout (jobId = callId, cancellable by accept/decline; survives Fly blue-green deploy per BRD R5). `CallSession` table + 3 indexes + `call_event_message_id` UNIQUE back-ref to the CALL_EVENT thread row. **PR-1 stub**: `HmsClient.createRoom` returns a synthetic id; real 100ms HTTP wiring + HMAC verify in **PR-2** (gated on founder's live-test checklist in `docs/architecture/calls-provider-poc.md` § 6). Mobile CallScreen + EAS Build + push wakeup all land in Tranche 2.I. 9 e2e cases green. |
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
| `GET /chats/:chatId/messages/search?q=&cursor=&limit=` | **Profile v2 P2.** In-chat message search (case-insensitive `contains` on `text`). Member-gated (403 `not_a_member`); excludes tombstones + messages at/before the caller's `clearedAt`; DESC by sequence, keyset cursor; 400 on empty/over-100-char `q`. Returns `{ items: MessageSearchHit[], meta }`. |
| `GET /chats/:chatId/storage` | **Profile v2 P2.** Per-chat storage summary for Manage Storage. Member-gated. `groupBy kind` summing `COALESCE(mediaSizeBytes, documentSizeBytes, 0)`, ordered heaviest-first; BigInt bytes serialized as strings. `mediaSizeBytes` is populated on send (internal-only column, not on `MessageDto`). |
| `PATCH /chats/:chatId/theme` | **Profile v2 P2.** Set/reset the caller's per-chat theme. Body `{ theme: 'default'\|'midnight'\|'forest'\|'sunset'\|null }` (`null` resets). Member-scoped (404 `chat_not_found`), 400 `unknown_theme`. Persists `ChatMember.chatTheme`; surfaced on `GET /chats/:chatId` (`chatTheme`). Per-user (each side themes independently). |
| `GET /contacts/:contactUserId/common-groups` | GROUP / SUPER_GROUP chats both users are active in. Returns `{ items: [] }` until groups ship; shape is stable for client wiring. |
| `POST /chats/:chatId/polls` | Create a poll. Body `{ clientMessageId, question, options[2..10], multiSelect?, anonymous? }`. Server-authored POLL message (POLL is in `SERVER_ONLY_KINDS`); idempotent on `clientMessageId`. Returns `MessageDto` with `.poll` populated. Emits `message:new` + per-viewer `poll:voted`. |
| `POST /messages/:messageId/vote` | Cast / change a vote. Body `{ optionIds[1..10] }` (the FULL post-vote selection set — server diffs). Single-select polls accept exactly 1; multi-select accepts 1..N. 409 `poll_closed`, 403 `not_a_member`, 400 `unknown_option` / `single_select_violation`. Returns personalised `PollAggregate`. |
| `GET /messages/:messageId/poll` | Fetch the live `PollAggregate` (personalised — `options[].votedByMe` reflects the caller). 403 `not_a_member`, 404 `not_a_poll`. |
| `POST /messages/:messageId/poll/close` | Close a poll. Sender-only (403 `not_sender`); idempotent if already closed. Disables further voting. Emits `poll:voted` with `closedAt` populated. |
| `POST /calls/token` | Mint a 100ms client token + ring the callee. Body `{ chatId, kind: 'VOICE'\|'VIDEO' }`. 403 `not_a_member`, 403 `peer_blocked` (Tranche 2.H). Returns `{ callId, hmsRoomId, hmsToken, expiresAt }`. Schedules a 30s BullMQ ring-timeout job (jobId = callId). |
| `POST /calls/:callId/accept` | Callee accepts under `pg_advisory_xact_lock(callId)` for multi-device first-accept-wins. 409 `call_already_accepted` for losing devices. Emits `call:accepted` to both peers + `call:taken` to callee's other devices. |
| `POST /calls/:callId/decline` | Callee declines. 409 `call_not_ringing` if already non-RINGING. Inserts CALL_EVENT thread row. Emits `call:ended { reason: 'declined' }`. |
| `POST /calls/:callId/hangup` | Either peer hangs up after ACCEPTED. 409 `call_not_active` otherwise. Persists `durationSec`, inserts CALL_EVENT "Voice call · 4m 12s", calls `hmsClient.disableRoom`, emits `call:ended { reason: 'hangup', durationSec }`. |
| `POST /calls/webhooks/100ms` | 100ms webhook receiver. Unauthenticated but HMAC-SHA256-signed (header `x-hms-signature`). PR-1 stub rejects every signature with 403; real verification + `durationSec` sync in PR-2. |
| `GET /chats/:chatId/calls` | Per-chat call history (DESC). 403 `not_a_member`. Returns `{ items: CallSummary[] }`. |

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
| `poll:voted` | S→C | Tranche 2.F. Personalised per viewer (server iterates chat members; `options[].votedByMe` is per-recipient). Emitted on poll create, vote, and close. Delivered via the per-user `user:{userId}` room (joined on connect; reused by 2.H call-ring). |
| `call:ring` | S→C | Tranche 2.H. Fans out on the callee's `user:{calleeUserId}` room (ALL their devices). Payload: `{ callId, chatId, hmsRoomId, kind, initiator, ringExpiresAt }`. The IncomingCallScreen drives a local countdown until `ringExpiresAt`. |
| `call:accepted` | S→C | Tranche 2.H. Emitted to both peers' `user:{userId}` rooms when the callee accepts. The initiator transitions IncomingScreen → CallScreen; the accepting device navigates to CallScreen. |
| `call:ended` | S→C | Tranche 2.H. Emitted to both peers on every terminal transition (missed / declined / hangup / webhook). Carries `reason` + `durationSec` (null for missed/declined). |
| `call:taken` | S→C | Tranche 2.H. Fans out on the callee's `user:{calleeUserId}` room AFTER an accept commits. Other devices dismiss their IncomingCallScreen; the accepting device self-ignores. |

Connection: `io(${API_URL}/chat, { auth: { token: <jwt> } })`. JWT verified in `handleConnection`; user auto-joins `chat:{chatId}` rooms for every active membership. Horizontal scaling via Upstash Redis adapter.

Mobile selects between mock and real via `EXPO_PUBLIC_USE_MOCKS` (defaults to mock in `__DEV__`). Both impls satisfy `ChatRepository`. The real impl maintains an in-memory message cache fed by socket events so screens never need to refetch.

### Media wire-format additions

The `MessageDto` includes three new fields when `kind` is `IMAGE` or `VOICE`:

- `mediaUrl: string | null` — public R2 CDN URL computed by the server from `mediaObjectKey`. Null on TEXT, SYSTEM, and deleted messages.
- `imageWidth: number | null` / `imageHeight: number | null` — IMAGE only. Drive the bubble's aspect-ratio reservation so the layout doesn't shift when the image finishes loading.

Send payload for IMAGE: `{ kind: 'IMAGE', mediaObjectKey, imageWidth, imageHeight }`. Send payload for VOICE: `{ kind: 'VOICE', mediaObjectKey, durationSec, waveform }`. The server's send path validates `mediaObjectKey` against the sender's user-id prefix before persisting (stops a client pasting an arbitrary key).
