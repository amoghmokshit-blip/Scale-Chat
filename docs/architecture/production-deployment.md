# Production Deployment & Media Storage Architecture

> Status: reference doc. Answers three questions: (1) where media (photos/images/videos)
> and profile avatars are stored, (2) how to host the NestJS backend in production —
> recommended stack vs. a full GCP alternative, (3) how to ship the Expo app to the
> Google Play Store and Apple App Store.
>
> Authored 2026-05-27. The codebase today is built for **Fly.io + Neon + Upstash +
> Cloudflare R2** (see root `CLAUDE.md` §4 "Target backend architecture"). This doc
> takes that as the baseline and documents GCP as an alternative, not a replacement.
>
> **Scope: this is a GLOBAL platform**, not India-only. The original `CLAUDE.md` notes
> an India-first *product/locale* default (+91 phones, ₹, `HH:mm`) — that's an app-layer
> default, not an infra constraint. Infra must serve users worldwide with low latency,
> which means **edge presence in multiple regions** and a **global CDN for media**, with
> a single primary database region (chat writes are single-writer — see §2.2).

---

## 0. TL;DR — recommendations

| Concern | Recommendation | Why |
|---|---|---|
| **Media bytes** (images, video, voice, avatars) | **Object storage, never Postgres.** Keep Cloudflare R2. | Already wired (`media.service.ts`). Zero egress fees — decisive for media-heavy chat. CDN reads. DB stays small + fast to back up. |
| **Media metadata** (object key, dims, mime, size) | Postgres columns (already there: `mediaObjectKey`, `imageWidth`, …) | Tiny strings/ints. Queryable. The key points at the blob. |
| **Backend hosting** | **Stay on Fly.io (multi-region) + Neon + Upstash Global.** Use GCP only if you have credits / org mandate. | Fly does global anycast multi-region in one command — ideal for low-latency WebSockets worldwide. Lowest ops. GCP works but needs a global LB + VPC/Cloud-SQL plumbing. |
| **If GCP is required** | Multi-region **Cloud Run** behind a **global external HTTPS LB** + Cloud SQL (primary + read replicas) + Memorystore/Upstash + **R2 kept for media** | Global LB routes users to the nearest region. Cloud Run supports WebSockets w/ session affinity. |
| **Region strategy** | **Edge/compute in many regions; ONE primary DB region; read replicas elsewhere.** | Chat = single-writer Postgres. You can't multi-master messages cheaply. See §2.2. |
| **Mobile distribution** | **EAS Build → Google Play (.aab) + App Store (.ipa)** | Cloud builds; no Mac needed for iOS. `eas.json` profiles already scaffolded. Stores are global by default. |

---

## 1. Media storage — the rule and the why

### Rule: blobs go to object storage; the database stores a pointer

```
┌────────────┐  1. POST /media/upload-url        ┌──────────────┐
│   Client   │ ─────────────────────────────────▶│  NestJS API  │
│ (Expo app) │                                    │              │
│            │◀── { objectKey, uploadUrl, ... } ──│ presignUpload│
│            │                                    └──────────────┘
│            │  2. PUT bytes directly to bucket
│            │ ─────────────────────────────────▶┌──────────────┐
│            │      (presigned, 5-min TTL)        │ Cloudflare R2│ ◀── bytes live HERE
│            │                                    │   (bucket)   │
│            │  3. POST /chats/:id/messages        └──────────────┘
│            │     { mediaObjectKey }              ┌──────────────┐
│            │ ─────────────────────────────────▶│   Postgres   │ ◀── only the KEY string
└────────────┘                                    │ mediaObjectKey│     lives here
                                                   └──────────────┘
        4. Reads: client fetches https://<cdn>/<objectKey> straight off the CDN
```

**Never put image/video bytes in a Postgres `bytea`/`blob` column.** Reasons, concretely:

