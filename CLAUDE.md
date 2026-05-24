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
```

## Where backend work lives

`apps/api/` — read its [`README.md`](apps/api/README.md) before changing anything in `apps/api/src/common/` (privacy interceptor, refresh-rotation, JWT). Those are load-bearing for chat once it ships.

## Status snapshot

| Slice | Mobile | Backend | Notes |
|---|---|---|---|
| Welcome / Terms / Phone | ✅ | n/a | UI only |
| OTP request | ✅ (mock) | ✅ | MSG91 + Redis + rate limit |
| OTP verify | ✅ mock + real | ✅ argon2 + Redis | argon2-compares against Redis, attempts counter with lockout, burns key on success, mints JWT pair, marks `otp_requests` row VERIFIED |
| Profile (`/me`) | ✅ (mock + real) | ✅ | JWT-guarded GET + PATCH |
| Refresh / signout | ✅ (mock + real) | ✅ | Family rotation, replay detect |
| 1-on-1 chat (Figma) | ✅ pixel-tuned | n/a | gradient header, lime call buttons, purple/cream bubble pair, dark composer, day-divider pill, tombstones |
| 1-on-1 chat (live) | ✅ optimistic + reverse paginated | ✅ REST + Socket.IO | GET/POST `/chats/:id/messages?direction=desc&cursor=…`; Socket.IO `/chat` namespace with Redis adapter; REST send broadcasts via the gateway so both transports see the same `message:new` event; in-memory message cache fed by socket; `sending` / `failed` tick state; FlatList pulls older pages on scroll-up |
| Typing indicator | ✅ live | ✅ Redis TTL | Gateway `typing:ping` (5s TTL) → `typing:update`; client emits at most every 2.5s while typing; receiver shows animated three-dot indicator under the counterpart name |
| Presence (online/last seen) | ✅ live | ✅ Redis counters | `presence:count:{userId}` INCR on connect, DECR on disconnect; on `count==0` server writes `lastSeenAt` and broadcasts. Client header subline shows "Online" / "last seen 5m ago" |
| Read receipts | ✅ live | ✅ | `chat:read` broadcast on REST mark-read; sender's bubble tick flips lime |
| Reply to message | ✅ | ✅ | `replyToMessageId` plumbed through send (REST + socket); composer reply-preview banner with dismiss; quoted preview rendered inside the reply bubble |
| Delete for everyone | ✅ + tombstones | ✅ | `DELETE /chats/:id/messages/:msgId?scope=everyone`, sender-only, 60-min edit window; soft-delete + `message:deleted` broadcast; client renders "This message was deleted" |
| Long-press action sheet | ✅ | n/a | Reply / Copy (text) / Delete for everyone (mine) — modal sheet |
| Image messages | ✅ pick + capture + bubble + viewer | ✅ R2 + key validation | Figma `1:3098` attachment sheet → `expo-image-picker` (gallery/camera) → presigned PUT to Cloudflare R2 → `POST /chats/:id/messages` with `mediaObjectKey`. Image bubble renders against intrinsic dims, tap → full-screen pinch-zoom viewer. Optimistic `uploading → sending → delivered` ticks. |
| Voice notes (record + play) | ✅ recorder overlay + playable bubble | ✅ R2 + key validation | Figma `1:3698` recorder overlay (`expo-audio` `useAudioRecorder`, HIGH_QUALITY m4a/AAC, animated waveform, 5-min cap). Bubble swaps the static visual for `expo-audio.useAudioPlayer` with progressive lime fill. |
| Media uploads | ✅ presigned PUT | ✅ Cloudflare R2 | `POST /media/upload-url` returns `{ objectKey, uploadUrl, publicUrl, expiresAt }` (5-min TTL). Server validates that the inbound `mediaObjectKey` carries the sender's `userIdFirst8` prefix and the right extension for the message kind. |
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
