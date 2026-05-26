# ScaleChat — Developer Onboarding

Welcome. This is the one-page on-ramp for a new developer. It points at the
canonical docs rather than duplicating them — read it top to bottom once, then
keep `my-app/instruction-to-run-the-app.md` open while you set up.

---

## 1. What this is

**ScaleChat** — a privacy-first, India-first 1-on-1 chat app. Expo SDK 56 / React
Native 0.85 mobile client + a NestJS (Fastify + Prisma + Postgres + Redis +
Socket.IO + Cloudflare R2) backend, in an npm-workspaces monorepo. The eventual
hero feature is **Super Groups** (disintermediated group chat); the 1-on-1 chat
shipping now is the foundation it sits on.

Canonical product/architecture brief: **`my-app/CLAUDE.md`**. Repo map + status
table: **root `CLAUDE.md`**.

## 2. Layout

```
my-app/                # Expo mobile app (most feature work is here)
apps/api/              # NestJS backend
packages/shared/       # zod schemas + branded types + phone helpers (imported by both)
docs/progress/         # BRDs + per-tranche status (the project's memory)
```

## 3. Get it running (Android emulator, Windows/Mac/Linux)

Full guide with gotchas: **`my-app/instruction-to-run-the-app.md`**. Short version:

```bash
# Prereqs: Node >= 20, JDK 17, Android Studio + an AVD (Pixel / API 34)
git clone <repo> && cd <repo>
npm install                      # from the REPO ROOT — never from my-app/ (de-hoists expo-router, K11)

# my-app/.env.local  (gitignored — create your own):
#   EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
#   EXPO_PUBLIC_USE_MOCKS=true     # start in mock mode — no backend needed

# Start the emulator from Android Studio, then:
cd my-app && npm run dev:android   # FIRST run = full native build, 20-45 min on Windows
# after that, day-to-day is just:  npm run dev:start
```

> ⚠️ **You must do a full native build first.** This checkout already includes
> native modules (`expo-video`, `expo-document-picker`, `expo-location`,
> `expo-audio`, `expo-image-picker`, `expo-contacts`, `react-native-mmkv`).
> Expo Go and a plain `dev:start` will crash with "native module not found"
> until `dev:android` has built + installed the dev client once. Re-run
> `npm run prebuild:android && npm run dev:android` whenever you pull a branch
> that touched `app.json` plugins or added a native dep.

### Mock vs live

- **Mock (`EXPO_PUBLIC_USE_MOCKS=true`)** — recommended to start. Runs fully
  offline against the committed seed (`my-app/src/features/chat/data/seed.ts`):
  realistic +91 contacts/threads + sample image/voice/document/video/location/
  contact messages. **Auth is mocked** — onboard with any +91 number, OTP
  **`1234`**, any name. There is no shared account and no DB dump; everyone gets
  the same seed on a fresh install.
- **Live (`EXPO_PUBLIC_USE_MOCKS=false`)** — needs the backend:
  `npm run db:setup` (once, starts docker Postgres/Redis + applies migrations)
  then `npm run api:dev` (port 4000). OTP is real MSG91 SMS unless the backend
  runs with `ENABLE_DEV_OTP=true` + `DEV_OTP_CODE`.

## 4. Architecture you must know

- **Frontend-first + repository pattern.** Screens read through a typed
  `ChatRepository` interface with two implementations — `mock-chat-repository.ts`
  (in-memory + MMKV) and `api-chat-repository.ts` (REST + Socket.IO + an in-memory
  cache fed by socket events). `EXPO_PUBLIC_USE_MOCKS` picks one. Build + QA
  against the mock; the real API satisfies the same interface.
- **Shared contract.** Wire types live in `packages/shared` (zod). The mobile DTO
  → domain mapping is `dto-to-message.ts`. **Gotcha:** a *value* import from
  `@scalechat/shared` breaks the Jest module graph (Jest maps it to TS source) —
  files in the test graph must take constants as args or keep type-only imports.
- **Native build = CNG.** `my-app/android/` is gitignored and regenerated from
  `app.json` + plugins. Never edit `android/` directly — change `app.json` and
  re-prebuild.
- Privacy/India-first conventions, theme tokens, copy-in-`copy.ts`, MMKV,
  single-flight refresh — all in `my-app/CLAUDE.md`.

## 5. How work is done here (important)

Per `my-app/CLAUDE.md` §7 — the **self-learning doc loop is non-negotiable**:
every behavior-changing commit updates the root `CLAUDE.md` status table **and**
the matching `docs/progress/<slice>.md` in the same PR (or uses
`[skip-claudemd] <reason>`). The repo is the project's memory.

Features ship in small **tranches**, each: plan → (multi-agent review) →
implement → tests + emulator QA → docs → commit. The current slice's plan +
per-tranche status is **`docs/progress/1-on-1-chat-expansion.md`** — read its
tranche map first.

Tests: `cd my-app && npm test` (Jest, babel-jest — not tsc). Backend e2e:
`npm run api:test:e2e` (needs docker Postgres/Redis; this env overrides ports via
`TEST_DATABASE_URL_BASE` / `TEST_REDIS_URL`).

## 6. Status + where to pick up

**Shipped** (chat-expansion slice): reactions (2.A), schema foundation (2.B),
document + video (2.C), location + contact (2.D), forward + pin (2.E). The
attachment surface is complete.

**Next, in order of readiness:**
1. **2.F Polls** — full-stack (new migration + `PollsModule` + composer + bubble).
   Ships on the current mock/emulator flow.
2. **2.H Calls signalling (backend)** — the headline feature. Gated on a
   LiveKit-vs-100ms provider POC; introduces WebRTC.
3. **2.I Call UI + push + EAS** — depends on 2.H; first tranche to need EAS Build
   + an Apple Developer account + iOS.

Start here: `docs/progress/1-on-1-chat-expansion.md` (tranche map + the
Knowledge base K1–K12 of native-dep gotchas).

## 7. When stuck

`my-app/instruction-to-run-the-app.md` § "When something is broken" + the K1–K12
Knowledge base in `docs/progress/1-on-1-chat-expansion.md`. The most common one:
after pulling native-dep changes, re-run `npm run prebuild:android && npm run dev:android`.
