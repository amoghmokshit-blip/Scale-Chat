# Calls Provider POC — 100ms vs LiveKit Cloud

**Authored:** 2026-05-26
**Scope:** Pick the WebRTC SFU for ScaleChat's voice/video calls (Tranche 2.H + 2.I)
**Method:** Desk research only — public docs, pricing pages, SDK READMEs
**Live tests still owed by founder:** §6 below

> ⚠️ **Honest limit.** This document is a *desk-research POC*. It compares the two
> providers on every dimension verifiable from public docs and surfaces a
> recommendation with explicit confidence. It does NOT include:
>
> - Real-device latency from Indian networks (Jio/Airtel/Vi).
> - Account provisioning friction.
> - Empirical call-quality A/B on 3G/4G/5G in Mumbai/Delhi/Bangalore.
>
> Those live tests are itemised at the end and **must be completed before the
> Tranche 2.H PR-2 commit lands** (PR-1 is provider-agnostic — see the 2.H plan).

---

## 1. Constraints

From the user (2026-05-26): **free tier during development, can afford production
pricing once the app ships.**

From the BRD (`docs/progress/1-on-1-chat-expansion.md` line 148, K6):
1. India P50 latency (Mumbai/Delhi/Bangalore POPs)
2. React Native SDK friction (Expo plugin maturity, `libwebrtc.so` size, build-time
   impact)
3. Management-API token-mint shape
4. Webhook signature scheme
5. Lock-in / escape cost

## 2. Side-by-side facts (from public docs)

| Dimension | 100ms | LiveKit Cloud |
|---|---|---|
| **Free tier / month** | 10,000 conferencing minutes + 300 recording minutes | 5,000 WebRTC minutes + 50 GB downstream + 1 US phone number |
| **Credit card required for free tier?** | Not explicit on pricing page (probable yes) | **No** — "no credit card required" |
| **Paid tier entry** | Pay-as-you-grow (per-minute) | Ship: **$50/mo** flat |
| **Per-minute price (video, per-participant)** | **$0.004/min** | **$0.0005/min** (overage; Ship includes 150k min) |
| **Per-minute price (audio, per-participant)** | **$0.001/min** (75% off video) | $0.0005/min (no audio discount documented) |
| **Per-participant for 1-on-1 audio call (2 peers, 1 min)** | $0.002 | $0.001 |
| **Per-participant for 1-on-1 video call (2 peers, 1 min)** | $0.008 | $0.001 |
| **Recording** | $0.0135/min | included in WebRTC minutes |
| **Open source / self-host option** | ❌ Cloud-only | ✅ **Apache 2.0 — full self-host possible** |
| **RN SDK package** | `@100mslive/react-native-hms` | `@livekit/react-native` + `@livekit/react-native-webrtc` + `livekit-client` |
| **Prebuilt RN UI kit** | ✅ `@100mslive/react-native-room-kit` (`<HMSPrebuilt>`) | ❌ no first-party prebuilt UI for RN |
| **Expo Go works?** | ❌ — needs custom dev client + prebuild | ❌ — needs custom dev client + prebuild |
| **Dedicated Expo config plugin?** | ❌ — uses `expo-camera` plugin for permissions | ❌ — "development builds only" via standard Expo prebuild |
| **Token mint algorithm** | HS256 JWT, claims: `{access_key, room_id, user_id, role, type:'app', version:2, iat, nbf, exp, jti}` | HS256 JWT (claims not surfaced in the docs I fetched; community knowledge: `{video:{roomJoin:true, room}, sub:userId, iss:API_KEY, exp}`) |
| **Webhook signature** | (not surfaced on the page I fetched — likely HMAC-SHA256 in a header) | **HMAC-SHA256 inside a JWT** in `Authorization` header |
| **India POPs** | HQ partially in **Bangalore**; "core databases in US, EU, India" per company info | Mumbai supported for *some* services (Deepgram STT); region-pinning for SIP/telephony exists. **Dedicated SFU edge in India: unclear from public docs.** |
| **Company / market focus** | India-first WebRTC infrastructure (founded in Bangalore) | US-built, global focus, AI-first messaging |

## 3. Scoring matrix (with weights)

