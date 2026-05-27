is> The concrete modules, libraries, and EAS workflow the team will exercise to build ScaleChat on Expo SDK 56.

**Hard rule** (repeated from CLAUDE.md): for **every** module below, read the v56 docs at https://docs.expo.dev/versions/v56.0.0/ before first use. Expo APIs shift across versions and the AGENTS.md file enforces this.

---

## A. Core navigation & routing

| Module | Status | Purpose |
|---|---|---|
| `expo-router` | ✅ installed (~56.2.5) | File-based routing, typed routes (enabled via `experiments.typedRoutes`) |
| `expo-router/unstable-native-tabs` | ✅ in use | Current 2-tab bar; **likely to be replaced** by a custom 5-slot tab bar with center FAB to match the Figma. Decision belongs in the next implementation plan |
| `expo-linking` | ✅ installed | Deep-links (`myapp://chat/:id`, `myapp://contact/:id` per BRD §5) |

**What to master:** layout files (`_layout.tsx`), typed route segments, modal presentation, custom `Tabs` layout when NativeTabs runs out of road.

---

## B. Media — voice notes, attachments, avatars

| Module | Status | Purpose |
|---|---|---|
| `expo-av` (or `expo-audio` if 56 ships it) | ⬜ install | Voice-note recording + playback. **Verify the v56 surface** — Expo has been splitting `expo-av` into `expo-audio` + `expo-video`; confirm which exists in SDK 56 before importing |
| `expo-image` | ✅ installed (~56.0.8) | Cached avatar/image rendering |
| `expo-image-picker` | ⬜ install | Gallery attachments from chat input bar |
| `expo-document-picker` | ⬜ install | File attachments |
| `expo-file-system` | ⬜ install | Persist recorded voice notes locally (`uri` field on `Message.voice`) |
| `expo-camera` | ⬜ defer | "Scan" icon in chat input bar; not in this slice |
| `expo-contacts` | ⬜ install | **Device address-book sync** (per BRD §12). Permission prompt deferred until user taps Add Contact for the first time, not at cold start |

**What to master:** `Audio.Recording` lifecycle (start/stop/save), interruption handling (incoming call, route changes), `Audio.Sound` playback, file URIs and cleanup.

---

## C. Persistence

| Module | Status | Purpose |
|---|---|---|
| `expo-secure-store` | ⬜ install | **Refresh token storage** — Keychain (iOS) / Keystore (Android). Hardware-backed. **DO NOT** put refresh tokens in MMKV |
| `react-native-mmkv` | ⬜ install | Fast key-value store. Required for `lastSeenSequence` per group (backend protocol), draft messages, settings, theme preference |

**Boundary rule (do not blur):**
- Secrets (refresh token, OTP draft) → `expo-secure-store`.
- Everything else (sequence numbers, drafts, settings, last-opened-thread) → `react-native-mmkv`.

---

## D. Realtime & data

| Module | Status | Purpose |
|---|---|---|
| `socket.io-client` | ⬜ install | Matches the backend gateway transport. Not raw WebSocket |
| `@tanstack/react-query` | ⬜ install | REST cache + invalidation; integrates cleanly with the repository pattern (`useQuery` wraps `repo.listThreads()`) |
| `zod` | ⬜ install | Schema validation shared with the eventual `packages/shared`. Define `messageSchema`, `sendMessageSchema`, `replayRequestSchema` to mirror backend |

**Client-side contract obligations** (from CLAUDE.md §4 backend):
- Single-flight refresh mutex on the client (a singleton promise around the refresh call) to avoid concurrent 401 storms.
- `clientMessageId` on every send (use `crypto.randomUUID()` polyfill or `nanoid`).
- Store `lastSeenSequence` per group in MMKV; emit `session:resume` on socket connect.

---

## E. Native polish