- **Backups & restores explode.** A 50 GB media table turns a 2-minute `pg_dump` into an hour and balloons your Neon/Cloud SQL storage bill (DB storage is ~5–10× the price of object storage per GB).
- **No CDN.** Every image read becomes a DB query + API round-trip instead of an edge-cached GET. Latency and DB CPU both suffer.
- **Connection pool starvation.** Streaming a 60 MB video out through the API holds a DB connection + a Node socket for the whole transfer. At even modest concurrency this saturates the pool.
- **The app is already correct.** `apps/api/src/modules/media/media.service.ts` issues presigned PUTs and stores only `chat-media/{userIdFirst8}/{uuid}.{ext}` keys. Keep that pattern.

### What lives where

| Data | Store | Example |
|---|---|---|
| Image/video/voice **bytes** | R2 bucket | `chat-media/3f9a2b1c/uuid.mp4` |
| Profile **avatar bytes** | R2 bucket | `profile-media/3f9a2b1c/uuid.jpg` (new prefix) |
| Object **key** | Postgres `String` | `Message.mediaObjectKey`, `User.avatarObjectKey` |
| Image dims / duration / mime / size | Postgres columns | `imageWidth`, `videoDurationSec`, `mediaMimeType` |
| Public CDN URL | **Computed, not stored** | `publicUrlFor(key)` → `https://cdn.../<key>` |

> Store the **key**, not the full URL. The CDN base URL can change (custom domain,
> provider swap); recomputing the URL from the key on read keeps you flexible. The
> backend already does this via `MediaService.publicUrlFor()`.

### Adding profile photos (the new feature)

Profile avatars are just another media kind. Minimal change, reusing the existing pipeline:

1. **Schema** — add `avatarObjectKey String?` to the `User` model (a migration). The
   existing `/me` PATCH already accepts an avatar; today it likely takes a URL — switch
   it to take an object key minted via the presign flow.
2. **Upload** — add `AVATAR` (or reuse `IMAGE`) to `MediaUploadKind` with its own size
   cap (e.g. 5 MB) and a `profile-media/` `KEY_PREFIX`. The client calls
   `POST /media/upload-url`, PUTs the cropped image to R2, then `PATCH /me { avatarObjectKey }`.
3. **Validation** — `validateObjectKey()` already enforces the `{userIdFirst8}` prefix so
   a user can't claim someone else's object. Extend the regex/prefix to allow `profile-media`.
4. **Read** — `GET /me` / `GET /users/:id/profile-card` return `avatarUrl = publicUrlFor(avatarObjectKey)`.
5. **Cleanup** — on avatar replace, enqueue a delete of the old key (deferred today for
   chat media per CLAUDE.md "R2 object cleanup … deferred"; same BullMQ worker can handle both).

> **Privacy note (Super Group invariant).** Avatars of *other* users must respect the
> Layer 0–3 privacy engine (CLAUDE.md §4). In a Super Group, a non-admin viewer must
> not receive another member's real avatar/name/phone. A profile-card avatar URL is PII
> for masking purposes — route it through `emitMasked()` / the response interceptor like
> any other identity field. In 1-on-1 chats (numbers already shared) this is a non-issue.

---

## 2. Backend hosting

The backend is a **single NestJS binary** serving REST (short-lived) **and** a Socket.IO
gateway (long-lived WebSockets), plus a **separate BullMQ worker** process (push fan-out,
ring-timeouts, media cleanup). It needs Postgres + Redis. Hosting must handle persistent
WebSocket connections well.

### Option A (recommended) — Fly.io (multi-region) + Neon + Upstash + R2

This is what the code already targets, and Fly's one-command multi-region anycast is the
single biggest reason it suits a **global** WebSocket app better than serverless: a user in
São Paulo, Frankfurt, or Singapore hits a socket gateway in *their* region, not a distant one.

