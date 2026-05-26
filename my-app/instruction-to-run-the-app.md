# How to run the ScaleChat mobile app locally

> Local Android dev-client flow on Windows. iOS + EAS deferred to Tranche 2.I per [`../docs/progress/1-on-1-chat-expansion.md`](../docs/progress/1-on-1-chat-expansion.md). If you're on macOS and want iOS, the EAS migration tranche is the right time to onboard — for now, Android emulator is the canonical dev path.

---

## Prerequisites

- **Node ≥ 20** — `node --version` to check. Use `nvm-windows` if you need to switch versions.
- **JDK 17** — Android Gradle Plugin 8.x requires it. Recommended: [Microsoft OpenJDK 17](https://learn.microsoft.com/en-us/java/openjdk/download) or [Adoptium Temurin 17](https://adoptium.net/temurin/releases/?version=17). Set `JAVA_HOME` env var to the install path. Verify with `java -version` → should print `17.x.x`.
- **Android Studio** — install from [developer.android.com/studio](https://developer.android.com/studio). On first run, let it finish downloading the Android SDK + platform tools.
- **At least one configured AVD (Android Virtual Device)** — recommend Pixel 7 / API 34. Open Android Studio → "More Actions" → "Virtual Device Manager" → create a device. Hardware acceleration (HAXM on Intel, WHPX on AMD) makes a big difference; enable it during Android Studio setup.
- **Backend running on port 4000** — see [root README](../README.md) or [root CLAUDE.md](../CLAUDE.md). Quick start: `npm run api:dev` from the repo root.

---

## First-time setup

From the **repo root** (not `my-app/`):

```powershell
# 1. Install all workspaces (root + my-app + apps/api + packages/shared)
npm install

# 2. Bootstrap the backend DB (first time only, or after schema changes)
npm run db:setup

# 3. Start the backend (runs on http://localhost:4000)
npm run api:dev
```

Leave the backend running in one terminal. In a **second terminal**, configure the mobile app:

```powershell
# 4. Create the mobile env file. The Android emulator can't reach `localhost`
#    — it must use 10.0.2.2 (gateway to host). Create my-app/.env.local with:
#       EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
#       EXPO_PUBLIC_USE_MOCKS=true      # mock data, no backend needed (recommended to start)
#    (.env.local is gitignored — each developer creates their own.)
#
#    EXPO_PUBLIC_USE_MOCKS=true  → the app runs fully offline against the committed
#      mock seed (realistic +91 contacts/threads + sample image/voice/document/
#      video/location/contact messages). Auth is mocked: any +91 number, OTP `1234`,
#      any name. No backend required — best way to start.
#    EXPO_PUBLIC_USE_MOCKS=false → live backend (steps 2–3 above). OTP is real MSG91
#      SMS unless the backend runs with ENABLE_DEV_OTP=true + DEV_OTP_CODE set.
```

In a **third terminal**:

```powershell
# 5. Start the Android emulator from Android Studio's AVD Manager (UI), then:
cd my-app
npm run dev:android
```

The first run will:
1. Compile the Android native code (Gradle, ~5–15 min cold; faster on warm cache)
2. Install the dev-client APK on the emulator
3. Open Metro bundler
4. Auto-connect the dev-client to Metro
5. Show the app's welcome / auth / contact-page flow

---

## Day-to-day

Once you've done a `dev:android` install at least once, every subsequent run is just Metro:

```powershell
cd my-app
npm run dev:start
```

The emulator's dev-client auto-connects. If the emulator isn't running, start it from Android Studio first.

---

## When to re-prebuild

`my-app/android/` is treated as a **build artifact** regenerated from `app.json` + plugin configs (Continuous Native Generation pattern; see [`CLAUDE.md`](./CLAUDE.md) §7.5). You must re-prebuild whenever:

- A plugin is added or removed in `app.json` (`expo.plugins` array)
- A dependency with native code is added (e.g., a future `@100mslive/*` package in Tranche 2.I)
- You pulled a branch that touched `app.json` plugins or native deps
- Gradle is misbehaving in an inexplicable way

Command:

```powershell
cd my-app
npm run prebuild:android
```

Add `--clean` (already included in the script) to nuke + regenerate. After re-prebuild, you need to **reinstall the dev-client** via `npm run dev:android` so the emulator picks up the new native code.

---

## Top 5 gotchas

1. **Emulator can't reach backend at `localhost:4000`.** The emulator's `localhost` is the emulator itself, not the host. Use `http://10.0.2.2:4000` in `my-app/.env.local`. If you skip this, you'll see network errors on every API call and the chat list will be empty.

2. **Metro cache stale after dep change.** Symptoms: import errors, "module not found", weird type mismatches. Fix:

   ```powershell
   cd my-app
   npm run dev:start -- --clear
   ```

3. **Gradle daemon stuck.** Symptoms: build hangs at "Configuring project :app" or "Resolving dependencies" with no progress. Fix:

   ```powershell
   cd my-app/android
   ./gradlew --stop
   ```

   Then re-run `npm run dev:android`.

4. **App crashes after installing a new native module.** This usually means the dev-client APK on the emulator is stale (it was built without the new native code). Re-run `npm run prebuild:android && npm run dev:android` to rebuild + reinstall.

5. **First build after a new native dep takes 20–45 minutes on Windows.** Don't kill it. This applies whenever a future tranche adds a native module (per the Tranche 2.0 Knowledge base in `docs/progress/1-on-1-chat-expansion.md`). Cold Gradle cache + 4 ABIs (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`) + Hermes codegen = a lot of compute. Subsequent builds are dramatically faster.

---

## Current state (what's shipped)

The chat-expansion attachment slice is **complete**. Shipped tranches: 2.A (reactions), 2.B (schema foundation), 2.C (document + video), 2.D (location + contact), 2.E (forward + pin). Per-tranche detail: [`docs/progress/1-on-1-chat-expansion.md`](../docs/progress/1-on-1-chat-expansion.md).

> **Native deps are already in this checkout** (`expo-image-picker`, `expo-audio`, `expo-contacts`, `expo-video`, `expo-document-picker`, `expo-location`, `react-native-mmkv`, …). So your **first run MUST be a full native build** — `npm run dev:android` (which prebuilds + compiles + installs the dev client). Expo Go and a plain `npm run dev:start` will fail with "native module not found" until the dev client is built once.

### Still to do (later tranches)

- **2.F Polls** — full-stack (new migration + PollsModule + composer + bubble). Doable on this mock/emulator flow.
- **2.H Calls signalling (server)** — the headline. Needs a LiveKit-vs-100ms provider POC + WebRTC.
- **2.I Call UI + push + EAS** — depends on 2.H; first tranche to require **EAS Build + an Apple Dev account** + **iOS** (Mac + Xcode or EAS cloud builds). Push notifications (`expo-notifications`) land here too.

Each tranche that adds a native dep addresses its row in the **Knowledge base** (MultiDex, Gradle heap, ABI restriction, Maps API key, AudioFocus, duplicate `libwebrtc.so`, etc.) — see [`docs/progress/1-on-1-chat-expansion.md`](../docs/progress/1-on-1-chat-expansion.md) § "Knowledge base for future native-dep tranches" (K1–K12).

---

## When something is broken

Try these in order:

1. `cd my-app && npm run prebuild:android` (re-sync native modules)
2. `cd my-app && npm run dev:start -- --clear` (clear Metro cache)
3. `cd my-app/android && ./gradlew --stop` (kill stuck Gradle daemon)
4. Wipe the emulator's app data: AVD Manager → ⋮ → "Wipe Data"
5. Last resort: delete `my-app/node_modules` + `my-app/android` + `my-app/.expo`, run `npm install` from repo root, then `npm run prebuild:android && npm run dev:android` from `my-app/`.

If none of that works, check the [Tranche 2.0 Knowledge base](../docs/progress/1-on-1-chat-expansion.md#knowledge-base-for-future-native-dep-tranches) (K1–K10) for known gotchas surfaced during the 5-agent review.