| Criterion | Weight | 100ms | LiveKit | Why |
|---|---|---|---|---|
| **India latency / POPs** | **High** | **9** | 5 | 100ms is India-built with documented India infra. LiveKit's India edge is unverified (needs live test). |
| **Free tier for development** | **High** | 7 | **8** | LiveKit's no-CC + smaller-but-no-strings tier wins on friction. 100ms has more minutes but signup probably needs CC. |
| **Production pricing (per audio min)** | Medium | 6 | **9** | LiveKit is ~50% cheaper on audio at the wire level. |
| **Production pricing (per video min)** | Medium | 4 | **9** | LiveKit is ~8× cheaper on video. Big deal if video calls become a majority. |
| **RN SDK + prebuilt UI** | **High** | **9** | 6 | `<HMSPrebuilt>` is a drop-in component that saves weeks in Tranche 2.I. LiveKit needs more wiring. |
| **Expo plugin maturity** | Medium | 6 | 6 | Both need custom dev client + prebuild; neither has a "just works" Expo config plugin. Tie. |
| **Token mint shape (matches BRD plan)** | Low | **9** | 8 | 100ms's claim shape matches the BRD verbatim (BRD §2.H line 677). LiveKit's differs slightly but is equivalent work. |
| **Webhook signature scheme** | Low | 7 | 8 | LiveKit's spec is clearly documented; 100ms's wasn't on the page I fetched. |
| **Lock-in / escape cost** | Medium | 3 | **10** | LiveKit is Apache 2.0 — self-host escape valve exists if we outgrow their cloud. 100ms is cloud-only. |
| **Indian market focus** | Medium | **9** | 5 | 100ms knows Indian network conditions (Jio's quirks, mobile data caps). LiveKit's customer base is global/Western. |
| **Documentation quality** | Low | 7 | 8 | LiveKit's docs are tighter and more searchable; 100ms has gaps. |

**Unweighted totals:** 100ms 76 / LiveKit 82
**With BRD weights** (High=3, Medium=2, Low=1): 100ms 152 / LiveKit 161

The numerical margin is **narrow**. The qualitative split below matters more than the
total.

## 4. Qualitative split — what each provider is *best at*

**100ms wins on:**
- **Tranche 2.I shipping speed.** `<HMSPrebuilt>` is a drop-in component that handles
  the entire CallScreen UI (mute, hangup, camera flip, network indicator, participant
  grid). Without it, you build all that yourself.
- **India network optimization.** Bangalore-based company with India-tuned infra.
  Indian users on Jio/Airtel/Vi probably get lower P50 latency.
- **Token mint shape matches the BRD's plan verbatim** — fewer surprises.

**LiveKit wins on:**
- **Production cost.** Video calls are ~8× cheaper per minute. At any meaningful
  DAU this compounds: 10k DAU × 5min video/day × 30 days = 1.5M minutes/month
  → 100ms ≈ $12k/mo, LiveKit ≈ $750/mo + $50 base.
- **Open-source escape hatch.** If you ever need data residency that the cloud can't
  meet, or want to drop costs further at high DAU, you can self-host. Huge insurance
  policy.
- **No-CC free tier.** You can sign up and start testing in 60 seconds.
- **AI features alignment.** LiveKit is doubling down on voice-AI (agents, STT,
  inference). If ScaleChat ever adds AI features in calls (transcripts, smart replies),
  LiveKit's the home for that.

## 5. Recommendation

**Use 100ms for v1.** Confidence: **medium-high** (would be high with live latency
data).

**Why:**
1. The single biggest risk in Tranche 2.I is build complexity. `<HMSPrebuilt>` cuts
   weeks. (For comparison, LiveKit's RN CallScreen would mean hand-rolling the entire
   UI — mute button, hangup button, participant tile, network indicator, etc. — using
   their lower-level SDK.)
2. ScaleChat's users are on Indian networks. 100ms is built around that constraint.
   LiveKit *might* be fine in India, but it's not their primary market.
3. The BRD's `hms.client.ts` interface is provider-agnostic (BRD line 615+). If
   100ms's price-per-video-minute becomes prohibitive at scale (~50k DAU), switching
   to LiveKit is ~200 LoC — see escape plan §7.

**What would change this recommendation:**
- If your live latency test shows LiveKit < 100ms in India by >30ms P50 → switch.
- If you have an explicit AI-features-in-calls roadmap → switch to LiveKit (their
  AI agents framework is best-in-class).
- If you want to ship a TestFlight build today with zero auth headaches → switch to
  LiveKit (no-CC signup).

## 6. Live-test checklist (founder owes — before Tranche 2.H PR-2)

These are the gaps in this desk-research POC. Each takes ~30-60 min.

- [ ] **Sign up** for both 100ms and LiveKit Cloud free tiers. Note whether each asks
      for a credit card. Time-to-first-room-created in each dashboard.
- [ ] **Build the demo apps** (100ms's RN sample + LiveKit's RN sample) and run a
      2-person call from your dev machine. Note: cold-start build time on Windows
      after `expo prebuild`.
- [ ] **Latency probe from India.** With both apps installed on two physical Android
      devices on Indian Jio/Airtel networks (NOT WiFi), measure perceived audio
      latency on each. Record on video.
- [ ] **Bandwidth probe.** Throttle one device to ~256 kbps (Chrome DevTools or
      `tc qdisc` on Linux). See which provider drops audio more gracefully.
- [ ] **Confirm India SFU edge.** Both dashboards typically show the room's edge
      region after a call. Verify 100ms uses a India POP; verify whether LiveKit
      does too.
- [ ] **Pricing math at your DAU target.** Plug your forecast DAU × call-min/day into
      both providers' calculators. The per-min math above is rough; the dashboards
      have proper calculators.

Save results inline in this doc under a new §6.1 "Live-test results — 2026-MM-DD" block
when you complete them.

## 7. Escape plan (if we ever swap providers)

The BRD's plan locks the provider behind one file (`apps/api/src/modules/calls/
hms.client.ts`) + an env-var prefix + an SDK package on the mobile side. **Module
shape, advisory-lock logic, BullMQ wiring, and database schema are
provider-agnostic.** Swap impact:

| File | 100ms → LiveKit swap |
|---|---|
| `apps/api/src/modules/calls/hms.client.ts` | Rename `livekit.client.ts`; replace `createRoom` call body with LiveKit Room Service API. ~80 LoC. |
| `apps/api/src/modules/calls/calls.service.ts` | Token-mint claim shape changes (JWT claims). ~20 LoC. |
| `apps/api/src/modules/calls/calls.controller.ts` | Webhook event-name parser changes (e.g. `session.close.success` → `room_finished`). ~30 LoC. |
| `apps/api/src/config/env.ts` | Rename `HMS_*` → `LIVEKIT_*`. ~5 LoC. |
| `my-app/package.json` | Swap `@100mslive/react-native-hms` + `@100mslive/react-native-room-kit` → `@livekit/react-native` + `@livekit/react-native-webrtc`. |
| `my-app/src/app/call/[callId].tsx` | Replace `<HMSPrebuilt>` with hand-rolled UI on top of `Room.connect()`. **~200-400 LoC of new UI work.** |

Total swap cost: ~1-2 days of focused work on the backend + 1 week on the mobile UI
to rebuild the call screen.

## 8. Decisions locked in this doc

- **Provider for v1:** 100ms (provisional — confirmed by live tests).
- **Architecture:** provider-agnostic per BRD §2.H — `hms.client.ts` is the only
  provider-specific file on the backend.
- **Mobile prebuilt:** `<HMSPrebuilt>` from `@100mslive/react-native-room-kit` for
  Tranche 2.I's CallScreen.
- **Free-tier signup:** founder owes — both providers, before Tranche 2.H PR-2.
- **Production cost monitoring:** when DAU × call-min/day projects $5k/mo on 100ms,
  re-run this POC.

## 9. Sources

- [100ms Pricing](https://www.100ms.live/pricing)
- [100ms React Native quickstart](https://www.100ms.live/docs/react-native/v2/quickstart/quickstart)
- [100ms Expo quickstart](https://www.100ms.live/docs/react-native/v2/quickstart/expo-quickstart)
- [100ms Server-side auth + tokens](https://www.100ms.live/docs/server-side/v2/foundation/authentication-and-tokens)
- [LiveKit Pricing](https://livekit.com/pricing)
- [LiveKit React Native quickstart](https://docs.livekit.io/home/quickstarts/react-native/)
- [LiveKit Webhooks](https://docs.livekit.io/home/server/webhooks/)
- [LiveKit Cloud architecture](https://docs.livekit.io/home/cloud/architecture/)
- [LiveKit region pinning for telephony](https://docs.livekit.io/telephony/features/region-pinning/)
- [LiveKit blog — Cloud announcement](https://blog.livekit.io/announcing-livekit-cloud/)

---

**Status:** Desk research complete. Original recommendation: **100ms (provisional)** — superseded, see §8.1.

---

## §8.1 Decision update (2026-05-26): switched to **LiveKit**

Provider changed from 100ms to **LiveKit** during 2.H PR-2. Rationale:

- **No prebuilt-UI advantage to forgo.** The Figma file ("Skalechat Files") has
  zero call-screen designs, so the call UI is hand-rolled to the chat theme
  regardless — which was 100ms's main edge (`<HMSPrebuilt>`). With that
  neutralised, LiveKit's ~8× cheaper video, no-credit-card free tier, and
  Apache-2.0 self-host escape decide it for a cost-conscious production app.
- **Contained swap, as §7's escape plan predicted.** Only `hms.client.ts` →
  `livekit.client.ts` (LiveKit `AccessToken` + async `toJwt()`,
  `RoomServiceClient` create/delete with `maxParticipants:2` + `emptyTimeout`,
  `WebhookReceiver` for signed webhooks), the `HMS_*` → `LIVEKIT_*` env prefix,
  the webhook route (`/calls/webhooks/livekit`, `Authorization` header, raw
  `application/webhook+json` body via a Fastify content-type parser in
  `main.ts`), and the wire DTOs (`accessToken`/`roomName`/`wsUrl`). Lifecycle,
  BullMQ ring-timeout, socket fan-out, CALL_EVENT rows untouched.
  `CallSession.hms_room_id` DB column kept (stores the LiveKit room name) to
  avoid a churny rename.
- **Verified:** `/calls/token` mints a real LiveKit JWT + `wsUrl` against
  `wss://sclaechat-p7znthtx.livekit.cloud`; e2e 49 pass / 6 todo; stub mode
  (unset keys) still boots for keyless local dev.
