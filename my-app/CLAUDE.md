@AGENTS.md

# ScaleChat — Project Context

> Read this once at the start of every session. The first hard rule below is non-negotiable.

## 1. Product

**ScaleChat** is a privacy-first mobile messaging app for the **Indian market**, built for *intermediaries* — real estate agents, travel agents, recruiters, marketplace operators, consultants, community builders — whose income depends on connecting two parties without being bypassed. The hero feature is the **Super Group**: a group chat where members can talk together but cannot see each other's phone numbers and cannot DM each other. Only the admin (the network owner) has full visibility. **Admins pay; members are free.**

The standard 1-on-1 chat (the WhatsApp-equivalent direct message between two users who already have each other's numbers) is the foundational primitive Super Groups sit on top of. Phone numbers ARE visible in 1-on-1 chats — the disintermediation feature is specifically a Super Group property.

Canonical pitch: `../Scalechat Pdf (2).pdf` (project root).
Design source: Figma file `JYhOHnaEDgGYNxJShD9WDK`, page `0:1`.

**Naming note.** The Figma file is branded **"SlayChat"** — that was an earlier product name. The canonical name is **ScaleChat**. Do not rename anything in Figma; just use "ScaleChat" in code, copy, and docs.

## 2. Tech stack pinning — hard rule

- **Expo SDK 56**
- **expo-router** (file-based routing, typed routes enabled)
- **React Native 0.85**
- **React 19.2**
- **TypeScript strict**

> **Before writing any Expo API call, read `https://docs.expo.dev/versions/v56.0.0/` for that module.**
> Expo APIs shift across major versions. Do not assume APIs from older Expo memory. This rule is enforced by `AGENTS.md`.

See [`../docs/architecture/expo-skills.md`](../docs/architecture/expo-skills.md) for the full enumeration of modules + EAS workflow + reading order.

## 3. Architecture stance

- **Frontend-first.** We build screens against in-memory mock data behind **typed repository interfaces** (`MessagesRepository`, `ThreadsRepository`, `ContactsRepository`). The real backend ships later as a new implementation of the same interface.
- All UI works fully offline against the mock store. **No network code yet.**
- **India-first locale:**
  - Phone numbers default to `+91` (E.164: `+91XXXXXXXXXX`).
  - Time format: `HH:mm`, with `Yesterday` / `DD/MM/YY` relative dates (matches Figma).
  - Currency: `₹` via `Intl.NumberFormat('en-IN')`.
  - English UI now; strings live in designated copy files (`features/*/copy.ts`) so a future i18n layer can lift them without touching screens.
- **Dark-mode-first** — the Figma is dark; light mode is secondary.
- Always go through `useTheme()` and `Spacing` from `src/constants/theme.ts`. **Never hard-code colors or spacing.** Extend the palette in `theme.ts` when designs need a new token.
- **Never use raw `Text` / `View` in screens.** Always `ThemedText` / `ThemedView`.

## 4. Target backend architecture (PARTIALLY IMPLEMENTED — see `../apps/api/`)

This summarizes the backend architecture designed by the founder's collaborator. The Expo client ships first against mocks; the NestJS backend is being built in parallel at `../apps/api/`. Frontend choices on this page (MMKV, zod, secure-store, single-flight refresh) flow from this design.

**Implementation status (as of current slice):**
- ✅ NestJS + Fastify scaffold, Prisma schema (User, RefreshToken, OtpRequest, SecurityEvent, Contact, Chat, ChatMember, Message), Redis client.
- ✅ `POST /auth/otp/request` — production: MSG91 send, argon2-hashed OTP in Redis, rate limits per phone + IP, audit row.
- 🚧 `POST /auth/otp/verify` — **STUB.** Returns 501 in prod; in dev (`ENABLE_DEV_OTP=true`) accepts `DEV_OTP_CODE`. Real verify in the next ticket.
- ✅ `POST /auth/refresh` — RS256 access + opaque refresh, family rotation with replay detection.
- ✅ `POST /auth/signout` — revokes the refresh family.
- ✅ `GET /me`, `PATCH /me` — JWT-guarded.
- ✅ `GET /health`, `GET /ready` — Fly health checks.
- ✅ Chats REST — `GET /chats`, `POST /chats/one-on-one`, `GET /chats/:chatId`, `GET /chats/:chatId/messages`, `POST /chats/:chatId/messages` (idempotent on `clientMessageId`, per-chat sequence under `pg_advisory_xact_lock`), `PATCH /chats/:id/read|favourite|archive`, `PATCH /chats/read-all`.
- 🚫 Socket.IO chat gateway, BullMQ workers, Razorpay — Socket.IO push is the next chat ticket; mobile re-fetches on focus + after send today.

### Stack
- API + WebSocket gateway: **single NestJS binary** running two scaling profiles (REST is short-lived; Socket.IO is long-lived).
- **Postgres on Neon** (Launch tier in prod, always-on).
- **Redis on Upstash** — Socket.IO adapter, presence sets, OTP store, rate-limit buckets, BullMQ queues.
- **BullMQ workers** on a separate Fly process (`worker.ts` entrypoint) — push fan-out, message expiry, Razorpay webhook, RBI pre-debit, media thumbnails.
- **Cloudflare** at the edge — TLS, DNS, WAF, rate-limit, CDN.
- Hosting: **Fly.io in Mumbai (`ap-south-1`)** — same region as Upstash + Neon → sub-ms latency between tiers.
- **Prisma 7** ORM (WASM).
- Monorepo with **`packages/shared`** for zod schemas + branded types.

### Auth flow
- **OTP via MSG91**; 6-digit code, argon2-hashed in Redis, 5-min TTL.
- Rate-limited per phone (5/h) and per IP (20/h); verify endpoint caps at 5 attempts.
- **JWT pair on verify:**
  - Access: RS256, 15 min, has `jti`.
  - Refresh: opaque, 30 d, argon2-hashed in Postgres, has `familyId`.
- **Refresh rotation with family-based replay detection** — using a revoked refresh revokes the entire `familyId` chain, logs a security event, returns 401.
- **Client implication:** The Expo app MUST use a **single-flight refresh mutex** (singleton promise around the refresh call) so concurrent 401s from in-flight requests don't trigger N parallel refreshes — which would look like a replay attack and force re-login.

### Real-time chat protocol
- **Socket.IO over WSS.** JWT in the handshake `auth` payload. Rooms keyed `group:{groupId}`. Presence in Redis sets with TTL refresh on heartbeat.
- **Sending a message:**
  ```
  emit "message:send" { groupId, type, content?, mediaObjectKey?, clientMessageId }
  → server validates via shared zod schema
  → checks membership of (userId, groupId)
  → acquires per-group BigInt sequenceNumber via Postgres advisory lock
  → inserts Message row (idempotent on clientMessageId per sender)
  → emitMasked(groupId, "message:new", message)
  → acks { messageId, sequenceNumber }
  → enqueues BullMQ push for offline members
  ```
- **Replay on reconnect:**
  ```
  emit "session:resume" { groupId, lastSeenSequence }
  → server returns missed messages in order
  → paginated by "session:resume:more"
  ```
- **Client implication:** Store `lastSeenSequence` per group in **MMKV**. The sequence is a `BigInt` — serialize as string.

### Privacy engine (4 layers)
Product invariant: **a non-admin viewer must never receive a payload containing real `userId`, `phone`, or `displayName` of another user.**

- **Layer 0 — lint.** `eslint-plugin-privacy-mask` bans raw `socket.emit()` (must use `emitMasked()`) and raw Prisma entity returns from `.controller.ts` / `.gateway.ts` / `.service.ts` files.
- **Layer 1 — branded types.** `packages/shared/src/branded.ts` defines a `Masked` brand. Only `brandAsMasked()` produces a `Masked*` value. Controllers and gateway handlers declare `Masked*` return types — the compiler refuses any non-masked return.
- **Layer 2 — global response interceptor.** A NestJS interceptor inspects every non-admin payload for residual PII fields (`phone`, `senderUserId`, …) lacking the `__masked` brand → 500 + page on-call. Defensive backstop.
- **Layer 3 — `emitMasked()` socket wrapper.** Iterates connected sockets in a room, resolves each viewer's role, emits a per-viewer payload (admin → full PII, members → aliases). `AnomalyDetector.observe()` runs on every invocation; pages on residual PII leakage.

**Client implication:** the Expo client receives already-masked payloads. The only client obligation is to **not cache PII once received**, and to **not mix admin and member views** in shared state — which is structurally impossible because each socket gets its own per-viewer payload.

### Payments
- **Razorpay** with **RBI pre-debit / mandate** (Indian subscription compliance).
- Webhook idempotency via unique constraint on `razorpayEventId` (from the `x-razorpay-event-id` header). Second insert hits the constraint → 200 OK no-op.

### Scaling triggers (decided up-front)
| Component | Today | Scale when | Action |
|---|---|---|---|
| NestJS API + Gateway | 2 Fly × 2 CPU | ~5k concurrent sockets | `fly scale count` |
| Postgres (Neon) | Launch tier | DB CPU > 70% sustained | Bump compute / read replica |
| Redis (Upstash) | Pay-as-you-go | > 50% bandwidth quota | Upgrade tier |
| Socket.IO | Redis adapter | > 50k concurrent | Shard rooms by group hash |
| BullMQ workers | 1 × 1 CPU | `push` depth > 500 | Add workers (independent of API) |
| Hosting | Fly Mumbai | ~50k DAU | Migrate API to AWS ECS Fargate |

### Frontend implications — never forget these
1. **`react-native-mmkv` from day 1** — store `lastSeenSequence` per group, draft messages, settings.
2. **`zod`** — structure `src/features/*/types.ts` so they can later be replaced by imports from `packages/shared`.
3. **`expo-secure-store` for the refresh token** — NOT MMKV. MMKV is not hardware-backed.
4. **`socket.io-client`** — not raw WebSocket.
5. **Single-flight refresh mutex** on the client.
6. **`clientMessageId`** on every send for idempotency.

## 5. Directory layout

**Monorepo root** (since backend work started): `/Scale-Chat/`.
- npm workspaces, see `/package.json`.
- `apps/api/` — NestJS backend (this is where the real backend lives now).
- `packages/shared/` — zod schemas + branded types + phone helpers, imported by both the mobile app (future) and the API.
- `my-app/` — Expo app (will move to `apps/mobile/` in a later ticket; deliberately not moved yet to keep this diff small).

```
my-app/                       # the Expo app (current root)
  src/
    app/                      # expo-router file-based screens
      _layout.tsx             # root stack — registers (setup), (tabs), chat
      index.tsx               # auth-aware redirect to /(tabs), /profile, or /welcome
      (setup)/                # account-setup flow (welcome → terms → phone → otp → profile → complete)
      (tabs)/                 # post-setup home; (tabs)/index.tsx = chat list
      chat/                   # 1-on-1 chat thread screens (outside the tab bar)
        _layout.tsx
        [id].tsx              # per-thread screen
    components/               # shared visual primitives (themed-text, themed-view, …)
    constants/
      theme.ts                # Colors, Brand, FontWeight, Radius, Spacing, Fonts
    hooks/                    # use-theme, use-color-scheme
    features/
      auth/
        components/           # PillButton, PillInput, PickerPill, BrandModal,
                              #   OtpInputGroup, AvatarPicker, WelcomeCard,
                              #   SuccessBadge, SadFace
        copy.ts               # all auth strings (i18n-ready)
        data/                 # AuthRepository interface + mock impl + zod schemas + types
        hooks/                # use-auth (MMKV-backed), use-otp-mock
      chat/
        components/           # Avatar, ChatRow, ChatHeader, MessageBubble,
                              #   DayDivider, Composer
        copy.ts               # all chat strings
        data/                 # ChatRepository interface + mock impl + seed
        hooks/                # use-threads, use-thread
        types.ts              # Message, Thread, Contact (mirror future packages/shared)
    lib/
      mmkv.ts                 # MMKV singleton + StorageKeys registry
      phone.ts                # E.164 helpers, India-first validation/formatting
      format-time.ts          # bubble / thread-row / day-divider timestamp helpers
  assets/                     # images, fonts, tab icons
docs/
  brd/                        # Business Requirements Documents per feature
    1-on-1.md                 # current slice
  architecture/               # contributor reference docs
    expo-skills.md            # Expo SDK + EAS skills map
    backend.md                # PLANNED — full backend architecture doc
Scalechat Pdf (2).pdf         # canonical pitch (project root)
```

**Monorepo restructure** (to `apps/mobile`, `apps/api`, `apps/worker`, `packages/shared`) happens when backend work starts. **Not now.**

## 6. Conventions

- **Path aliases** (already in `tsconfig.json`): `@/*` → `src/*`, `@/assets/*` → `assets/*`.
- **File naming:** kebab-case files (`chat-row.tsx`), PascalCase component exports.
- **Theme tokens** live in `src/constants/theme.ts` — `Colors` (light/dark), `Brand`, `FontWeight`, `Radius`, `Spacing`. Extend, don't sprinkle. New tokens go in there.
- **Components must respect dark mode** — the Figma is dark-first.
- **Never use raw `Text` / `View` from `react-native`** in screens — always `ThemedText` / `ThemedView`.
- **Strings** live in `features/<feature>/copy.ts`, not inline JSX.
- **Mock data** is seeded with realistic Indian names + `+91` phones to match the production audience.
- **OTP length** is `4` digits. Source of truth: `OTP_LENGTH` in `features/auth/components/otp-input-group.tsx` and `OTP_DIGITS` in `features/auth/data/auth-schemas.ts` — keep them in sync.
- **MMKV keys** are centralised in `src/lib/mmkv.ts` (`StorageKeys`). Never write a raw string key inline.

## 7. Working agreement

- Default flow: **design intent → BRD → screen skeleton with mock data → polish → swap backend.**
- When you don't have the design context, **fetch it via the Figma MCP** (`get_design_context`) — don't guess from text descriptions.
- **Don't add features outside the current BRD** without updating the BRD first.
- For every Expo module: **read the v56 docs first** (see §2).

## 8. Useful commands

From `my-app/`:

```bash
npm install
npm run start          # expo start (dev server + QR)
npm run android        # open Android emulator/device
npm run ios            # open iOS simulator/device
npm run web            # open web build
npm run lint           # expo lint
npm run reset-project  # nuke starter and start fresh
```

EAS commands (build, update, submit) — see [`../docs/architecture/expo-skills.md`](../docs/architecture/expo-skills.md) §G.

## 9. Key files index

| File | Purpose |
|---|---|
| `AGENTS.md` | Expo 56 version warning — read before any Expo API call |
| `app.json` | Expo config: scheme `myapp`, splash `#208AEF`, EAS projectId, typedRoutes + reactCompiler experiments |
| `eas.json` | development / preview / production build profiles |
| `tsconfig.json` | `@/*` and `@/assets/*` path aliases |
| `src/constants/theme.ts` | Colors / Brand / FontWeight / Radius / Spacing / Fonts — the only place to add design tokens |
| `src/components/themed-text.tsx` | base text primitive |
| `src/components/themed-view.tsx` | base view primitive |
| `src/features/auth/data/auth-repository.ts` | Auth seam (mock impl in same folder) |
| `src/features/auth/hooks/use-auth.ts` | Reactive auth state (MMKV-backed) |
| `src/features/chat/data/chat-repository.ts` | Chat seam (mock impl + seed in same folder) |
| `src/features/chat/hooks/use-threads.ts` / `use-thread.ts` | Thread list + per-thread state |
| `src/lib/mmkv.ts` | MMKV singleton + `StorageKeys` registry |
| `src/lib/phone.ts` | India-first phone validation / formatting |
| `src/lib/format-time.ts` | bubble / thread-row / day-divider timestamps |
| `../docs/brd/1-on-1.md` | current BRD (1-on-1 messaging slice) |
| `../docs/architecture/expo-skills.md` | Expo SDK + libraries + EAS workflow map |
| `../Scalechat Pdf (2).pdf` | canonical pitch deck |

## 10. What's built today (status snapshot)

**Mobile (`my-app/`)** — fully against mocks, pixel-tuned to Figma:
- Account setup: `welcome` → `terms` → `phone` (confirm + invalid modals) → `otp` (4-digit boxes, error modal) → `profile` → `complete`.
- Chat list at `(tabs)/index.tsx`; persists across reload via MMKV.
- **1-on-1 thread at `chat/[id].tsx` — pixel-tuned + WhatsApp-style features:**
  - Header: diagonal-gradient purple (`#4552E4 → #707CFD`), white back button, 52px avatar, lime call buttons. Subline live: `typing…` (animated dots) > `Online` (lime) > `last seen 5m ago` > nothing.
  - Body: dark `#000` slab. Cream `#EDEDED` left bubbles, `#5360EC` right bubbles with sharp tail on streak-closing. Lime double-check on `read`.
  - **Reply**: long-press a bubble → action sheet → Reply. Composer shows a dismissable reply banner; the sent message includes `replyToMessageId` and renders a quoted preview inside its bubble.
  - **Delete**: long-press own bubble → Delete for everyone. 60-min edit window enforced by the server. Tombstone renders as italic "This message was deleted" with a slash icon.
  - **Copy**: long-press a text bubble → Copy → clipboard via `expo-clipboard`.
  - **Attachments (Figma `1:3098`)**: paperclip → `AttachmentSheet` modal (Camera / Gallery / Document / Contact / Location). Camera + Gallery wired through `expo-image-picker`. Picked image → optimistic `uploading` bubble with local preview → presigned PUT to R2 → `kind: 'IMAGE'` send. `ImageBubble` lays out against intrinsic dims, tap → full-screen `ImageViewer` with pinch-zoom (`react-native-gesture-handler` + `reanimated`).
  - **Voice notes (Figma `1:3698`)**: mic → `VoiceRecorderOverlay` (`expo-audio.useAudioRecorder`, HIGH_QUALITY m4a/AAC). Live timer + animated waveform + 5-min auto-stop. Send → presigned PUT to R2 → `kind: 'VOICE'` send. Receiver's bubble swaps the static `VoiceBlock` for `VoicePlayer` (`expo-audio.useAudioPlayer`) with progressive lime fill and current-time readout.
  - Composer: dark slab, paperclip + grey input pill + contextual scan/mic vs lime send button. Reply preview banner appears above the input when replying.
  - Day divider pill, reverse pagination on scroll-up, optimistic send with `uploading` → `sending` → `delivered`/`failed` ticks.
- Mock OTP code: `1234`.

**Backend (`../apps/api/`)** — production-grade NestJS:
- `/auth/otp/request` — MSG91, argon2 OTP in Redis, rate-limited.
- `/auth/otp/verify` — **production-wired.** argon2-verify against Redis, attempts-counter with lockout, audit row, JWT pair on success.
- `/auth/refresh` — RS256 + family rotation + replay detection.
- `/auth/signout` — revokes family.
- `/me` GET + PATCH — JWT-guarded.
- `/health`, `/ready` — Fly checks.
- Chats + Messages REST: `GET /chats`, `POST /chats/one-on-one`, `GET /chats/:chatId`, `GET /chats/:chatId/messages?direction=desc&cursor=…&limit=…`, `POST /chats/:chatId/messages` (idempotent on `clientMessageId`, per-chat sequence allocated under `pg_advisory_xact_lock`), `PATCH /chats/:id/read|favourite|archive`, `PATCH /chats/read-all`.
- **Socket.IO chat gateway** at `/chat` namespace — JWT in handshake, Upstash Redis adapter. Events:
  - `message:send` (C→S, returns durable MessageDto in ack)
  - `message:new` / `message:deleted` (S→C broadcasts — REST sends and deletes emit through the same channel)
  - `session:resume` (catch-up since `lastSeenSequence`)
  - `chat:read` (peer's read cursor advanced)
  - `typing:ping` (C→S, 5s Redis TTL) / `typing:update` (S→C broadcast)
  - `presence:request` (C→S, returns snapshot + subscribes) / `presence:update` (S→C edge transition)
- **`DELETE /chats/:id/messages/:msgId?scope=everyone`** — soft-delete; sender-only, 60-min edit window; server zeroes content + broadcasts `message:deleted`.

**Shared (`../packages/shared/`)** — zod schemas (auth + user), branded types (`Masked<T>`, `E164Phone`), phone helpers. Eventually the mobile app imports from here too (currently it has its own copies).

**Media upload pipeline** — `POST /media/upload-url` mints a 5-min presigned PUT URL to Cloudflare R2 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`). Object keys are `chat-media/{userIdFirst8}/{uuid}.{ext}`; the server validates that the prefix matches the sender on every `message:send` so a client can't paste another user's key. Public reads go through R2's CDN — no per-request signing. Media wire-format adds `mediaUrl`, `imageWidth`, `imageHeight` to `MessageDto`. Dev mode: if the R2_* env vars are unset, `/media/upload-url` returns 503 so local devs can still boot the API.

**Not yet built** — Super Groups, push notifications (needs Expo Push project + APNs/FCM creds), BullMQ workers for push fan-out, message reactions / forward / search, R2 object cleanup on delete-for-everyone, payments. All slot in behind existing interfaces.