| Tier | Service | Region(s) | Notes |
|---|---|---|---|
| API + Socket.IO gateway | **Fly.io** Machines | **Multiple** (e.g. `iad` US-east, `fra` EU, `sin` Asia, `gru` S-America) | Anycast routes each user to the nearest. Fly holds long-lived sockets natively; no timeout caps. `fly regions add <code>`. |
| BullMQ worker | **Fly.io** Machine (separate `worker.ts` process) | 1 region (co-located with DB primary) | Workers do DB-heavy writes — keep them next to the primary. |
| Postgres | **Neon** (autoscaling) | **1 primary** + read replicas in busy regions | Single-writer. Reads can be regional; writes go to the primary (§2.2). |
| Redis | **Upstash Global** | multi-region replicated | Socket.IO adapter + presence + OTP + rate-limit + BullMQ. Global tier replicates reads to edge regions. |
| Media | **Cloudflare R2** | global | Presigned PUT (already wired). Zero egress, global CDN — ideal for a global user base. |
| Edge | **Cloudflare** | global | TLS, DNS, WAF, CDN in front of Fly + R2; geo-routing. |

**Latency model:** WebSocket + media reads are served from the user's nearest edge/region;
only DB *writes* pay the round-trip to the primary region. For chat, write latency to a
single primary is acceptable (a message send is one insert); read/presence/media — the
high-frequency paths — stay local.

**Deploy steps (Fly):**

```bash
# one-time
fly launch --no-deploy --region iad            # primary region; generates fly.toml
fly secrets set DATABASE_URL=... REDIS_URL=... JWT_PRIVATE_KEY=... \
  R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  R2_PUBLIC_BASE_URL=... MSG91_AUTH_KEY=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...

# go global — add regions; anycast + autoscaling route users to the nearest
fly regions add fra sin gru   # EU, SE-Asia, S-America (pick per your user map)
fly scale count 2 --region iad
fly scale count 2 --region fra
# ...repeat per region. The Upstash/Redis adapter fans Socket.IO events across all of them.

# every release
fly deploy                                      # builds Dockerfile, blue-green rollout, all regions

# worker as a second process group in fly.toml, pinned to the DB-primary region:
#   [processes]
#   app    = "node dist/main.js"
#   worker = "node dist/worker.js"
```

> Pick your initial regions from where your users actually are — don't pay for regions with
> no traffic. Start with 1–2 (e.g. `iad` + `fra`) and add as analytics show demand.

> BullMQ ring-timeout jobs survive Fly's blue-green deploy (CLAUDE.md Tranche 2.H R5) —
> jobs are in Upstash, not in-process.

### Option B — Google Cloud Platform (if mandated)

Viable and production-grade for global, but you assemble the global routing yourself
(Fly gives it for free). Deploy Cloud Run in **several regions** behind a **global external
HTTPS load balancer** that routes each user to the nearest. Keep **R2 for media** (don't
pay GCS egress for global video reads). The moving parts:

| Component | GCP service | Config notes |
|---|---|---|
| Global routing | **Global external HTTPS LB** + serverless NEGs | One anycast IP; routes users to the nearest healthy Cloud Run region. This is the piece that makes GCP "global." |
| API + Socket.IO gateway | **Cloud Run** in N regions (e.g. `us-east1`, `europe-west1`, `asia-southeast1`) | `--min-instances 1` (avoid cold starts), `--session-affinity` (Socket.IO sticky), `--cpu 1 --memory 512Mi`, `--timeout 3600` (max WS lifetime). Concurrency ~250. |
| BullMQ worker | **Cloud Run** (separate service, 1 region by the DB primary) | Always-on: `--min-instances 1 --no-cpu-throttling`. Or an `e2-small` GCE MIG for a true daemon. |
| Postgres | **Cloud SQL for PostgreSQL** | 1 **primary** region, private IP, + **cross-region read replicas** in busy regions. Connect via Cloud SQL connector / serverless VPC connector. |
| Redis | **Memorystore** (regional) or **Upstash Global** | Memorystore is single-region — for global you'd run one per region or (simpler) use **Upstash Global**. **Requires a Serverless VPC Access connector** for Cloud Run → Memorystore. |
| Media | **Cloudflare R2** (keep) or **GCS** | If all-GCP: GCS multi-region bucket + V4 signed URLs + Cloud CDN. See §2.1 — R2 still preferred. |
| Image registry | **Artifact Registry** | `docker push <region>-docker.pkg.dev/PROJECT/repo/api`. |
| CI/CD | **Cloud Build** | Push → build image → `gcloud run deploy` to each region. |
| Secrets | **Secret Manager** | Mount as env vars on each Cloud Run service. |
| Edge (optional) | **Cloudflare** in front | WAF/DNS/CDN; can sit ahead of the GCP LB. |

