# Progress — 1-on-1 Chat Expansion (Attachments + Actions + Reactions UI + Calls)

| | |
|---|---|
| **Owner** | Surya (founder) |
| **Slice** | 1-on-1 expansion — extended attachments, message actions, reactions UI, polls, scheduled-send, and real voice/video calls. **Scope is strictly 1-on-1.** Super Groups are out of scope and tracked in a separate future BRD. |
| **Status** | BRD authored 2026-05-25; reconciliation revisions R1–R7 accepted and baked into the body 2026-05-25; 5-agent review applied 2026-05-25 (shrank Tranche 2.0 to docs-only). Tranche 2.0 (dev pipeline documentation) is the next PR. No feature tranches landed yet. |
| **Last updated** | 2026-05-25 |
| **Design source** | Figma `JYhOHnaEDgGYNxJShD9WDK`, node `1:1574` (`?m=dev`) — frames: "Chat page", "Key board page", "Voice note page", "Attach File Section", "Chat Select Option (Someone's Message)", "Chat Select Option (Own Message)" |
| **Predecessor BRD** | [`1-on-1-production.md`](./1-on-1-production.md) — covered Tranche 1.A (BRD §3.2 in-thread gaps, Contact Profile, per-chat options, Block, Mute, Clear chat). This BRD operationalizes the deferred Phase D (Reactions / Forward / Edit) and adds new scope: extended attachments + Polls + Scheduled-send + Voice/Video Calls (was Phase E in the predecessor). |
| **Plan source** | Two parallel Plan-agents (backend + frontend) under plan-mode session 2026-05-25; synthesized here. |

---

## Overview

`docs/progress/1-on-1-production.md` shipped Tranche 1.A: in-thread Coming-Soon sheet, per-message Report, Contact Profile screen, Block/Unblock, Mute, Clear chat, voice progressive load, cold-start read receipts. It also landed the backend half of Reactions (PR 4 — `MessageReaction` model + REST + socket broadcast) but **deferred the mobile UI for reactions, Forward, Star, Edit, Stickers, push, and R2 orphan cleanup.**

The new Figma frames (`1:1574`) reframe the deferred work plus expand the attach sheet from 5 disabled-tile placeholders to a 7-tile production grid (Photos, Camera, Location, Contact, Documents, Poll, Schedule) and replace the `ComingSoonSheet` stub on voice/video call buttons with real WebRTC via **100ms** (India-first SFU; Mumbai/Delhi/Bangalore POPs; Expo config plugin maintained).

This BRD closes that gap in **nine shippable tranches**. Every tranche merges with green CI + green e2e and is independently revertible. Per `my-app/CLAUDE.md` §7 working agreement, every tranche updates root `CLAUDE.md` §10 status snapshot in the same PR.

### Out-of-scope (deferred to future BRDs)

