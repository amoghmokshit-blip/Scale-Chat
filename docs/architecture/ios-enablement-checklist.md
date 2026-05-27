# iOS enablement checklist — calls + push (Tranche 2.I)

> **Status: scaffolded, not enabled.** Everything below is Android-now / iOS-on-cert.
> The codebase is provider-agnostic and platform-neutral up to the Apple credential
> step — no code changes are needed to turn iOS on, only credentials + an EAS build.
> Enable this when the **Apple Developer Program** membership lands.

## What already works WITHOUT Apple (Android-now)

- LiveKit voice/video calls (signalling, media, ring/accept/decline/hangup/timeout).
- Push wakeup on Android via Expo push → FCM (`expo-notifications`, `calls` channel,
  high importance). Token registered at app start → `POST /push/tokens`.
- The push payload (`data.type === 'call:ring'`) routes to the IncomingCallScreen
  from both a foreground socket and a background notification tap.
- `app.json` already carries `ios.bundleIdentifier` (`com.surya_expo88.myapp`) +
  mic/camera `infoPlist` usage strings + the `expo-notifications` plugin. `eas.json`
  has an iOS `development` profile (`simulator: true`) scaffolded.
- Backend `env.ts` has optional `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_KEY_P8_B64`
  slots (unused until iOS push is wired through Expo).

## Enable iOS push + calls (when the Apple Developer Program arrives)

1. **Apple Developer Program** — enroll; create an **App ID** matching
   `app.json` → `ios.bundleIdentifier` (`com.surya_expo88.myapp`).
2. **APNs auth key** — in the Apple Developer portal, Keys → create an **APNs `.p8`**
   key (note the Key ID + Team ID). This one key serves all environments.
3. **Hand the key to Expo** — `eas credentials` (iOS) → upload the `.p8`. Expo's push
   service then delivers our existing `call:ring` pushes to iOS via APNs. **No app
   code changes** — `registerForPushAsync()` already mints an Expo token on iOS;
   it just couldn't be delivered without the APNs key.
4. **First iOS build** — `eas build -p ios --profile development` (needs a Mac-less
   cloud build via EAS + a registered device UDID, or a simulator build). Install on
   a real iPhone for push-wakeup testing (the simulator can't receive push).
5. **Verify** — sign in on the iPhone, background the app, place a call from another
   user → the iPhone should ring via APNs.

## v1.1 follow-up (not required for first iOS ship)

- **CallKit / lock-screen native call UI** (incoming call shows the iOS system call
  screen even when the app is killed). Needs **`react-native-callkeep`** + a separate
  **VoIP push certificate** (PushKit, distinct from APNs). The current push payload
  already carries everything CallKit needs (callId, room, caller), so this is purely
  additive — wire `react-native-callkeep` to the existing `call:ring` handler.
- Background **Android** killed-app push reliability is also a real-device concern
  (emulators don't simulate killed-app FCM delivery reliably — see `my-app/CLAUDE.md`
  §7.5).

## Knowledge-base ties

- K2 (Gradle heap 4 GB) — addressed via `plugins/with-android-gradle-heap.js`.
- K5 (LiveKit + expo-audio AudioFocus collision) — addressed: `chat/call.tsx` calls
  `AudioSession.startAudioSession()` which reclaims focus from voice playback.
- K6 (single WebRTC lib) — only `@livekit/react-native-webrtc` is installed; never
  co-install another WebRTC lib.