**The WebSocket caveat (read this before choosing GCP):** Cloud Run *does* support
WebSockets, but (a) you must enable **session affinity** so a client sticks to one
instance, (b) the request timeout caps a connection at 60 min — the client must reconnect
(your `session:resume` flow already handles catch-up), and (c) instance autoscaling can
drop connections on scale-in. The **Upstash/Memorystore Redis adapter** (already in the
app) makes multi-instance fan-out correct, so reconnections land fine. For very high
concurrent-socket counts (>50k) you'd move the gateway to **GKE Autopilot** for finer
control. Fly avoids all of this — hence the Option A recommendation.

**Deploy steps (GCP / Cloud Run) — shown for the primary region; repeat per region:**

```bash
# one-time
gcloud config set project PROJECT_ID
PRIMARY=us-east1                                  # your DB-primary region
gcloud artifacts repositories create scalechat --repository-format=docker --location=$PRIMARY
gcloud sql instances create scalechat-pg --database-version=POSTGRES_16 --region=$PRIMARY --tier=db-custom-1-3840
# cross-region read replica for a busy region:
gcloud sql instances create scalechat-pg-eu --master-instance-name=scalechat-pg --region=europe-west1
gcloud compute networks vpc-access connectors create scalechat-vpc --region=$PRIMARY --range=10.8.0.0/28
# store secrets
echo -n "$DATABASE_URL" | gcloud secrets create DATABASE_URL --data-file=-
# (repeat for REDIS_URL, JWT keys, R2_*, MSG91, LIVEKIT_*)

# build + deploy API to the primary region (repeat with --region for each extra region)
gcloud builds submit --tag $PRIMARY-docker.pkg.dev/PROJECT_ID/scalechat/api
gcloud run deploy scalechat-api \
  --image $PRIMARY-docker.pkg.dev/PROJECT_ID/scalechat/api \
  --region $PRIMARY --min-instances 1 --session-affinity --timeout 3600 \
  --vpc-connector scalechat-vpc \
  --add-cloudsql-instances PROJECT_ID:$PRIMARY:scalechat-pg \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,REDIS_URL=REDIS_URL:latest,R2_ENDPOINT=R2_ENDPOINT:latest # …etc
  --allow-unauthenticated

# deploy worker as its own always-on service (primary region only)
gcloud run deploy scalechat-worker \
  --image $PRIMARY-docker.pkg.dev/PROJECT_ID/scalechat/api \
  --command node --args dist/worker.js \
  --region $PRIMARY --min-instances 1 --no-cpu-throttling \
  --vpc-connector scalechat-vpc --add-cloudsql-instances PROJECT_ID:$PRIMARY:scalechat-pg \
  --no-allow-unauthenticated

# then: put a GLOBAL external HTTPS LB in front of the per-region Cloud Run services
# via serverless NEGs (one backend per region) so users hit the nearest one.
```

Run Prisma migrations on deploy: add `npx prisma migrate deploy` to the container
entrypoint or a one-shot Cloud Build step — **against the primary only** (replicas are read-only).

### 2.1 If you want media on GCS instead of R2

The app uses `@aws-sdk/client-s3` + a presigned PUT. Two paths:

- **Easiest:** point the existing S3 client at GCS's **S3-compatible XML API** (set
  `R2_ENDPOINT` to `https://storage.googleapis.com`, use an HMAC key as access/secret).
  Near-zero code change.
- **Native:** swap `media.service.ts` to `@google-cloud/storage` `getSignedUrl({ action:
  'write', version: 'v4' })`. Reads via Cloud CDN over a bucket-backed backend.

> **Still prefer R2 even on GCP.** GCS charges egress (~$0.08–0.12/GB) on every media
> read; R2 charges **$0** egress. For a chat app where every delivered image/video is a
> download, this is the single biggest cloud-cost lever. Keep media on R2 regardless of
> where the API runs. (R2 + Cloudflare's CDN is already global — for a global user base
> this is the part you do NOT need to re-architect.)