- **Super Groups** — all multi-party chat, group polls with N voters, group-call SFUs with > 2 peers, group admin permissions, group-block semantics.
- **LOCATION_LIVE** (real-time live location with TTL) — static location only in this BRD. Live-location plumbing requires its own update-stream channel; punted to a "Live Location" BRD.
- **Scheduled-send** — deferred to v1.1 per reconciliation R2. The original Tranche 2.G has been removed from this BRD. Rationale: lowest-value feature in the bundle (WhatsApp doesn't have it); building it under a safe queue would consume ~1 week that's better spent on the headline calls slice.
- **Edit Message** (BRD §3.5 Phase D.4 in predecessor) — separate small BRD.
- **Stickers** (BRD §3.5 Phase D.5 in predecessor) — separate.
- **In-thread search** (Phase D.3 in predecessor) — separate.
- **R2 orphan cleanup worker** — separate ops/infra BRD.
- **CallKit / VoIP push (iOS)** — v1 call ring relies on standard Expo push; CallKit lock-screen treatment is a v1.1 follow-up.
- **EAS Build + iOS** — deferred to Tranche 2.I per the 5-agent review (2026-05-25). Tranches 2.0 through 2.H run on local Android dev-client builds only.

---

## Architectural decisions (locked)

These are non-negotiable for this BRD; revisiting them requires re-opening planning.

### Voice/video call provider — **Provisional: 100ms. Final lock after a 1-day LiveKit Cloud POC before Tranche 2.H.**

The BRD's POC compares 100ms vs LiveKit Cloud (NOT self-hosted) on:

1. India P50 latency on a Mumbai-to-Delhi 4G test.
2. Expo plugin install friction + dev-client compatibility.
3. Lines of code for our 1-on-1 CallScreen vs each provider's prebuilt kit.
4. Lock-in escape hatch (LiveKit's client SDK is open-source — self-host migration always remains an option without rewriting the client).

100ms remains the default if the POC is inconclusive. Self-hosting LiveKit is **deliberately out of scope** — solo-founder ops burden (TURN/STUN, certificate rotation, India ISP NAT debugging) outweighs the per-minute cost savings at our stage. Revisit at 50k+ DAU.

### Queue / cron infrastructure — **BullMQ + Upstash Redis from day 1**

Selected over `@nestjs/schedule`. Rationale per reconciliation R5:

1. **Correctness, not just scaling.** The 30s ring-timeout for unanswered calls cannot live in an in-process `setTimeout` — `setTimeout` state does not survive a Fly blue-green deploy. If `fly deploy` happens 5s after a call rings, the RINGING → MISSED transition never fires; the call stays RINGING forever. BullMQ delayed jobs persist in Redis and survive any deploy.
2. **One queue technology.** `my-app/CLAUDE.md` §4 already documents BullMQ as the future worker queue. Introducing `@nestjs/schedule` would add a second queue paradigm and a corresponding ops/observability tax.
3. **Upstash Redis is already provisioned** (used for the Socket.IO Redis adapter + presence counters + typing TTLs). No new infra.

Use BullMQ delayed jobs for: call ring-timeout (Tranche 2.H), future push-retry queue (Phase E), and any future scheduled-send (deferred to v1.1).

### Push notifications — **`expo-server-sdk`** (server) + **`expo-notifications`** (client)

Single Expo push pipeline for both iOS and Android. No FCM/APNs split for v1. CallKit (iOS VoIP push) deferred to v1.1.

### Schema strategy — **Discriminated-union message kinds**

All new message kinds share the existing `Message` table. New nullable columns added per-kind (e.g., `latitude`, `documentTitle`). Polls + CallSessions get their own tables. Rationale: a single `Message` table is simpler to query (one history list, one delete path), and Postgres handles wide-but-sparse rows well.

---

## Tranche 2.0 — Dev pipeline documentation (docs-only)

Per reconciliation R1 + 5-agent review (2026-05-25). Scoped DRAMATICALLY DOWN after independent review unanimously flagged the original "lock 13 placeholder deps + prebuild --clean" approach as a build-pipeline footgun. **Tranche 2.0 ships only docs + helper scripts.** Native-dependency installs happen just-in-time inside the feature tranche that needs them.

### Status table

| Sub-item | Frontend | Backend | Notes |
|---|---|---|---|
| **0.1** Create `my-app/instruction-to-run-the-app.md` | ✅ | n/a | Created 2026-05-25. Documents prereqs (Node ≥20, JDK 17, Android Studio + AVD, **backend port 4000**), first-time setup with `.env.local` containing `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000`, day-to-day flow, when to re-prebuild, top 5 gotchas, deferred-work pointer. |
| **0.2** Add `§7.5 Build pipeline` subsection to `my-app/CLAUDE.md` | ✅ | n/a | Inserted 2026-05-25 between §7 and §8. Codifies: Expo Go deprecated; local dev = Android dev-client only on Windows; `my-app/android/` gitignored per CNG; EAS + iOS deferred to Tranche 2.I; troubleshooting points to K1–K10 knowledge base. §8 commands block updated to add the 3 new scripts. |
| **0.3** Add 3 helper npm scripts to `my-app/package.json` | ✅ | n/a | Added 2026-05-25: `prebuild:android` (= `expo prebuild --platform android --clean`), `dev:android` (= `expo run:android`), `dev:start` (= `expo start --dev-client`). Scripts are LATENT — Tranche 2.0 itself does not run them; first invocation is from Tranche 2.C/2.D when actual native deps land. |
| **0.4** Update root `CLAUDE.md` status snapshot | ✅ | n/a | Updated 2026-05-25 with the Tranche 2.0 one-liner pointing at this BRD + the K1–K10 knowledge base. |

### Files touched (4 total)

- `my-app/instruction-to-run-the-app.md` — NEW file (~150 lines)
- `my-app/CLAUDE.md` — EDIT. Add `§7.5 Build pipeline` subsection (between existing §7 and §8). Lightly clarify §8 commands.
- `my-app/package.json` — EDIT. Add 3 scripts to the `scripts` block. No dep changes.
- `CLAUDE.md` (root) — EDIT. One-liner in status snapshot.

### Files explicitly NOT touched in this tranche

- `my-app/app.json` — no plugin changes, no bundle IDs, no runtimeVersion, no maps keys
- `my-app/android/` — not regenerated; CNG pattern (see Knowledge-base item K7)
- `my-app/ios/` — not created
- `my-app/eas.json` — left alone
- `my-app/.env.local` — created BY THE FOUNDER on their machine (documented in `instruction-to-run-the-app.md`); NOT committed
- Any new native dependencies — deferred to per-feature tranches
- Any backend files — Tranche 2.0 is mobile-docs-only

### Verification

1. `my-app/instruction-to-run-the-app.md` exists; sections cover prereqs, first-time setup, `.env.local`, day-to-day, re-prebuild rules, top 5 gotchas
2. `my-app/CLAUDE.md` §7.5 Build pipeline subsection is present and renders cleanly
3. `my-app/package.json` has the 3 new scripts and `npm install` (no-op for this PR) succeeds
4. Root `CLAUDE.md` status snapshot has the Tranche 2.0 one-liner
5. **Smoke check (optional but recommended)**: the founder runs `npm run dev:start` once; existing emulator dev build connects; existing chat opens. This validates the new scripts work but is NOT gated on this PR.

### Knowledge base for future native-dep tranches

The 5-agent review surfaced concerns that DON'T belong in Tranche 2.0 but MUST be addressed before specific later tranches. Captured here as a checklist; each item gates the tranche it's tagged for.

| K# | Concern | Gating tranche | Action when that tranche begins |
|---|---|---|---|
| **K1** | MultiDex not enabled in `android/app/build.gradle`. >2 new native modules will exceed 64K methods → D8 build fails. | First tranche to add ≥2 native deps (likely 2.D) | Add `multiDexEnabled true` to `android.defaultConfig` in `app/build.gradle`. |
| **K2** | Gradle JVM heap = 2GB (`gradle.properties` line 13). WebRTC + 4-ABI compile will OOM during 100ms/LiveKit native build. | 2.H/2.I | Bump `org.gradle.jvmargs=-Xmx4096m`. |
| **K3** | 4 ABIs enabled (`armeabi-v7a, arm64-v8a, x86, x86_64`). First Gradle build with WebRTC will be 30–60 min. | Any native-dep tranche | Restrict dev ABIs to `arm64-v8a, x86_64` for the development profile. Production keeps all 4. |
| **K4** | `react-native-maps` requires `GOOGLE_MAPS_API_KEY` in `app.json` (`expo.android.config.googleMaps.apiKey`) BEFORE Gradle manifest-merger. Without it, app crashes on first map screen. | 2.D | Add the key (gated behind env var). For dev, a dummy `AIza...invalid` literal in `app.json` lets the manifest merge; runtime crash only happens if a map is actually rendered. |
| **K5** | 100ms + `expo-audio` collide on `AudioManager.MODE_IN_COMMUNICATION` + AudioFocus. Voice-note playback may route through earpiece after a call session. | 2.I | Add audio-focus coordination: pause/resume any `expo-audio` players on `call:accepted` and restore on `call:ended`. |
| **K6** | `@100mslive/*` and `@livekit/react-native` BOTH ship `libwebrtc.so`. Locking both = `Duplicate jniLibs` Gradle error. | 2.H | Pick ONE before installing. POC compares them on a throwaway branch BEFORE the 2.H PR begins. |
| **K7** | `my-app/android/` exists on disk but is NOT in git (`git ls-files` returns 0 files). This is correct for Continuous Native Generation (CNG) projects. | All tranches | Confirm CNG intent. Add `my-app/android/` to `.gitignore` explicitly. All native config must live in `app.json` plugins — never edit `android/` files directly. |
| **K8** | Backend runs on **port 4000** (`api-client.ts:52`), not 3000. Android emulator can't reach `localhost` — must use `10.0.2.2:4000`. | Any tranche where mobile + backend co-test | `my-app/.env.local` (per-developer, not committed) with `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000`. Documented in `instruction-to-run-the-app.md` from Tranche 2.0. |
| **K9** | newArch + Fabric is enabled (`gradle.properties:38`). `react-native-maps` must be ≥2.0 for Fabric compatibility, else white-screen on `<MapView>`. | 2.D | Before installing, run `npm info react-native-maps@latest` and confirm v2+. Document the pinned version in the 2.D PR. |
| **K10** | First-build time on Windows with new native deps + WebRTC + 4-ABI is 20–45 min cold. Founder may Ctrl-C thinking it's hung. | Any native-dep tranche | Document in `instruction-to-run-the-app.md`: "First build after a new native dep takes 20–45 min on Windows. Don't kill it." Bump heap (K2) and restrict ABIs (K3) to shrink this. |
| **K12** | **R2 media delete MUST ref-count `forwardedFromMessageId` chains.** Forwarding a DOCUMENT/IMAGE/VIDEO (Tranche 2.E) clones `mediaObjectKey` → two messages reference one R2 object. A naive future "delete object on message delete" worker would orphan/delete media still referenced by a forwarded copy (cross-chat data loss). | The R2 orphan-cleanup BRD/worker (deferred) | Before unlinking any R2 object on message delete, check no other non-deleted message references the same `mediaObjectKey` (or walk `forwardedFromMessageId` chains). Surfaced by the 2.E 3-agent review. |
| **K11** | **Installing a dep from inside a workspace de-hoists `expo-router`.** Running `npm install <pkg>` from `my-app/` (instead of repo root) can pull `expo-router` down into `my-app/node_modules`, out of root `node_modules`. The root-level `@expo/cli` (which runs typed-routes generation) then can't resolve `expo-router/_ctx-shared` and `expo start` **crashes** with `Cannot find module 'expo-router/_ctx-shared'` (exit 7) right after "Logs for your project will appear below". Surfaced 2026-05-25 during Tranche 2.A's `rn-emoji-keyboard` install. | Every tranche that adds a dep | **Always `npm install` from the repo ROOT, never from `my-app/`** — root installs re-hoist the whole workspace graph correctly. If a crash happens: stop the backend (frees the Prisma query-engine DLL lock that otherwise EPERM-fails `prisma generate` postinstall), then `npm install` from root for a clean re-hoist. Quick unblock (non-durable): `cp -r my-app/node_modules/expo-router node_modules/expo-router`. |
| **K13** | **`expo-audio` `useAudioPlayer` auto-releases its native player on unmount AND on `[player]` identity change.** Calling `player.pause()` (or any method) in a bare `useEffect` cleanup runs *after* that release → `"Cannot use shared object that was already released"` → uncaught in `commitHookEffectListUnmount` → **white-screens the whole app**. Triggers in any thread with voice notes when a playing bubble is recycled by the FlatList or a keyboard relayout unmounts it; also fires when an optimistic voice row reconciles to its real `mediaUrl` (the `[player]` dep changes). Surfaced 2026-05-26 during emulator QA. | Any tranche touching `expo-audio`/`expo-video` players in list rows (e.g. 2.I call audio) | Never call a player method in a bare cleanup effect — wrap in `try { player.pause(); } catch {}` (the same guard `video-viewer.tsx` already uses for the analogous expo-video teardown crash). Fixed in `voice-player.tsx` 2026-05-26. Prefer conditional-mount over per-row long-lived players where feasible. |

These items are an executable checklist — when the gating tranche begins, the implementing PR addresses its row before introducing the dep.

---

## Tranche map

| # | Name | Slice | Backend | Frontend | Migration | Depends on |
|---|---|---|---|---|---|---|
| **2.0** | Dev pipeline documentation | `instruction-to-run-the-app.md` + `my-app/CLAUDE.md` §7.5 + 3 helper npm scripts + Knowledge base K1–K10. **Docs-only; zero native deps installed.** ✅ LANDED 2026-05-25 (`e70ce46`). | n/a | ✅ | — | — |
| **2.A** | Reactions mobile UI | ✅ **LANDED 2026-05-25** (`c23365f` + mock follow-up). reactions strip + pill row + `rn-emoji-keyboard` picker + socket `reaction:updated` sync + optimistic add/remove (api + mock repos). QA-passed on Android emulator: strip renders, picker opens + themed, emoji-select → pill renders. | none | ✅ | — | 2.0 |
| **2.B** | Schema foundation | ✅ **LANDED 2026-05-25**. `MessageKind` +7 values, 16 nullable `Message` columns (Migration A), `MediaService` DOCUMENT/VIDEO, discriminated-union send validators, `SERVER_ONLY_KINDS` guard. 26/26 e2e green. | ✅ | none | A | 2.0 |
| **2.E** | Forward + Pin (+ ~~Message Info~~ deferred) | **Split by layer, then front re-split — all shipped.** 2.E-back ✅, 2.E-front-forward ✅, 2.E-front-pin (Pin/Unpin rows + optimistic + socket + bubble pip) ✅ — all **LANDED 2026-05-25**. Pinned strip + Message-Info deferred. **Tranche 2.E COMPLETE.** | ✅ | ✅ | — | 2.B |
| **2.H** | Calls signalling (server) | `CallSession` table + 100ms-or-LiveKit-Cloud client + ring/accept/decline/hangup REST + webhook + **`user:{userId}` socket room** + **BullMQ ring-timeout** | ✅ | none | C | 2.B + POC complete |
| **2.I** | Call UI + push wakeup + **EAS migration** | `UserDevice` table + push module + CallScreen + IncomingCallScreen + provider SDK install + **first tranche to require EAS Build** (push wakeup + calls can't be tested on emulator alone) | ✅ | ✅ | D | 2.H + EAS + Apple Dev account |
| **2.C** | Document + Video kinds | ✅ **LANDED 2026-05-25**. Combined Gallery (photos+videos) + Document picker + DocumentBubble + VideoBubble + full-screen VideoViewer; client `validateMediaPick` guard; first native-dep prebuild (expo-document-picker + expo-video). +2 VIDEO e2e (33 green), +18 mobile tests (71). | ✅ (extends 2.B) | ✅ | — | 2.B |
| **2.D** | Location + Contact-card kinds | ✅ **LANDED 2026-05-25**. Coords/place-name LocationCard tile (expo-location, no maps API key) + privacy confirm; ContactCard via InfoCardBubble + `chat/pick-contact.tsx` (expo-contacts/legacy, toE164Loose). One native-dep prebuild (expo-location). +6 mobile tests (77); no new e2e. | ✅ (extends 2.B) | ✅ | — | 2.B |
| **2.F** | Polls (1-on-1) | PollMessage/PollOption/PollVote tables + module + bubble + composer | ✅ | ✅ | B | 2.B |
| ~~**2.G**~~ | ~~Scheduled-send~~ | **Deferred to v1.1 BRD per R2.** | — | — | — | — |

**Recommended order**: **2.0** (prerequisite — docs-only) → **2.A ∥ 2.B** (parallel branches; 2.A is frontend-only, 2.B is backend-only) → **2.E** (REST-light; lower native-deps risk) → **2.H** (after a 1-day LiveKit-Cloud-vs-100ms POC) → **2.I** (paired with 2.H for the headline ship + **migrates the project to EAS Build at this point**) → **2.C** → **2.D** → **2.F**.

**Key reordering rationale**: calls (2.H + 2.I) are the headline differentiator for an India-first chat app; they ship in the middle of the slice rather than at the end so the headline feature is in users' hands before low-value attachments and polls. Migration A still ships in 2.B — no reason to gate the schema foundation on the calls POC.

**Build pipeline progression**:
- Tranches 2.0 → 2.H: local Android dev-client only (Windows + Android Studio emulator). **No EAS spend.** Founder iterates fast on a single machine.
- Tranche 2.I: EAS Build pipeline gets set up here (Apple Developer enrollment + EAS profiles + first remote build) since the call slice needs real-device testing.
- Tranches after 2.I: continue on local Android for fast iteration; cross-build on EAS when changes touch native code.

---

## Tranche 2.A — Reactions mobile UI

### Status table

| Sub-item | Frontend | Backend | Notes |
|---|---|---|---|
| **A.1** Reactions strip on long-press | ✅ | n/a | `reactions-strip.tsx` — emojis `😅 👍 😆 😍 ❤️ 💯 🙏` + plus chip; rendered above the MessageActionSheet rows. QA-verified on emulator. |
| **A.2** Emoji picker modal | ✅ | n/a | `emoji-picker-modal.tsx` wrapping `rn-emoji-keyboard@^1.7.0` (pure JS, Expo-Go-compatible); dark theme. QA-verified: opens from + chip, themed correctly, emoji-select fires. |
| **A.3** Reactions pill row under bubbles | ✅ | n/a | `reactions-pill-row.tsx` consumes `message.reactions: ReactionAggregate[]` (now carried through `dto-to-message.ts` + `types.ts`). QA-verified: pill `😀 1` renders below bubble after select. |
| **A.4** Socket sync via `reaction:updated` | ✅ | ✅ already broadcasts | `chatSocket.onReactionUpdated` listener added; `api-chat-repository.ts` splices fresh aggregate into the cached message. |
| **A.5** Optimistic add/remove + revert on failure | ✅ | ✅ POST/DELETE shipped | `addReaction`/`removeReaction` on both api + mock repos; optimistic `bumpReactionLocally` with restore-on-failure. Mirrors image/voice optimistic-send pattern. |
| **A.6** Mock-repo + seed support | ✅ | n/a | `mock-chat-repository.ts` implements add/remove via `mutateReaction`; `seed.ts` seeds reactions on 2 messages so the pill row renders in offline dev mode (CLAUDE.md §3 frontend-first flow). |

### Files touched

**Frontend (`my-app/`)**

- `src/features/chat/components/reactions-strip.tsx` — NEW. Horizontal row of 7 emoji chips + plus-icon. Renders inside `MessageActionSheet`. Tap → `onReact(emoji)` + sheet closes.
- `src/features/chat/components/reactions-pill-row.tsx` — NEW. Reads `message.reactions[]`; renders one pill per `{emoji, count}`; pill bg darkens when `reactedByMe`. Tap toggles.
- `src/features/chat/components/emoji-picker-modal.tsx` — NEW. Slide-up `<Modal>` wrapping `rn-emoji-keyboard`. Triggered by plus-icon in strip.
- `src/features/chat/components/message-action-sheet.tsx` — EDIT. Restructure modal content: `<ReactionsStrip>` rendered above the existing action rows.
- `src/features/chat/components/message-bubble.tsx` — EDIT. After meta row, render `<ReactionsPillRow message={...} />` when `message.reactions.length > 0`.
- `src/features/chat/data/api-chat-repository.ts` — EDIT. In `ensureSocketWired()`, subscribe to `chatSocket.onReactionUpdated`. Mutate the cached `message.reactions` and notify.
- `src/features/chat/data/chat-repository.ts` — EDIT. Add `addReaction(messageId, emoji)` / `removeReaction(messageId, emoji)` methods.
- `src/lib/chat-socket.ts` — EDIT. Add `onReactionUpdated(cb)` listener for `'reaction:updated'`.

**Tests**

- `src/features/chat/components/__tests__/reactions-pill-row.test.tsx` — snapshot + toggle.
- `src/features/chat/components/__tests__/reactions-strip.test.tsx` — render + plus-tap opens picker.

### Dependencies to install

```bash
npm --workspace=my-app install rn-emoji-keyboard
```

(Pure JS, no native deps; works under Expo Go.)

---

## Tranche 2.B — Schema foundation (Migration A)

Backend-only foundation. No mobile UI changes. Unlocks 2.C–2.G.

### Status table

| Sub-item | Frontend | Backend | Notes |
|---|---|---|---|
| **B.1** Migration A — `MessageKind` enum expansion + media columns | n/a | ✅ | `20260525211223_expand_message_kind_and_media_fields`: 7 enum values + 16 nullable columns + 2 indexes + 2 FKs. Applied to dev (`public`) + `test_e2e`. |
| **B.2** `MediaService` extended to DOCUMENT + VIDEO | n/a | ✅ | `EXT_BY_CONTENT_TYPE` + `VALID_EXTS_BY_KIND` extended; size-cap if/else generalized to a per-kind `CONTENT_RULES` map (IMAGE 10MB / VOICE 5MB / DOCUMENT 100MB / VIDEO 80MB). |
| **B.3** `SendMessageSchema` discriminated-union per-kind validators | n/a | ✅ | `superRefine` branches for DOCUMENT, VIDEO, LOCATION, CONTACT_CARD; `MediaUploadRequestSchema` per-kind `MEDIA_RULES`. |
| **B.4** `messagesService.send` persists per-kind columns | n/a | ✅ | Kind-switch extended; `MEDIA_BACKED_KINDS` drives `validateObjectKey`; create-data writes all per-kind columns; `rowToDto` + `MessageDto` carry them. |
| **B.5** `SERVER_ONLY_KINDS` guard | n/a | ✅ | `SERVER_ONLY_KINDS` Set (`SYSTEM/POLL/CALL_EVENT/LOCATION_LIVE`) rejected in both the shared zod schema AND `messages.service` (defence-in-depth) with `kind_not_allowed_from_client`. |
| **B.6** e2e + test-harness fix | n/a | ✅ | 5 new e2e cases (DOCUMENT persist + no-mime 400, LOCATION ok + out-of-range 400, CONTACT_CARD ok + bad-E.164 400, server-only kinds 400). Fixed `jest-e2e.config.js` `maxWorkers: 1` — the 2-suite parallel run was deadlocking on the shared `test_e2e` TRUNCATE. 26/26 e2e green. |

### Migration A — `20260526000000_expand_message_kind_and_media_fields`

**File**: `apps/api/prisma/migrations/20260526000000_expand_message_kind_and_media_fields/migration.sql`

Adds to `MessageKind` enum (Postgres `ALTER TYPE ... ADD VALUE`, one per statement, run outside a transaction): `DOCUMENT`, `VIDEO`, `LOCATION`, `LOCATION_LIVE`, `CONTACT_CARD`, `POLL`, `CALL_EVENT`. (Trimmed per R7: `SCHEDULED` and `POLL_VOTE` removed — Scheduled-send deferred to v1.1; POLL_VOTE was deferred Phase D server-only kind not needed.)

Adds to `Message` table (all nullable; no backfill needed):

| Column | Type | Used by |
|---|---|---|
| `mediaMimeType` | `VARCHAR(80)` | DOCUMENT, VIDEO |
| `videoDurationSec` | `INT` | VIDEO |
| `videoWidth` | `INT` | VIDEO |
| `videoHeight` | `INT` | VIDEO |
| `latitude` | `DOUBLE PRECISION` | LOCATION, LOCATION_LIVE |
| `longitude` | `DOUBLE PRECISION` | LOCATION, LOCATION_LIVE |
| `locationName` | `VARCHAR(120)` | LOCATION |
| `liveLocationExpiresAt` | `TIMESTAMPTZ` | LOCATION_LIVE (future) |
| `contactName` | `VARCHAR(120)` | CONTACT_CARD |
| `contactPhoneE164` | `VARCHAR(20)` | CONTACT_CARD |
| `documentTitle` | `VARCHAR(255)` | DOCUMENT |
| `documentSizeBytes` | `BIGINT` | DOCUMENT |
| `forwardedFromMessageId` | `UUID NULL` (FK → `messages.id` ON DELETE SET NULL) | forwarded |
| `forwardCount` | `INT NOT NULL DEFAULT 0` | origin of any forward |
| `pinnedAt` | `TIMESTAMPTZ` | pinned messages |
| `pinnedByUserId` | `UUID NULL` (FK → `users.id` ON DELETE SET NULL) | pinned messages |

(`scheduledForAt` and `scheduledStatus` columns removed per R7 alongside the deferred Scheduled-send slice.)

Adds indexes:

- `CREATE INDEX messages_forwarded_from_idx ON messages(forwardedFromMessageId) WHERE forwardedFromMessageId IS NOT NULL;`
- `CREATE INDEX messages_pinned_per_chat_idx ON messages(chatId, pinnedAt DESC) WHERE pinnedAt IS NOT NULL;`

(Trimmed per R7: the `messages_scheduled_pending_idx` partial index is removed alongside the deferred Scheduled-send slice.)

### Media service expansion

**File**: `apps/api/src/modules/media/media.service.ts`

Extend `EXT_BY_CONTENT_TYPE` (lines 26-32):

```ts
'application/pdf': 'pdf',
'application/msword': 'doc',
'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
'application/vnd.ms-excel': 'xls',
'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
'application/vnd.ms-powerpoint': 'ppt',
'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
'text/csv': 'csv',
'application/zip': 'zip',
'video/mp4': 'mp4',
'video/quicktime': 'mov',
'video/webm': 'webm',
```

Extend `VALID_EXTS_BY_KIND` (line 35):

```ts
DOCUMENT: ['pdf','doc','docx','xls','xlsx','ppt','pptx','csv','zip'],
VIDEO: ['mp4','mov','webm'],
```

Replace the per-kind size-cap if/else ladder at lines 184-216 with a single map: `IMAGE: 10MB, VOICE: 5MB, DOCUMENT: 100MB, VIDEO: 80MB`. The `assertContentTypeAndSize()` becomes a generic allowlist check.

### Shared schema deltas

**File**: `packages/shared/src/schemas/media.ts`

- `MediaUploadKindEnum`: `['IMAGE','VOICE']` → `['IMAGE','VOICE','DOCUMENT','VIDEO']`.
- Add `DOCUMENT_MAX_BYTES = 100 * 1024 * 1024`, `VIDEO_MAX_BYTES = 80 * 1024 * 1024`.
- `MediaUploadRequestSchema.superRefine` gains DOCUMENT + VIDEO branches.

**File**: `packages/shared/src/schemas/messages.ts`

- Extend `MessageKindEnum`.
- Extend `SendMessageSchema` with new optional fields (per Migration A column list).
- Add discriminated `superRefine` cases:
  - `DOCUMENT`: requires `mediaObjectKey + mediaMimeType + documentTitle + documentSizeBytes`.
  - `VIDEO`: requires `mediaObjectKey + mediaMimeType + videoDurationSec + videoWidth + videoHeight`.
  - `LOCATION`: requires `latitude + longitude` in `[-90,90]` / `[-180,180]`. `locationName` optional.
  - `CONTACT_CARD`: requires `contactName + contactPhoneE164` (E.164 regex).
  - **Server-only kinds** (`POLL`, `CALL_EVENT`, `LOCATION_LIVE`): defined as `SERVER_ONLY_KINDS` Set; `SendMessageSchema.superRefine` rejects them with `kind_not_allowed_from_client`. (Trimmed per R7: `POLL_VOTE` and `SCHEDULED` removed alongside deferred slices.)

### Messages service kind-switch

**File**: `apps/api/src/modules/messages/messages.service.ts`

Extend the validator block at lines 357-372 — `body.kind === 'IMAGE' || body.kind === 'VOICE'` becomes `['IMAGE','VOICE','DOCUMENT','VIDEO'].includes(body.kind)` so all four kinds hit `media.validateObjectKey({ userId, objectKey, kind })`.

Extend the `prisma.message.create` data block at lines 394-410 to persist per-kind columns. Refactor into a `kindToColumns(body)` helper to keep `send()` readable.

### E2e tests added

- `presign returns DOCUMENT key with valid PDF`
- `presign returns VIDEO key with valid mp4`
- `send DOCUMENT happy path with title persisted`
- `send DOCUMENT bad MIME 400`
- `send VIDEO mismatched ext 400`
- `send LOCATION out-of-range lat 400`
- `send CONTACT_CARD non-E.164 phone 400`
- `client-supplied POLL kind rejected 400 kind_not_allowed_from_client`

---

## Tranche 2.C — Document + Video message kinds — ✅ LANDED 2026-05-25

Builds on 2.B's foundation. **First tranche to add new native deps** (`expo-document-picker` + `expo-video`) — so it required a prebuild + dev-client rebuild (the gate). Reshaped by a 5-agent review (the plan below supersedes the original C.1–C.7 sketch). **QA'd on the Android emulator** (mock mode, rebuilt client): attach sheet → Document tile enabled + picker opens; both bubbles render correctly (DocumentBubble icon+name+size; VideoBubble aspect tile + play + duration pill); coexists with forwarded label / pin pip / reactions; chat-list shows "📹 Video".

### Status table (as shipped)

| Sub-item | Frontend | Backend | Notes |
|---|---|---|---|
| ~~**C.1** Composer camera-shortcut~~ | ✂️ CUT | n/a | Replaced by ONE combined **Gallery** tile (`mediaTypes:['images','videos']`) branching on `asset.type` — less sheet crowding than a separate video entry. |
| **C.2** AttachSheet — Document tile wired | ✅ | n/a | `disabled` removed; `onPickDocument` prop. Gallery now covers photos + videos. |
| **C.3** `expo-document-picker` integration | ✅ | n/a | `getDocumentAsync` (v56 `{canceled, assets:[{uri,name,size,mimeType}]}`) → **`validateMediaPick` guard** (mime allowlist + size>0 + ≤cap, mime-from-ext fallback, filename ≤255) → presign → send DOCUMENT. |
| **C.4** DocumentBubble | ✅ | n/a | `document-bubble.tsx` — `file-text` icon + name + `formatFileSize`; rendered INSIDE the standard bubble (type-dispatch, like VoicePlayer) so it inherits reply/forward/pin/reaction chrome. Tap → `expo-web-browser` (already a dep), gated on durable status. |
| **C.5** VideoBubble | ✅ | n/a | `video-bubble.tsx` — folded into the IMAGE early-return; polished tile (aspect box + play button + duration pill), **no list-mounted player**. Video picking reuses installed `expo-image-picker` (no new dep). |
| **C.6** Full-screen video player | ✅ | n/a | `video-viewer.tsx` — `expo-video` `useVideoPlayer`/`VideoView`, mounted ONLY while open (no N-players-in-FlatList), pause-before-close teardown. |
| ~~**C.7** Document download + share~~ | ⏸ DEFERRED | n/a | v1 opens via `expo-web-browser` (in-app browser, no new dep). `expo-sharing`/download deferred. **Real video poster frames** also deferred (needs a backend thumbnail object; on-device remote-URL extraction is unreliable). |

### Native deps (the gate)

```bash
# from repo ROOT (K11), then prebuild:android + dev:android
npm install expo-document-picker expo-video expo-build-properties
```
- `expo-document-picker` + `expo-video` = the two new native modules; `expo-build-properties` is a config-only plugin (reserved for 2.H WebRTC heap — no 2.C config needed). **No `expo-video-thumbnails`, no `expo-sharing`.**
- **MultiDex (K1) was moot**: RN 0.85 / SDK 56 `minSdkVersion` 24 → MultiDex auto-on (≥21). The prebuild + first `expo run:android` succeeded on Windows; dev client booted with the new modules (Step-0 gate passed). The K11 expo-router de-hoist is now durably fixed by the root `postinstall` junction script.

### E2e tests added

- `send VIDEO persists dims + duration and round-trips` (happy path)
- `send VIDEO missing videoWidth → 400` (validator)

(33 e2e green. The original 413/echo sketch was dropped — the server enforces size at the `/media/upload-url` step, not on send.)

### Helpers / Jest

- `lib/media-pick.ts` (`validateMediaPick` + `resolveMime` + `truncateFileName`) + `lib/format-size.ts` (`formatFileSize`) — pure, Jest-tested (allowlist/cap injected by the caller so the Jest graph never value-imports `@scalechat/shared`). 71 mobile tests green (+18).

---

## Tranche 2.D — Location + Contact-card message kinds — ✅ LANDED 2026-05-25

Reshaped by a 5-agent review (this supersedes the original react-native-maps / static-map / server-`locationPreviewUrl` sketch — **all abandoned**). Both kinds are **non-media** (no R2 upload). **QA'd on the Android emulator** (mock, rebuilt client): both cards render + coexist with the 2.C bubbles; chat-list previews; attach sheet shows Contact + Location enabled; the Location privacy-confirm Alert fires.

### Status table (as shipped)

| Sub-item | Frontend | Backend | Notes |
|---|---|---|---|
| **D.1** AttachSheet — Location + Contact tiles wired | ✅ | n/a | Both un-disabled; `onPickLocation`/`onPickContact` props. |
| **D.2** Location handler | ✅ | n/a | `[id].tsx handlePickLocation`: **privacy confirm** → `expo-location` permission → `getCurrentPositionAsync` (raced against a timeout + `getLastKnownPositionAsync` fallback — no AVD hang) → best-effort `reverseGeocodeAsync` (omit blank name; server `min(1)`). |
| **D.3** `LocationCard` | ✅ | n/a | A deliberate **tile** (faux-map `expo-linear-gradient` band + pin + place name + "Open in Maps"). **No react-native-maps / no Maps API key** (dummy-key path crashes the AVD). Tap → universal `https://www.google.com/maps/search/?api=1&query=…` (not the iOS-broken `geo:`). |
| **D.4** `chat/pick-contact.tsx` | ✅ | n/a | Modal route (forward.tsx scaffold). `expo-contacts/legacy` (root throws in SDK 56), searchable list, per-row sendability via `toE164Loose` (libphonenumber-js — NOT the India-only `toE164India`), unsendable rows **disabled**, name fallback + ≤120 truncate. Sends via the repo directly (no `useThread`). |
| **D.5** `ContactCard` | ✅ | n/a | Reuses the new `InfoCardBubble` (person icon + name + **formatted** number, not raw E.164); tap → `tel:`. |
| ~~**D.6** Static-map preview URL emission~~ | — | ✂️ CUT | Needs a Google Static Maps API key; deferred with react-native-maps. The coords/place-name tile needs no server change. |

### Reuse + shared

- **`InfoCardBubble`** (NEW) — shared row-card primitive (icon + title + subtitle + tap); `DocumentBubble` migrated onto it + ContactCard uses it (per-side colors centralized, was hard-coded in 2.C). LocationCard is bespoke (a tile, not a row).
- **`lib/phone.ts` `toE164Loose`** (NEW) — gated on the server E.164 regex; preserves already-international numbers, defaults bare numbers to IN. `lib/media-pick.ts` patterns reused conceptually.
- Send-path: `api`+`mock` `sendMessage` got explicit location/contact arms BEFORE the trailing VIDEO `else` (the 3-site `!== 'text'` trap); `tombstoneContent` per-kind arms.

### Native deps

```bash
npm install expo-location   # from repo ROOT (K11) — ONLY new native dep; expo-contacts already installed (PR 6)
```
app.json: `["expo-location", { "locationWhenInUsePermission": "…" }]` (foreground only). MultiDex moot (minSdk 24). Prebuild + `dev:android` rebuilt the client; booted with expo-location (Step-0 gate passed).

### Tests

- No new backend e2e (2.B's LOCATION + CONTACT_CARD happy + 400 cases cover the contract; 2.D ships no backend code).
- Mobile: `dto-to-message` LOCATION/CONTACT_CARD round-trip + `toE164Loose` unit tests. **77 mobile Jest green** (+6).

Plus `android.config.googleMaps.apiKey` + `ios.config.googleMapsApiKey` (or fallback to Apple Maps on iOS — decide per Open Question Q7).

### E2e tests added

- `send LOCATION happy path persists lat/lng/name`
- `send LOCATION out-of-range 400`
- `send CONTACT_CARD persists name + E.164`
- `send CONTACT_CARD invalid phone 400`

---

## Tranche 2.E — Forward + Pin + Message Info

> **Split + scoped by a 3-agent review (2026-05-25).** This tranche is delivered by LAYER: **2.E-back** (backend, ✅ LANDED 2026-05-25) and **2.E-front** (mobile UI). **Message-Info is DEFERRED entirely** — read *status* only (no `readAt` in the model) duplicates the existing lime read-tick; revisit when a real read-time exists. Forward cap is 20 server-side (the old BRD "5" was a frontend UI cap → 2.E-front decides its own).
>
> **2.E-front re-split by a 5-agent review (2026-05-25).** A 5-agent review of the mobile plan converged on three structural changes, so **2.E-front ships in two PRs**: **2.E-front-forward** (Forward UI — ✅ **LANDED 2026-05-25**) and **2.E-front-pin** (Pin UI — pending). Three review fixes baked in: (1) **single-select** forward, not multi-select — the old multi-select + checkbox + skipped-count UI was group-era machinery in a group-less v1; (2) **stay-in-source + inline "Sent ✓"** confirmation, NOT `router.replace`-to-destination (jarring) or a blocking `Alert`; (3) the **pinned strip is deferred** — its cache-derivation was structurally broken (pins scroll out of the loaded window → the `if(at<0) return` socket-unpin subscriber no-ops → stale ghost pin, and mock mode masks it by returning the full list). When Pin ships, pinned state shows via a **bubble `bookmark` pip** (a strip, if ever, uses re-fetch-on-event, never cache-derivation). Two icon/nav bugs the review caught: `pin` is not a Feather glyph (use `bookmark`); `router.push` params must be object-form `{ pathname, params }`, not positional.

### Status table

| Sub-item | Frontend | Backend | Notes |
|---|---|---|---|
| **E.1** `ForwardModule` | n/a | ✅ | `POST /messages/:id/forward { targetChatIds[1..20] }`. Per-target partial success (`items` + `skipped`); deterministic hashed `clientMessageId` (`fwd_`+sha256 — fits VarChar(64)); blocks tombstone + server-only kinds; `forwardCount` bumps only on newly-created copies; clones content + drops `replyToMessageId`. |
| **E.2** ForwardPickerScreen | ✅ (2.E-front-forward, 2026-05-25) | n/a | **Sibling** `chat/forward.tsx` (modal, `slide_from_bottom`) — NOT nested/`(modals)` — so dismiss returns to the source thread mounted underneath. **Single-select** (no multi/checkbox/cap); tap a chat → `forwardMessage(id,[targetId])` → inline lime "Sent ✓" → auto-dismiss back to source (no destination-jump, no Alert). Reuses `Avatar` via a lightweight `forward-picker-row.tsx`. Source thread excluded from the list. |
| **E.3** `PinModule` | n/a | ✅ | `PATCH/DELETE /chats/:chatId/messages/:id/pin` + `GET /chats/:chatId/pins`. Cross-chat guard (404 `message_not_in_chat`). |
| **E.4** Pin cap (3 per chat) | n/a | ✅ | Count+update under `pg_advisory_xact_lock(chatId)` (race-safe); 4th → 409 `pin_cap_exceeded`. |
| **E.5** PinnedMessageStrip component | ⏸ DEFERRED | n/a | **Cut by a 5-agent review.** Cache-derivation was structurally broken (pins scroll out of the loaded window → the `if(at<0) return` socket subscriber no-ops → stale ghost pin; mock masks it). If ever built, use **re-fetch-on-event** (`listPins` on mount + on pin/unpin socket events), never cache-derivation. Pinned state ships via the bubble pip (E.11) instead. |
| **E.6** Socket events `message:pinned` / `message:unpinned` | n/a | ✅ | `emitMessagePinned`/`emitMessageUnpinned` broadcast to `chat:{chatId}`. |
| ~~**E.7** `GET /messages/:id/info`~~ | — | ⏸ DEFERRED | Read-status-only duplicates the read-tick; no `readAt` timestamp in the model. Revisit later. |
| ~~**E.8** MessageInfoScreen~~ | — | — | Deferred with E.7. |
| **E.9a** MessageActionSheet — Forward row | ✅ (2.E-front-forward, 2026-05-25) | n/a | Forward row (`corner-up-right`) after Reply on every non-tombstone bubble; string in `ChatCopy.forward`. |
| **E.9b** MessageActionSheet — Pin/Unpin rows | ✅ (2.E-front-pin, 2026-05-25) | n/a | Pin/Unpin toggle row (`bookmark`) after Reply (WhatsApp order: Reply/Pin/Forward/Copy/…), on mine + theirs. **Durable-status gate** added to Pin AND the existing Forward row (optimistic row's id == clientMessageId → would 404). Message Info row dropped (deferred). |
| **E.10** "↪ Forwarded" bubble label | ✅ (2.E-front-forward, 2026-05-25) | n/a | Rendered when `forwardedFromMessageId` set, in both bubble branches; colour forks per side (mine white-alpha / theirs `chatHeaderTop` / image grey-on-black). `forwardMessage` plumbed through `ChatRepository` (api `POST /messages/:id/forward`; mock clones + drops reply/reactions + `persist()`). `forwardedFromMessageId`/`forwardCount`/`pinnedAt` added to `MessageBase` + `dtoToMessage` (+ 3 Jest cases). |
| **E.11** Bubble pin pip | ✅ (2.E-front-pin, 2026-05-25) | n/a | `PinPip` helper — grey `bookmark` (NOT lime — `chatActionLime` == `chatReadTick` hex, would read as a false 3rd tick) in the meta row, gated on `pinnedAt != null && deletedAt == null` (no pip on a tombstone), placed away from the ticks (leading on theirs, trailing on mine). `pinMessage`/`unpinMessage` on `ChatRepository`: api optimistic single-field flip + **exact** `pinnedAt` rollback + single-field reconcile; socket `onMessagePinned`/`onMessageUnpinned` (unpinned hard-sets `null`); mock flips + `persist()` + **fakes the 3-cap** (`pin_cap_exceeded`) so the cap→rollback→Alert path is emulator-testable. `MAX_PINNED_PER_CHAT` passed to `ChatCopy.pin.capBody(max)` from `[id].tsx` (kept out of `copy.ts` so the Jest graph never runtime-requires `@scalechat/shared`). **QA'd on the emulator** (mock): Pin row → optimistic pip → toggle Unpin → pip clears, multi-pin. Strip (E.5) deferred — Pin is a marker, not user-complete until an aggregated view lands. |

### New module — `apps/api/src/modules/forward/`

Clone the `apps/api/src/modules/reports/` 3-file shape. Service signature:

```ts
forward(forwarderUserId, sourceMessageId, targetChatIds): Promise<{
  items: MessageDto[];
  skipped: { chatId: string; reason: 'blocked' | 'not_a_member' }[];
}>
```

Algorithm:

1. Load source message; `assertMember(forwarderUserId, sourceChatId)`.
2. For each `targetChatId` (sequential, not Promise.all):
   - `assertMember(forwarderUserId, targetChatId)` — non-member → `skipped` (NOT 4xx; matches WhatsApp "the forward silently doesn't appear for blocked recipients").
   - `blocks.isBlockedEitherWay` on counterpart → `skipped`.
   - `clientMessageId = ${sourceMessageId}:${forwarderUserId}:${targetChatId}` (deterministic — idempotency anchor).
   - Internal `messagesService.sendForwarded(forwarderUserId, targetChatId, { kind, ...mediaFields, forwardedFromMessageId, clientMessageId })`. This is a new internal-only method (NOT a public route field) so clients cannot forge a forward attribution.
3. After successes: `prisma.message.update({ data: { forwardCount: { increment: successCount } } })` on source.

Forward count surfaces a client-side "Forwarded many times" label at `forwardCount >= 5`.

### New module — `apps/api/src/modules/pin/`

Routes:

- `PATCH /chats/:chatId/messages/:messageId/pin` → 200 with updated MessageDto. Idempotent if already pinned (returns current state).
- `DELETE /chats/:chatId/messages/:messageId/pin` → 204. Idempotent.
- `GET /chats/:chatId/pins` → `{ items: MessageDto[] }` ordered `pinnedAt DESC`, max 3.

Cap enforcement: 4th pin → 409 `pin_cap_exceeded`. Both broadcasts (`message:pinned`, `message:unpinned`) fan out to `chat:{chatId}`.

### Message-info endpoint

Added directly to `apps/api/src/modules/messages/messages.controller.ts`:

```
GET /messages/:messageId/info
→ { deliveredAt: ISO, readByUserId: string | null, readAt: ISO | null, forwardCount: number, reactionsDetail: { emoji, userIds: string[] }[] }
```

Read-only derivation from existing rows (`ChatMember.lastReadSequence` for read state, `MessageReaction` rows for detail). Member-only.

### Files touched

**Backend (`apps/api/`)**

- `src/modules/forward/forward.controller.ts` — NEW.
- `src/modules/forward/forward.service.ts` — NEW.
- `src/modules/forward/forward.module.ts` — NEW.
- `src/modules/pin/pin.controller.ts` — NEW.
- `src/modules/pin/pin.service.ts` — NEW.
- `src/modules/pin/pin.module.ts` — NEW.
- `src/modules/messages/messages.controller.ts` — EDIT. Add `GET :messageId/info` route.
- `src/modules/messages/messages.service.ts` — EDIT. Add internal `sendForwarded(...)` overload (extension of `send()`); add `emitToChat('message:pinned' | 'message:unpinned', ...)` helper.
- `src/modules/messages/messages.gateway.ts` — EDIT. Subscribe-and-broadcast for the two new events.
- `src/app.module.ts` — EDIT. Register `ForwardModule` + `PinModule`.

**Shared (`packages/shared/`)**

- `src/schemas/forward.ts` — NEW. `ForwardRequestSchema`, `ForwardResponseSchema`.
- `src/schemas/pin.ts` — NEW. `PinResponseSchema`, `PinListResponseSchema`.
- `src/schemas/messages.ts` — EDIT. Add `forwardCount`, `pinnedAt`, `pinnedByUserId`, `forwardedFromMessageId` to `MessageDto`. Add `SocketEvents.messagePinned`, `messageUnpinned`.
- `src/schemas/index.ts` — EDIT. Re-export new schemas.

**Frontend (`my-app/`)**

- `src/features/chat/components/message-action-sheet.tsx` — EDIT. Add Forward / Pin/Unpin / Message Info rows; new conditional visibility.
- `src/features/chat/components/pinned-message-strip.tsx` — NEW.
- `src/app/chat/[id]/forward/[msgId].tsx` — NEW (modal route).
- `src/app/chat/[id]/message-info/[msgId].tsx` — NEW (modal route).
- `src/features/chat/data/chat-repository.ts` — EDIT. Add `forwardMessage`, `pinMessage`, `unpinMessage`, `listPins`, `getMessageInfo`.
- `src/features/chat/data/api-chat-repository.ts` — EDIT.
- `src/lib/chat-socket.ts` — EDIT. Add `onMessagePinned`, `onMessageUnpinned` listeners.

### E2e tests added

- `forward to 3 chats returns 3 items + skipped: []`
- `forward to non-member chat returns skipped (not 403)`
- `forward to blocked-counterpart returns skipped`
- `re-forward to same target is idempotent`
- `forwardCount on origin = success count`
- `pin sets pinnedAt + pinnedByUserId`
- `pin 4th returns 409 pin_cap_exceeded`
- `unpin idempotent (already unpinned → 204)`
- `pin by non-member 403`
- `message-info returns peer read sequence + forwardCount`

---

## Tranche 2.F — Polls (1-on-1 scope)

> **Scope note:** Polls in 1-on-1 chats have at most 2 voters (sender + counterpart). The schema is intentionally general so a future Super Groups BRD can reuse it without migration, but the **1-on-1 UI defaults are: single-select, non-anonymous** (anonymity adds zero value when there are only 2 possible voters). Recommend hiding the anonymous toggle in the 1-on-1 composer.

### Status table

| Sub-item | Frontend | Backend | Notes |
|---|---|---|---|
| **F.1** Migration B — Poll tables | n/a | ✅ (2026-05-26, PR-1) | `PollMessage` + `PollOption` + `PollVote`. Migration `20260527000000_add_polls`. Natural-key uniqueness `(poll_message_id, voter_user_id, poll_option_id)` for idempotent retries. |
| **F.2** `PollsModule` | n/a | ✅ (2026-05-26, PR-1) | `POST /chats/:chatId/polls`, `POST /messages/:id/vote`, `GET /messages/:id/poll`, `POST /messages/:id/poll/close`. Vote runs single-select replace OR multi-select diff under `pg_advisory_xact_lock(pollMessageId)`. New `MessagesService.createServerAuthored(tx, …)` (reused by 2.H for CALL_EVENT) authors POLL rows without hitting the `SERVER_ONLY_KINDS` reject. `MessageDto.poll: PollAggregate \| null` folded in via batched `injectPolls` on `list`. |
| **F.3** AttachSheet — Poll tile added | ✅ (2026-05-26, PR-2) | n/a | 6th tile (`bar-chart-2`, tint `#FFC857`); wired in `chat/[id].tsx` → `router.push('/chat/compose-poll')` |
| **F.4** PollComposerScreen | ✅ (2026-05-26, PR-2) | n/a | `chat/compose-poll.tsx` modal-sibling route (registered in `chat/_layout.tsx` with `presentation: 'modal'`). Question (≤300) + 2–10 dynamic option inputs + multi-select Switch (default OFF, BRD Q4). Anonymous hidden in 1-on-1. Trim + case-insensitive duplicate check before submit. |
| **F.5** PollBubble | ✅ (2026-05-26, PR-2) | n/a | Question + radio (single-select) / checkbox (multi-select) per option + count badge + horizontal fill bar (proportional to maxCount, lime/purple per side) + "N voted" / "Poll closed" subline. Disabled when `closedAt != null`. Rendered inside the standard bubble (inherits reply/forward/pin chrome + reactions pill row). |
| **F.6** Optimistic vote + revote | ✅ (2026-05-26, PR-2) | n/a | New pure `applyVoteLocally` helper (`data/poll-vote-math.ts`) mirrors the server's single-replace vs multi-diff math. Cache flips immediately; reconciles on `poll:voted` socket; snapshot-restore on failure. Mock repo has the same math for `EXPO_PUBLIC_USE_MOCKS=true`. |
| **F.7** Socket event `poll:voted` | n/a | ✅ (2026-05-26, PR-1) | Personalised per viewer (server iterates chat members; `options[].votedByMe` is per-recipient). Emitted on create, vote, and close. Delivered via the new per-user `user:{userId}` room (joined on connect; reused by 2.H call-ring). Mobile subscriber lands in `ensureSocketWired` and splices the fresh aggregate into the cached row. |
| **F.8** Close-poll affordance (sender-only) | ✅ (2026-05-26, PR-2) | n/a | "Close poll" row in `MessageActionSheet` (icon `x-circle`) appears on mine + open POLL bubbles. Server still 403s non-senders for defence in depth. |

### Migration B — `20260527000000_add_polls`

```sql
CREATE TABLE poll_messages (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  question VARCHAR(300) NOT NULL,
  anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  multi_select BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE poll_options (
  id UUID PRIMARY KEY,
  poll_message_id UUID NOT NULL REFERENCES poll_messages(id) ON DELETE CASCADE,
  ordinal INT NOT NULL,
  label VARCHAR(120) NOT NULL,
  UNIQUE (poll_message_id, ordinal)
);

CREATE TABLE poll_votes (
  id UUID PRIMARY KEY,
  poll_message_id UUID NOT NULL REFERENCES poll_messages(id) ON DELETE CASCADE,
  poll_option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  voter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_message_id, voter_user_id, poll_option_id)
);

CREATE INDEX poll_votes_by_option_idx ON poll_votes(poll_option_id);
CREATE INDEX poll_votes_by_voter_idx  ON poll_votes(poll_message_id, voter_user_id);
```

For single-select polls (`multi_select = FALSE`), the service overwrites the prior vote (delete-then-create in a tx). For multi-select, `skipDuplicates: true` on `createMany` + `deleteMany WHERE optionId NOT IN (...)` keeps state consistent.

### Files touched

**Backend (`apps/api/`)**

- `prisma/migrations/20260527000000_add_polls/migration.sql` — NEW.
- `prisma/schema.prisma` — EDIT. Add `PollMessage`, `PollOption`, `PollVote` models.
- `src/modules/polls/polls.controller.ts` — NEW.
- `src/modules/polls/polls.service.ts` — NEW.
- `src/modules/polls/polls.module.ts` — NEW.
- `src/modules/messages/messages.gateway.ts` — EDIT. Subscribe + broadcast `poll:voted`.
- `src/app.module.ts` — EDIT. Register `PollsModule`.

**Shared (`packages/shared/`)**

- `src/schemas/polls.ts` — NEW. `PollCreateRequestSchema`, `PollVoteRequestSchema`, `PollOptionSchema`, `PollAggregateSchema`.
- `src/schemas/messages.ts` — EDIT. `MessageDto.poll: PollAggregateSchema | null`.

**Frontend (`my-app/`)**

- `src/features/chat/components/attachment-sheet.tsx` — EDIT. Add Poll tile (icon `bar-chart-2`).
- `src/app/chat/[id]/compose-poll.tsx` — NEW.
- `src/features/chat/components/bubbles/poll-bubble.tsx` — NEW.
- `src/features/chat/data/chat-repository.ts` — EDIT. `createPoll`, `votePoll`, `closePoll`.
- `src/lib/chat-socket.ts` — EDIT. `onPollVoted` listener.

### E2e tests added

- `create poll persists PollMessage + N options in one tx`
- `vote idempotent (P2002 swallowed)`
- `multi-select honored when multiSelect=true`
- `single-select revote replaces prior vote`
- `vote on closed poll → 409 poll_closed`
- `non-member vote → 403`
- `close poll by non-sender → 403`

---

## ~~Tranche 2.G — Scheduled-send~~ (DEFERRED per R2)

Deferred to a v1.1 BRD per reconciliation R2 and the post-revision tranche order. Rationale: lowest-value feature in the bundle (WhatsApp doesn't have it); the week of effort is better spent on the calls slice (2.H + 2.I). If/when revived, separate `scheduled_messages` staging table is the correct schema choice (per the moot-but-recorded R6) — not in-table `scheduledStatus` enum, which would contaminate every `messages`-table read path (chat preview, `session:resume` socket replay, media gallery, mobile cache).

---

## Tranche 2.H — Calls signalling (server-only)

Backend foundation for voice/video calls. NO mobile UI — verified with curl + a 2-socket node test script that mints a token, accepts, and hangs up.

### Status table

| Sub-item | Frontend | Backend | Notes |
|---|---|---|---|
| **H.0** Socket `user:{userId}` room + multi-device semantics | n/a | ✅ (2026-05-26, 2.F PR-1) | Landed early as part of 2.F's `emitPollVoted` per-viewer broadcast. Same `user:{userId}` room now carries `call:ring` / `call:accepted` / `call:ended` / `call:taken` (2.H PR-1). First-accept-wins via `pg_advisory_xact_lock(callId)` enforced in `calls.service.ts:accept`. |
| **H.1** Migration C — `CallSession` table | n/a | ✅ (2026-05-26, 2.H PR-1) | `20260528000000_add_call_sessions` — table + `call_kind` enum + `call_status` enum + 3 indexes + `call_event_message_id` UNIQUE back-ref. Prisma model with `@map` on every snake_case column (lesson from 2.F PR-1). |
| **H.2** 100ms management client (`hms.client.ts`) | n/a | 🟡 stub (PR-1) → real in PR-2 | PR-1 stub returns synthetic room IDs + dev-signed tokens so e2e drives the flow end-to-end. PR-2 will wire the real `https://api.100ms.live/v2/rooms` POST + HS256 sign with `HMS_APP_SECRET`. Gated on the founder's live-test checklist in `docs/architecture/calls-provider-poc.md` § 6. |
| **H.3** `CallsModule` REST surface | n/a | ✅ (2026-05-26, 2.H PR-1) | 6 routes across 3 controllers: `CallsController` (token/accept/decline/hangup), `CallsWebhookController` (100ms webhook, no JWT), `CallsHistoryController` (`GET /chats/:chatId/calls`). |
| **H.4** Socket events `call:ring` / `call:accepted` / `call:ended` / `call:taken` | n/a | ✅ (2026-05-26, 2.H PR-1) | Added to `messages.gateway.ts` as `emitCallRing/Accepted/Ended/Taken` — all per-user broadcasts on `user:{userId}` (H.0). |
| **H.5** 30s ring-timeout via **BullMQ delayed job** | n/a | ✅ (2026-05-26, 2.H PR-1) | New `BullMQModule` (global) + `CallsRingTimeoutProcessor` Worker. `jobId: callId` → accept/decline cancel by id. `bullmq@^5.77` installed; reuses the existing ioredis client (already configured with `maxRetriesPerRequest: null` for BullMQ compat). Tests bypass via `callsService.onRingTimeout(callId)` direct call. |
| **H.6** Webhook handler `/calls/webhooks/100ms` | n/a | 🟡 stub (PR-1) → real in PR-2 | PR-1 rejects every signature with 403 (e2e case 8 asserts this). PR-2 adds real `HMAC-SHA256(rawBody, HMS_WEBHOOK_SECRET)` constant-time verify + event parser (`session.close.success` → sync `durationSec`). Fastify raw-body parser needs per-route override (see plan §Cross-cutting risks). |
| **H.7** Block-aware token mint | n/a | ✅ (2026-05-26, 2.H PR-1) | `BlocksService.isBlockedEitherWay` check in `calls.service.ts:mintToken`. E2e case 2 green. |
| **H.8** CALL_EVENT message thread row | n/a | ✅ (2026-05-26, 2.H PR-1) | Server-authored via `MessagesService.createServerAuthored` (introduced 2.F PR-1). Inserted on every terminal transition (DECLINED / MISSED / COMPLETED) with `clientMessageId: 'call-{callId}-{reason}'` for idempotency. Client-CALL_EVENT rejected 400 (e2e case 10). |

### Migration C — `20260528000000_add_call_sessions`

```sql
CREATE TYPE call_kind   AS ENUM ('VOICE','VIDEO');
CREATE TYPE call_status AS ENUM ('RINGING','ACCEPTED','DECLINED','MISSED','COMPLETED');

CREATE TABLE call_sessions (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  initiator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  callee_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind   call_kind   NOT NULL,
  status call_status NOT NULL,
  hms_room_id  VARCHAR(64) NULL,
  started_at   TIMESTAMPTZ NULL,
  ended_at     TIMESTAMPTZ NULL,
  duration_sec INT         NULL,
  call_event_message_id UUID NULL UNIQUE REFERENCES messages(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_sessions_by_chat_idx       ON call_sessions(chat_id, created_at DESC);
CREATE INDEX call_sessions_by_initiator_idx  ON call_sessions(initiator_user_id, created_at DESC);
CREATE INDEX call_sessions_by_callee_idx     ON call_sessions(callee_user_id, created_at DESC);
```

`call_event_message_id` back-references the in-thread CALL_EVENT row ("Video call · 4m 12s" pill). Nullable because RINGING has no chat message yet.

### REST surface

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/calls/token` | `{ chatId, kind }` | `{ callId, hmsRoomId, hmsToken, expiresAt }` |
| `POST` | `/calls/:callId/accept` | `{}` | `{ hmsToken, expiresAt }` |
| `POST` | `/calls/:callId/decline` | `{}` | `204` |
| `POST` | `/calls/:callId/hangup` | `{}` | `204` |
| `POST` | `/calls/webhooks/100ms` | (100ms-signed) | `200` |
| `GET` | `/chats/:chatId/calls` | — | `{ items: CallSummary[] }` |

### `POST /calls/token` algorithm

1. JWT → `initiatorUserId`.
2. `assertMember(initiatorUserId, chatId)`; load 1-on-1 counterpart → `calleeUserId`.
3. `blocks.isBlockedEitherWay` → 403 `peer_blocked` if blocked.
4. `hmsClient.createRoom({ name: 'chat-{chatId}-{newCallId}', description })` → `hmsRoomId`.
5. Insert `CallSession { status: 'RINGING', kind, hmsRoomId }`.
6. Mint initiator's 100ms token (HS256 over `{access_key, room_id, user_id, role: 'peer', type: 'app', version: 2, iat, nbf, exp = now+15min}` signed with `HMS_APP_SECRET`).
7. **Ring delivery** (fire-and-forget):
   - `gateway.emitToUser(calleeUserId, 'call:ring', { callId, hmsRoomId, kind, initiator: UserCard })`. This fans out to ALL of the callee's connected sockets in the `user:{calleeUserId}` room (multi-device).
   - If zero sockets connected for callee: `pushService.notify({ userIds: [calleeUserId], payload: { type: 'call:ring', callId, callerName, callerAvatar, kind, hmsRoomId, priority: 'high' } })`.
8. Schedule a BullMQ delayed job `call-ring-timeout` with `delay: 30_000, jobId: callId` (so cancellation by accept/decline can target it). On fire: load `CallSession`; if `status === 'RINGING'`, flip to `MISSED` in a tx, emit `call:ended { reason: 'missed' }` to both peers' `user:{userId}` rooms, and call `messagesService.sendSystem(chatId, { kind: 'CALL_EVENT', text: humanLabel(...) })`. Per R5: this is NOT an in-process `setTimeout` — it must survive Fly blue-green deploys.

### `POST /calls/:callId/accept` algorithm

1. JWT → `acceptingUserId` must equal `CallSession.calleeUserId`.
1.5. **Acquire `pg_advisory_xact_lock`** on `BigInt(callId-slice)`. Verify status inside the lock to handle concurrent accept from a second device — second-accept returns `409 call_already_accepted`. After successful lock-and-flip, BullMQ-cancel the `call-ring-timeout` job by `jobId`. Broadcast `call:taken` to the callee's other connected sockets (everything in `user:{calleeUserId}` except the accepting socket) so their IncomingCallScreen dismisses.
2. Verify `status === 'RINGING'` (redundant with 1.5 but kept as a sanity check). Else 409 `call_not_ringing`.
3. Flip `status = 'ACCEPTED'`, `startedAt = now()`.
4. Mint callee's 100ms token (same recipe).
5. Broadcast `call:accepted { callId }` to both `user:{initiator}` and `user:{callee}` rooms.
6. Return the callee's token. Both clients then hand off to `@100mslive/react-native-room-kit`.

### Env vars (added to `apps/api/src/config/env.ts`)

- `HMS_MANAGEMENT_TOKEN` — long-lived management API token.
- `HMS_APP_ACCESS_KEY` + `HMS_APP_SECRET` — for client-token HS256 signing.
- `HMS_WEBHOOK_SECRET` — webhook HMAC verification.

All four optional (mirror `R2_*` pattern at `media.service.ts:65-74`); if any unset, `/calls/token` returns `503 calls_not_configured`. Lets local devs boot without 100ms credentials.

### Files touched

**Backend (`apps/api/`)**

- `prisma/migrations/20260528000000_add_call_sessions/migration.sql` — NEW.
- `prisma/schema.prisma` — EDIT.
- `src/modules/calls/calls.controller.ts` — NEW.
- `src/modules/calls/calls.service.ts` — NEW.
- `src/modules/calls/hms.client.ts` — NEW (thin HTTP wrapper + HS256 token mint).
- `src/modules/calls/calls.module.ts` — NEW.
- `src/modules/messages/messages.gateway.ts` — EDIT. Add `emitToUser(userId, event, payload)` helper (if not present); add `'call:ring' | 'call:accepted' | 'call:ended'` to outbound event set.
- `src/modules/messages/messages.service.ts` — EDIT. Add internal `sendSystem(chatId, { kind: 'CALL_EVENT', text })` that bypasses the client-facing `SendMessageSchema`.
- `src/config/env.ts` — EDIT. Add `HMS_*` keys.
- `src/app.module.ts` — EDIT. Register `CallsModule`.

**Shared (`packages/shared/`)**

- `src/schemas/calls.ts` — NEW. `CallKindEnum`, `CallStatusEnum`, `CallTokenRequestSchema`, `CallTokenResponseSchema`, `SocketCallRingSchema`, `SocketCallAcceptedSchema`, `SocketCallEndedSchema`, `CallSummarySchema`.
- `src/schemas/messages.ts` — EDIT. Add `SocketEvents.callRing`, `callAccepted`, `callEnded`.

### E2e tests added

- `token-mint with non-member → 403 not_a_member`
- `token-mint with blocked counterpart → 403 peer_blocked`
- `decline records DECLINED + inserts CALL_EVENT thread row`
- `ring 30s timeout via BullMQ records MISSED + CALL_EVENT 'Missed voice call'` (manual verification clause in PR description: confirm Fly deploy mid-ring still completes the transition)
- `accept from two devices: first wins; second returns 409 call_already_accepted; other device receives call:taken` (multi-device first-accept-wins per H.0)
- `double-accept idempotent (returns existing token)` (single device retry; superseded by the multi-device test above)
- `hangup after accept records COMPLETED with durationSec`
- `webhook bad signature → 401`
- `webhook good signature updates durationSec`
- `client-supplied CALL_EVENT kind rejected 400`

---

## Tranche 2.I — Call UI + push wakeup

Final tranche. Wires the 100ms RN SDK + the IncomingCallScreen + push notifications. **First tranche to require a custom dev client** (100ms native; loses Expo Go).

### Status table

| Sub-item | Frontend | Backend | Notes |
|---|---|---|---|
| **I.1** Migration D — `UserDevice` table | n/a | 🚫 | `expoPushToken UNIQUE`, platform, lastActiveAt |
| **I.2** `PushModule` | n/a | 🚫 | `POST /push/tokens` upsert; `notify({ userIds, payload, opts })` |
| **I.3** Mute-aware push filter | n/a | 🚫 | Skip muted memberships EXCEPT for `call:ring` |
| **I.4** 100ms SDK install + plugin block | 🚫 | n/a | `@100mslive/react-native-hms` + `@100mslive/react-native-room-kit` |
| **I.5** `app/call/[callId].tsx` CallScreen | 🚫 | n/a | Renders `<HMSPrebuilt>`; onLeave → hangup |
| **I.6** `app/call/incoming/[callId].tsx` IncomingCallScreen | 🚫 | n/a | Ring/accept/decline state machine |
| **I.7** `CallRingListener` shell mount | 🚫 | n/a | Global socket listener for `call:ring` |
| **I.8** Push wakeup → IncomingCallScreen | 🚫 | n/a | `expo-notifications` handler routes to incoming screen |
| **I.9** ComingSoonSheet voice/video keys removed | 🚫 | n/a | Disconnect from `chat-header.tsx`; keep for chatTheme + exportChat per CLAUDE.md row |

### Migration D — `20260529000000_add_user_devices`

```sql
CREATE TYPE device_platform AS ENUM ('IOS','ANDROID');

CREATE TABLE user_devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token VARCHAR(200) NOT NULL UNIQUE,
  platform device_platform NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_devices_by_user_idx ON user_devices(user_id);
```

### Files touched

**Backend (`apps/api/`)**

- `prisma/migrations/20260529000000_add_user_devices/migration.sql` — NEW.
- `prisma/schema.prisma` — EDIT.
- `src/modules/push/push.service.ts` — NEW.
- `src/modules/push/push-tokens.controller.ts` — NEW.
- `src/modules/push/push.module.ts` — NEW.
- `src/app.module.ts` — EDIT. Register `PushModule`.
- `package.json` — EDIT. Add `expo-server-sdk`.

**Frontend (`my-app/`)**

- `app.json` — EDIT. Add 100ms plugin block + expo-notifications plugin + permission descriptions.
- `src/app/call/_layout.tsx` — NEW. Stack with `presentation: 'fullScreenModal'`, `gestureEnabled: false`.
- `src/app/call/[callId].tsx` — NEW. CallScreen with `<HMSPrebuilt>`.
- `src/app/call/incoming/[callId].tsx` — NEW. IncomingCallScreen with accept/decline.
- `src/features/chat/components/call-ring-listener.tsx` — NEW. Global socket subscriber.
- `src/app/_layout.tsx` — EDIT. Mount `<CallRingListener>` at the app shell.
- `src/features/chat/components/chat-header.tsx` — EDIT. Replace `onVoiceCall={() => setComingSoonKey('voiceCall')}` with real `POST /calls/token` + navigate flow.
- `src/app/chat/[id].tsx` — EDIT. Remove `voiceCall`/`videoCall` from `comingSoonKey` union.
- `src/features/chat/data/chat-repository.ts` — EDIT. Add `mintCallToken`, `acceptCall`, `declineCall`, `hangupCall`, `registerPushToken`.
- `src/lib/chat-socket.ts` — EDIT. `onCallRing`, `onCallAccepted`, `onCallEnded`.
- `src/lib/push.ts` — NEW. Bootstrap `expo-notifications` permissions + token registration on app start.
- `package.json` — EDIT. Add `@100mslive/react-native-hms`, `@100mslive/react-native-room-kit`, `expo-notifications`.

### `app.json` additions

```json
{
  "expo": {
    "plugins": [
      [
        "@100mslive/react-native-hms",
        {
          "iosCameraUsageDescription": "ScaleChat needs camera access for video calls.",
          "iosMicrophoneUsageDescription": "ScaleChat needs microphone access for voice and video calls.",
          "androidPermissions": ["CAMERA","RECORD_AUDIO","BLUETOOTH_CONNECT","MODIFY_AUDIO_SETTINGS","READ_PHONE_STATE"]
        }
      ],
      [
        "expo-notifications",
        { "icon": "./assets/notification-icon.png", "color": "#208AEF" }
      ]
    ]
  }
}
```

### E2e tests added

- `register push token upserts by token`
- `mute filter excludes push for muted chats`
- `mute filter does NOT exclude call:ring (rings even when muted)`
- `DeviceNotRegistered Expo ticket deletes row`

---

## Migration index (chronological)

| Migration | When | Touches | Tranche |
|---|---|---|---|
| `20260526000000_expand_message_kind_and_media_fields` | A | MessageKind enum + Message columns + scheduled_status enum + 3 indexes | 2.B |
| `20260527000000_add_polls` | B | `poll_messages`, `poll_options`, `poll_votes` | 2.F |
| `20260528000000_add_call_sessions` | C | `call_sessions` + `call_kind` enum + `call_status` enum + 3 indexes | 2.H |
| `20260529000000_add_user_devices` | D | `user_devices` + `device_platform` enum | 2.I |

All migrations are additive — no `DROP COLUMN`, no destructive changes. Each migration carries its own rollback `.sql` adjacent to `migration.sql`.

---

## API surface additions (consolidated)

| Method | Path | Tranche | Purpose |
|---|---|---|---|
| `POST` | `/messages/:id/reactions` | already shipped (PR 4) | — |
| `POST` | `/messages/:id/forward` | 2.E | Forward to N target chats |
| `PATCH` | `/chats/:chatId/messages/:id/pin` | 2.E | Pin (3-per-chat cap) |
| `DELETE` | `/chats/:chatId/messages/:id/pin` | 2.E | Unpin (idempotent) |
| `GET` | `/chats/:chatId/pins` | 2.E | List pinned (max 3) |
| `GET` | `/messages/:id/info` | 2.E | Read receipts + reactions detail + forwardCount |
| `POST` | `/chats/:chatId/polls` | 2.F | Create POLL message + paired PollMessage |
| `POST` | `/messages/:id/vote` | 2.F | Vote (single or multi) |
| `GET` | `/messages/:id/poll` | 2.F | Hydrate poll detail |
| `POST` | `/messages/:id/poll/close` | 2.F | Close poll (sender-only) |
| `POST` | `/chats/:chatId/messages/scheduled` | 2.G | Persist a SCHEDULED row |
| `GET` | `/chats/:chatId/scheduled` | 2.G | List own pending scheduled |
| `DELETE` | `/scheduled-messages/:id` | 2.G | Cancel before fire |
| `POST` | `/calls/token` | 2.H | Mint 100ms room + initiator token |
| `POST` | `/calls/:callId/accept` | 2.H | Callee accept → mint callee token |
| `POST` | `/calls/:callId/decline` | 2.H | Callee decline → DECLINED + CALL_EVENT |
| `POST` | `/calls/:callId/hangup` | 2.H | Either-party hangup → COMPLETED + CALL_EVENT |
| `POST` | `/calls/webhooks/100ms` | 2.H | 100ms session lifecycle webhook |
| `GET` | `/chats/:chatId/calls` | 2.H | Call history for the chat-info screen |
| `POST` | `/push/tokens` | 2.I | Upsert Expo push token |
| `DELETE` | `/push/tokens/:token` | 2.I | Cleanup on logout |

---

## Socket event additions (consolidated)

| Event | Direction | Tranche | Payload |
|---|---|---|---|
| `message:pinned` | S→C | 2.E | `{ chatId, messageId, pinnedByUserId, pinnedAt }` |
| `message:unpinned` | S→C | 2.E | `{ chatId, messageId }` |
| `poll:voted` | S→C | 2.F | `{ chatId, pollMessageId, voterUserId, optionIds, aggregate }` |
| `call:ring` | S→C | 2.H | `{ callId, hmsRoomId, kind, initiator: UserCard }` |
| `call:accepted` | S→C | 2.H | `{ callId }` |
| `call:ended` | S→C | 2.H | `{ callId, reason: 'completed' \| 'declined' \| 'missed' \| 'hangup' \| 'network', durationSec }` |
| `call:taken` | S→C | 2.H | `{ callId }` — fired to callee's OTHER devices when one device has accepted; tells the rest to dismiss the IncomingCallScreen (multi-device first-accept-wins per H.0) |

---

## Permissions matrix (consolidated)

| Feature | Module | Runtime permission | `app.json` plugin key |
|---|---|---|---|
| Composer camera shortcut | `expo-image-picker` | `requestCameraPermissionsAsync` | already configured |
| Documents | `expo-document-picker` | none (system picker) | — |
| Contacts | `expo-contacts` | `requestPermissionsAsync` | `contactsPermission` |
| Location | `expo-location` | `requestForegroundPermissionsAsync` | `locationWhenInUsePermission` |
| Push (call ring + general) | `expo-notifications` | `requestPermissionsAsync` | plugin block |
| Calls (mic + cam) | `@100mslive/react-native-hms` | granted at call-start | plugin block (§Tranche 2.I) |

---

## Dependencies to install (consolidated)

**Mobile (`my-app/`):**

```bash
# Tranche 2.A
npm --workspace=my-app install rn-emoji-keyboard

# Tranche 2.C
npm --workspace=my-app install expo-document-picker expo-file-system expo-sharing expo-video-thumbnails expo-video

# Tranche 2.D
npm --workspace=my-app install expo-contacts expo-location react-native-maps

# Tranche 2.G
npm --workspace=my-app install @react-native-community/datetimepicker

# Tranche 2.I (breaks Expo Go — requires custom dev client)
npm --workspace=my-app install @100mslive/react-native-hms @100mslive/react-native-room-kit expo-notifications
```

**Backend (`apps/api/`):**

```bash
# Tranche 2.G
npm --workspace=apps/api install @nestjs/schedule

# Tranche 2.I
npm --workspace=apps/api install expo-server-sdk
```

---

## How to verify (per tranche)

Each tranche's PR description includes a verification block. Common pattern:

```bash
# 1. Bootstrap DB after schema change
npm run db:setup

# 2. Backend e2e (with the tranche's new spec)
npm run api:test:e2e -- --testNamePattern='<tranche keyword>'

# 3. Mobile Jest
cd my-app && npm test -- --testPathPattern='<tranche component>'

# 4. Manual smoke (per tranche; see PR description)
npm run api:dev
cd my-app && npm run start
```

**Tranche 2.A** — long-press a counterpart bubble; tap 👍 in the strip; observe optimistic pill appears + persists after socket roundtrip.

**Tranche 2.C** — composer camera shortcut: tap → take photo → bubble appears with optimistic upload. Document attach: tap paperclip → Documents → pick a PDF → bubble shows PDF icon + filename + size. Tap → opens system share sheet.

**Tranche 2.D** — Location tile → map picker → drag marker → "Send location" → bubble shows static map. Counterpart taps → full-screen map opens. Contact tile → contact picker → bubble shows vCard-style card.

**Tranche 2.E** — long-press own bubble → Pin → header shows pinned strip. Try to pin a 4th → 409 toast. Forward: select 3 chats → see message in each. Message Info: shows deliveredAt + readAt.

**Tranche 2.F** — paperclip → Poll → enter question + 2 options → send. Both peers see the bubble. Tap option → bar fills optimistically. Counterpart sees update via `poll:voted`.

**Tranche 2.G** — paperclip → Schedule → set "1 min from now" + type message → schedule. Wait 30-60s. Sweeper fires; message appears in thread with original timestamp. Cancel-before-fire: send another scheduled for 5 min, cancel via scheduled-list, observe DELETE → 204.

**Tranche 2.H** — `curl` the 4 REST routes against a local API + 2 sockets in a node test script. No mobile yet.

**Tranche 2.I** — must use the custom dev client. Tap voice → initiator sees CallScreen with audio toggle. Callee receives `call:ring` → IncomingCallScreen. Decline → CALL_EVENT pill "Voice call declined" in thread. Background app on callee → kill app → initiate call → push wakes app → IncomingCallScreen.

---

## Open questions (decision needed before each tranche begins)

| # | Tranche | Question | Recommendation |
|---|---|---|---|
| Q1 | 2.E | Forward attribution: show "Forwarded from {name}" or just "Forwarded"? | **Just "Forwarded"** (WhatsApp parity; protects PII across non-overlapping chats). |
| Q2 | 2.E | Pinned-message strip when 0 pins: auto-collapse to 0 height, or 28px placeholder? | **Auto-collapse** (saves header real estate; accept the one-time layout jump on first pin). |
| Q3 | 2.F | Anonymous polls in 1-on-1: hide the toggle entirely or keep it? | **Hide** (zero value with only 2 voters). |
| Q4 | 2.F | Multi-select default: ON or OFF? | **OFF** (WhatsApp parity). |
| Q5 | 2.G | Cancel propagation: what if user taps cancel at T-1s while sweeper has just read the row? | **`FOR UPDATE SKIP LOCKED` + status check inside same tx** resolves this — cancel waits, sees FIRED, returns 409. UI greys out cancel within ~10s of `scheduledForAt`. |
| Q6 | 2.H | Call recording — out of scope, but add `recordingUrl` column now to avoid a future migration? | **Yes** (one nullable column is cheap insurance; 100ms supports recording natively). |
| Q7 | 2.D | Google Maps vs Apple Maps for iOS map preview? | **Apple Maps on iOS, Google Maps on Android** (no API key fee on iOS; Google's static-map URL still works for server-side previews). |
| Q8 | 2.H | Block behavior for calls: bidirectional? | **Bidirectional** (mirror `blocks.isBlockedEitherWay` from messages). |
| Q9 | 2.I | CallKit (iOS VoIP push)? | **v1.1** (paid Apple Developer entitlement + `react-native-callkeep` integration). v1 ships with standard Expo push. |
| Q10 | 2.D | Live location (LOCATION_LIVE) — defer to separate BRD? | **Yes** (needs its own update-stream channel). |

---

## Known limitations / deferred work

- **Expo Go ends at Tranche 2.I**. The first 8 tranches are Expo-Go-compatible; the call slice forces a custom dev client. Document in `instruction-to-run-the-app.md` (CLAUDE.md row).
- **Push for background messages** (non-call) is punted to a separate "Phase E push worker" BRD. The mute logic + UserDevice table land in 2.I and are reusable.
- **iOS background ring** uses standard push, not CallKit. Locked-screen incoming-call experience on iOS will look like a normal notification, not a full-screen ringer. Acceptable for v1 GA; flagged for v1.1.
- **Scheduled-send single-instance only**. Safe under accidental multi-instance fires (`FOR UPDATE SKIP LOCKED`), but the 30s cron interval means a scheduled message can fire up to 30s late. Migration to BullMQ when we scale beyond one Fly machine.
- **Forward to groups** — out of scope (Super Groups deferred). The Forward module's signature accepts `targetChatIds: string[]` and works for groups too; only the UI's chat-picker constraints to 1-on-1 chats in this BRD.

---

## Pickup notes for the next contributor

If you're picking up this slice (or any tranche of it), read in this order:

1. **`docs/progress/1-on-1-production.md`** — predecessor BRD. Understand what's already shipped (Tranche 1.A — Phases A through C).
2. **This file's Tranche map** — pick the next `[ ]` tranche.
3. **`my-app/CLAUDE.md` §7 working agreement** — every commit updates root `CLAUDE.md` §10 + the matching tranche's status table here.
4. **The Plan agent's full output** lives in the conversation history of plan-mode session `2026-05-25` — the per-tranche detail (file-level deltas, e2e cases, algorithm steps) was distilled into this BRD but the original Plan-agent reports have more inline justification if you need to debate a design choice.
5. **Codex second-opinion review** — see Appendix at the end of this file (added after BRD authoring per user request).
6. **Backend module template** — `apps/api/src/modules/reports/` is the canonical 3-file shape (controller + service + module). Clone for every new module in this BRD.
7. **Idempotency pattern** — `pg_advisory_xact_lock` at `apps/api/src/modules/messages/messages.service.ts:374-435`. Re-use for forward (target chat lock), poll vote (poll message lock), scheduled-send (no extra lock — same `(senderUserId, clientMessageId)` unique).
8. **Optimistic UI pattern** — image/voice send is the reference. Insert a `sending` row, await network, reconcile or flip to `failed`. Mirror for document/video/poll-vote/forward.
9. **Socket-driven cache mutation** — `my-app/src/features/chat/data/api-chat-repository.ts`'s `ensureSocketWired()` is the central place. Every new socket event added in this BRD gets a subscriber here.

When you land a tranche:

- Update this file's tranche status table from 🚫 → ✅.
- Update root `CLAUDE.md` §10 status snapshot with a one-liner.
- Add the e2e cases listed in that tranche's section.
- Don't `[skip-claudemd]` unless the commit is truly behavior-neutral (refactor, lint, build-fix).

---

## Appendix — Second-opinion review (2026-05-25)

> Codex CLI was unavailable in this session (sandbox-bypass flag denied by auto-mode). Independent review was instead conducted by a fresh Plan sub-agent reading the BRD + relevant code paths (`messages.service.ts`, `messages.gateway.ts`, `chats.service.ts`, predecessor BRD, root + my-app CLAUDE.md) with explicit instruction to criticize rather than validate.

### Verdicts per question

| # | Question | Verdict | Summary |
|---|---|---|---|
| Q1 | 100ms vs LiveKit | ❌ change | Prebuilt-UI savings oversold (you'll rebuild anyway); freemium math fragile at scale; LiveKit self-host on Fly Mumbai not even considered in the locked decision. |
| Q2 | Tranche ordering | ❌ change | Calls should ship earlier (headline feature). 2.E before 2.C/2.D (lower native-deps risk). 2.G scheduled-send: defer entirely. 2.A ∥ 2.B in parallel from day 1. |
| Q3 | `/chat` vs separate `/calls` namespace | ⚠️ reconsider | Single namespace is defensible BUT the BRD hand-waves `emitToUser` — that's a new connection-tracking primitive (`user:{userId}` room join + multi-device "first-accept wins" semantics). Must be specified explicitly. |
| Q4 | `@nestjs/schedule` vs BullMQ | ❌ change | The 30s ring-timeout `setTimeout` is in-process JS state — does not survive Fly blue-green deploy. **Correctness bug, not just a scaling concern.** Calls staying RINGING forever after a 5s-mid-call deploy is the worst possible UX bug. BullMQ from day 1. |
| Q5 | SCHEDULED in `messages` table vs separate `scheduled_messages` | ❌ change | In-table pollutes `chat.lastMessageId` (preview shows undelivered messages), `session:resume` socket replay (scheduled drafts leak to recipients), media gallery, search, mobile cache. Filter footprint is large; "simplicity" is false-economy. Separate staging table. |

### Top meta-risk the BRD misses

**EAS Build / dev-client transition** at Tranche 2.I. The BRD flags it in one line ("first tranche to break Expo Go") but has zero operational plan for what that means: EAS Build credits, iOS provisioning profiles, Android keystore, internal-distribution testflight onboarding, the 20-minute build wait for one-line CallScreen tweaks, the moment QA's Expo Go workflow stops working. **This single transition is more disruptive to iteration speed than every other tranche combined.** First time someone tries to test a call fix on Saturday at 11pm and discovers they need a signed iOS build, the slice stalls.

### One concrete edit recommended before any tranche begins

**Add Tranche 2.0 — "Dev client + EAS build readiness"** before 2.A. Single PR: install `expo-dev-client`, set up `eas.json` development profile, document build-and-install loop in `my-app/instruction-to-run-the-app.md`, run one dry build on Android + iOS to validate the pipeline, and lock `@100mslive/*` versions in `package.json` (even though not yet used). Cost: ~½ day. Benefit: de-risks the 2.I cliff; tranches 2.A–2.G stay shippable under either Expo Go OR dev client (no context-switch later); surfaces signing-cert problems while no calls code is in flight.

---

## Reconciliation history — all 7 revisions ACCEPTED and baked into body (2026-05-25)

The body above reflects R1–R7. This section is preserved for audit purposes.

| # | Revision | Status | Where applied in body |
|---|---|---|---|
| R1 | Add Tranche 2.0 (dev-client readiness) — shrunk to docs-only after 5-agent review | ✅ baked | New `## Tranche 2.0` section above `## Tranche map`; Tranche map's first row |
| R2 | Reorder tranches; defer 2.G | ✅ baked | Tranche map "Recommended order"; 2.G section replaced with deferred-marker block; "Out-of-scope" lists scheduled-send |
| R3 | 100ms provisional; LiveKit Cloud POC | ✅ baked | Architectural-decisions § "Voice/video call provider" rewritten |
| R4 | `user:{userId}` room + first-accept-wins | ✅ baked | Tranche 2.H new H.0 row; `POST /calls/:callId/accept` algorithm gains step 1.5 with `pg_advisory_xact_lock`; new `call:taken` socket event row |
| R5 | BullMQ from day 1 (drop `@nestjs/schedule`) | ✅ baked | Architectural-decisions § "Queue infrastructure" rewritten; Tranche 2.H row H.5 rewritten for BullMQ delayed job; step 8 of `POST /calls/token` algorithm updated |
| R6 | Separate `scheduled_messages` table | ✅ moot | 2.G deferred per R2; the staging-table choice does not apply in this BRD. Decision recorded in the deferred-marker block at `## ~~Tranche 2.G~~` for future revival. |
| R7 | Trim Migration A | ✅ baked | Tranche 2.B Migration A spec updated: removed `scheduledForAt`, `scheduledStatus`, `scheduled_status` enum, `messages_scheduled_pending_idx` index; removed `SCHEDULED` and `POLL_VOTE` from MessageKind enum and SERVER_ONLY_KINDS set |

## 5-agent review history — Tranche 2.0 shrunk to docs-only (2026-05-25)

After R1 added Tranche 2.0, a 5-agent independent review was commissioned. 3 of 5 agents returned (mobile build pipeline, native Android, scope/risk); 2 hit session limits. The 3 returning reviewers unanimously recommended shrinking Tranche 2.0 dramatically.

Key evidence-backed findings applied:

- **Drop the placeholder-deps strategy.** Locking BOTH `@100mslive/*` and `@livekit/react-native` would cause a `Duplicate jniLibs` Gradle error (both ship `libwebrtc.so`).
- **Drop the `prebuild --clean` run** from this PR. `my-app/android/` is not in git (CNG pattern); regenerating it costs time without producing a reviewable diff.
- **Fix backend port to 4000** (not 3000) in the instruction doc — verified at `my-app/src/lib/api-client.ts:52`.
- **Document `.env.local` with `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000`** — without it the Android emulator app can't reach the host backend.
- **Capture all 10 native-dep gotchas as a Knowledge base (K1–K10)** that gates the specific later tranche that actually needs each item (MultiDex for 2.D, Gradle heap for 2.H/2.I, Maps API key for 2.D, AudioFocus coordination for 2.I, etc.).

Net: Tranche 2.0 shrank from a 7-sub-item PR (~1–2 hours, 30+ min Gradle wait) to a 4-sub-item docs-only PR (~20 minutes).

---

*Authored 2026-05-25 by plan-mode session on Opus 4.7 (1M context, xhigh effort). Tranche detail synthesized from two parallel Plan-agent outputs (backend + frontend). 1-on-1 scope only — Super Groups deferred. Reconciliation revisions R1–R7 baked into body 2026-05-25 (see history table above). Tranche 2.0 shrunk to docs-only after 5-agent review (see review-history section above). Figma `1:1574` is the design source; pixel-level specs (exact spacings, color hex tokens for new components) to be re-pulled from Figma MCP at implementation time using fileKey `JYhOHnaEDgGYNxJShD9WDK`. Next PR: Tranche 2.0.*