| Module | Status | Purpose |
|---|---|---|
| `expo-haptics` | ⬜ install | Light haptic on send, medium on long-press, success on premium upsell tap |
| `expo-clipboard` | ⬜ install | Copy phone numbers, copy message text |
| `expo-sharing` | ⬜ install | Export Chat flow (stub for now) |
| `expo-notifications` | ⬜ install (no wiring yet) | Push notifications — defer wiring until backend ready, but install + add iOS push entitlement now so EAS Build doesn't surprise us later |
| `expo-symbols` | ✅ installed (~56.0.5) | iOS SF Symbols with Android fallback |
| `expo-status-bar` | ✅ installed | Status bar styling per screen |
| `expo-splash-screen` | ✅ installed | Custom splash already configured (`#208AEF`) |
| `expo-glass-effect` | ✅ installed | Available for blur/glassmorphism if Figma needs it |
| `react-native-reanimated` | ✅ installed (4.3.1) | Bubble lift on long-press, sheet drag, swipe-to-reply |
| `react-native-gesture-handler` | ✅ installed (~2.31.1) | Long-press, swipe, tap-cancel detection |
| `react-native-safe-area-context` | ✅ installed | Safe area insets (already used in `index.tsx`) |
| `react-native-screens` | ✅ installed | Native stack screens (used by expo-router) |
| `react-native-worklets` | ✅ installed | Reanimated 4 dependency |

---

## F. India-specific

| Module | Status | Purpose |
|---|---|---|
| `libphonenumber-js` | ⬜ install | `+91` parsing/validation for Add Contact, OTP-input flows |
| `dayjs` | ⬜ install | `HH:mm`, `Yesterday`, `DD/MM/YY` formatting per Figma. If we can avoid the dep, use `Intl.DateTimeFormat('en-IN')` — but `dayjs` is ~7kb and the team's mental model is faster |

Locale defaults: `en-IN` for `Intl.NumberFormat`. Phone E.164 with default region `IN`.

---

## G. Build & ship (EAS)

`eas.json` already configures three profiles. The workflow:

```bash
# Login (once per machine)
npx eas-cli@latest login

# Build dev clients (one each)
npx eas-cli build --profile development --platform ios
npx eas-cli build --profile development --platform android

# Install the dev client APK on an Android device, then:
npm run start --dev-client

# Internal preview build for stakeholders (shareable link)
npx eas-cli build --profile preview --platform android

# Production build (signed for store submission)
npx eas-cli build --profile production --platform all

# OTA update (after first store submission)
npx eas-cli update --branch production --message "fix: ..."

# Submit to stores
npx eas-cli submit --platform android   # Play Store
npx eas-cli submit --platform ios       # App Store
```

**Why dev client (not Expo Go):** several modules above need native code that Expo Go doesn't ship — `react-native-mmkv`, `expo-secure-store`'s native keychain, `expo-notifications` push, and the eventual `socket.io-client` over WSS. EAS dev client is the right surface from sprint 1.

EAS project ID is already in `app.json`: `bf7ca872-bc59-4bc4-9c9c-c2e883c47292`.

---

## H. Things explicitly NOT picked yet

| Decision | Status | When to decide |
|---|---|---|
| Backend BaaS | Mocks for now; real NestJS per CLAUDE.md §4 later | When frontend validates user demand |
| Calling provider | Undecided (Agora / Twilio / Stream / Daily) | Calls BRD |
| Push provider | FCM via `expo-notifications` is the default | Push BRD |
| Crash reporting | Sentry pencilled in; not installed | Pre-launch (before first store submission) |
| Analytics | Undecided (PostHog / Amplitude / Mixpanel) | Post-MVP |

---

## I. Reading order — what to absorb first

For a solo founder learning the stack while shipping:

1. **`expo-router` v56** — routing, typed routes, layouts, modals, stack vs tab navigators. Without this, file structure is guesswork.
2. **Reanimated 4 + gesture-handler v2** — bubble interactions, sheet animations, swipe-to-reply. Animation/gesture bugs are the slowest to debug; learn the model up front.
3. **`expo-av` (or `expo-audio`) lifecycle** — recording + playback + interruption handling. Voice notes are the most error-prone message kind.
4. **MMKV + secure-store boundaries** — internalize what goes where (see §C).
5. **EAS dev client setup** — without this you can't run native modules; learn before you install MMKV.
6. **TanStack Query patterns** — `useQuery`, `useMutation`, `invalidateQueries`, optimistic updates. The send-message flow hinges on optimistic updates.
7. **socket.io-client + reconnect handling** — the protocol from CLAUDE.md §4 lives here. Replay logic is non-trivial.

Anything not on this list can be picked up just-in-time when a BRD demands it.

---

## J. Cross-references

- Stack pinning + the hard rule: `my-app/CLAUDE.md` §2.
- Target backend the client talks to: `my-app/CLAUDE.md` §4.
- 1-on-1 BRD that exercises most of A–F: `docs/brd/1-on-1.md`.