### 2.2 Data locality — the one genuinely hard part of going global

A chat app's database is **single-writer**: every message INSERT, read-cursor bump, and
sequence allocation (`pg_advisory_xact_lock`) must hit one primary Postgres. You cannot
cheaply multi-master this without conflict-resolution machinery you don't want to build.
So the global pattern is:

- **One primary DB region.** Pick it near your largest user cluster (or a neutral hub like
  US-East / EU-West). All writes go here.
- **Read replicas in other busy regions** for read-heavy, latency-sensitive paths
  (chat-list load, message history pagination, profile cards). Route reads to the nearest
  replica; route writes to the primary.
- **Edge-local for everything that isn't a DB write:** WebSocket connections (regional Fly
  Machine / Cloud Run), presence/typing (Upstash Global / regional Redis), media (R2 CDN).
- **Latency budget:** a user in a far region pays the cross-region RTT only on *writes*
  (~100–250 ms to the primary). Message send is a single insert, so this is tolerable.
  Reads, presence, typing, and media — the high-frequency interactive paths — stay local
  and fast.

If you ever outgrow single-primary write throughput, the next step is **sharding by chat
room** (route a room's writes to a regional primary), but that's a large project — defer it
until write volume actually demands it. For launch-through-mid-scale, single-primary +
regional read replicas + edge compute is the right global architecture.

> **Compliance footnote (global ⇒ data residency).** Serving the EU (GDPR), India (DPDP
> Act), and others may eventually require keeping certain users' data in-region. Single-
> primary Postgres conflicts with strict residency. If/when a regulated market demands it,
> the path is regional data partitions (separate DB per residency zone) — note it now, build
> it only when a market requires it. Don't pre-build it.

---

## 3. Mobile distribution (Android + iOS)

**Apps do not deploy to a server.** Android → Google Play, iOS → App Store. Both are built
in the cloud by **EAS Build** (Expo Application Services). **You do not need a Mac** — EAS
builds iOS on hosted macOS runners. (A Mac is only needed for *local* iOS builds.)

> Per CLAUDE.md §7.5, EAS Build is the Tranche 2.I deliverable; `eas.json` profiles
> (`development` / `preview` / `production`) already exist. This section is the runbook to
> take them to the stores.

### Prerequisites (one-time)

- **Apple:** Apple Developer Program membership (**$99/yr**) → App Store Connect app record.
- **Google:** Google Play Developer account (**$25 one-time**) → Play Console app record.
- `npm i -g eas-cli` and `eas login`.
- Bump `production` profile env in `eas.json` to the real API URL (today `preview` points at
  an ngrok tunnel — production must point at the deployed Fly/Cloud-Run URL with
  `EXPO_PUBLIC_USE_MOCKS=false`).

### Build

```bash
cd my-app

# Android production app bundle (.aab) for Play Store
eas build --platform android --profile production

# iOS production build (.ipa) — runs on EAS macOS runners, no local Mac needed
eas build --platform ios --profile production
# first iOS build will prompt to create/manage signing credentials (let EAS manage them)
```

`production` already sets `autoIncrement: true` (version code/build number bumps
automatically) and `buildType: app-bundle` for Android.

### Submit to stores

```bash
# Android → Google Play (needs a Play service-account JSON; configure in eas.json submit)
eas submit --platform android --profile production --latest

# iOS → App Store Connect
eas submit --platform ios --profile production --latest
```

Then in each console: fill store listing (screenshots, description, privacy questionnaire),
attach the uploaded build to a release track (Play: internal → closed → production; Apple:
TestFlight → App Store review), and submit for review.

### Native config reminders (CNG)

- `my-app/android/` and `ios/` are **gitignored** (Continuous Native Generation). All native
  config lives in `app.json` plugins. Never hand-edit the native folders.
- Confirm `app.json` has: unique `ios.bundleIdentifier` + `android.package`, app icons,
  splash, and every permission string (contacts, camera, mic, notifications — the call +
  contacts features need `NSContactsUsageDescription`, `NSMicrophoneUsageDescription`,
  `NSCameraUsageDescription` for iOS review to pass).
- The K2 Gradle-heap plugin (`plugins/with-android-gradle-heap.js`, 4 GB) and the LiveKit
  WebRTC plugins must be present for the call feature to build (CLAUDE.md Tranche 2.I I.4).

### Over-the-air updates

For JS-only changes (no native dep change), ship via **EAS Update** without a store
re-review:

```bash
eas update --branch production --message "fix: ..."
```

Native changes (new native module, permission, SDK bump) still require a full
`eas build` + store submission.

---

## 4. Environment & secrets checklist

Backend (Fly secrets / Cloud Run Secret Manager):

```
DATABASE_URL                 # Neon / Cloud SQL connection string
REDIS_URL                    # Upstash / Memorystore
JWT_PRIVATE_KEY / JWT_PUBLIC_KEY   # RS256 access-token keypair
R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_PUBLIC_BASE_URL
MSG91_AUTH_KEY               # OTP send
LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL   # calls
LIVEKIT_WEBHOOK_KEY          # webhook HMAC verify
EXPO_ACCESS_TOKEN            # push notifications (notifyCall)
```

Mobile (`eas.json` per-profile `env`, public-safe only — `EXPO_PUBLIC_*`):

```
EXPO_PUBLIC_API_URL=https://api.scalechat...   # deployed backend, NOT ngrok in production
EXPO_PUBLIC_USE_MOCKS=false
```

> Never put server secrets in `EXPO_PUBLIC_*` — those are bundled into the shipped app and
> are readable by anyone who downloads it.

---

## 5. Cost ballpark (early production, ~1–5k DAU)

| Item | Fly stack | GCP stack |
|---|---|---|
| API + worker compute | ~$10–40/mo (Fly Machines) | ~$15–60/mo (Cloud Run min-instances) |
| Postgres | Neon Launch ~$19/mo | Cloud SQL db-custom-1 ~$50/mo + storage |
| Redis | Upstash pay-as-you-go ~$0–10/mo | Memorystore Basic 1 GB ~$35/mo |
| Media (R2) | storage ~$0.015/GB + **$0 egress** | (same if R2 kept) |
| Apple Developer | $99/yr | $99/yr |
| Google Play | $25 once | $25 once |

GCP's managed Postgres + Redis carry a higher always-on floor; Fly + serverless DB/Redis
is cheaper at this stage. The gap narrows at scale where GCP's autoscaling and committed-use
discounts help.

---

## 6. Decision summary

- **Media/avatars → object storage (R2). Never the database.** Already implemented; extend
  the same presign flow to profile photos with a `profile-media/` prefix. R2 + Cloudflare
  CDN is already global — no re-architecture needed for worldwide users.
- **Backend → Fly.io multi-region recommended** for a global WebSocket-heavy app (one-command
  anycast regions); **GCP (multi-region Cloud Run behind a global LB + Cloud SQL primary &
  read replicas + R2) is a fully documented alternative** if required, with the
  session-affinity / 60-min-timeout caveats noted in §2.
- **Region strategy → edge/compute in many regions, ONE primary DB region, read replicas
  elsewhere** (§2.2). Only DB writes pay the cross-region hop; reads/presence/media stay local.
- **Mobile → EAS Build → Play Store (.aab) + App Store (.ipa).** No Mac needed; profiles
  already in `eas.json`; flip the production API URL off ngrok before release.

### Global-readiness gaps to track (not infra, but they block "global")

- **SMS OTP provider.** The backend uses **MSG91**, which is India-centric. A global launch
  needs a global SMS provider (Twilio Verify, AWS SNS, Vonage) or a regional provider matrix
  — MSG91 deliverability outside India is poor. This is the most concrete global blocker.
- **Locale/i18n.** App defaults are India-first (+91 phones, ₹, `HH:mm`). Phone input must
  accept all country codes; currency/time formatting must follow device locale. Strings are
  already isolated in `features/*/copy.ts` for a future i18n layer (CLAUDE.md §3).
- **Calls (LiveKit).** Already global — LiveKit Cloud has worldwide edge SFUs; just confirm
  the project/region config isn't pinned to one region.
```
