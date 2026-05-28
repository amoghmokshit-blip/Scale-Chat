# OTP — Worldwide provider research + migration design

> **Status:** Phase 1 + Phase 2 **implemented and landed 2026-05-28** (provider seam + Twilio + country allow-list + e2e). Phase 3 (Twilio console config — Fraud Guard / Geo-Permissions / Verify Service SID) is a manual step gated on each market's registration clearing; Phase 4 (per-market device verification) follows. Live Twilio smoke test is `it.todo` in `apps/api/test/auth-otp.e2e-spec.ts` until creds are provisioned.
> **Date:** 2026-05-27 (design) · 2026-05-28 (implementation). **Author:** research synthesis from 10 parallel provider deep-dives (all sourced to official 2026 docs/pricing; see § Sources).
> **Scope:** Replace the India-only MSG91 OTP sender with a **worldwide** verification provider. **Calls (LiveKit) are explicitly out of scope** — see § Why calls don't change.

This doc operationalizes the move from MSG91 (India-only SMS) to a global OTP stack as part of the worldwide launch. It is the canonical handoff for the OTP migration slice.

---

## 1. TL;DR — the decisions

| Decision | Choice | Why |
|---|---|---|
| **Calls vendor** | **Keep LiveKit** (no change) | Already global (Mumbai/Frankfurt/Virginia edge), cheapest researched (~$0.40–0.80 / 1k participant-min), and a live 2-party call is already verified (Tranche 2.I). The premise "LiveKit isn't worldwide" was a misconception — LiveKit Cloud is a global edge mesh. |
| **OTP vendor** | **Twilio Verify** (managed) | Broadest global coverage (180+ countries incl. China SMS), best-documented Node SDK, and **Fraud Guard included + on by default** — the strongest turnkey defense against SMS-pumping for a solo founder. |
| **OTP model** | **Managed Verify** (not raw SMS swap) | Worldwide raw SMS exposes the unauthenticated send endpoint to SMS-pumping / Artificially Inflated Traffic (AIT) — the #1 hidden cost (industry est. ~$1B+/yr; can run thousands of dollars in days). Managed Verify + a country allow-list is the defense. |
| **OTP channel** | **SMS-first everywhere** (simplest) | WhatsApp-auth is 5–10× cheaper in India/LATAM/SEA/MEA/Africa and is the documented next optimization — deferred to keep v1 simple. |
| **Launch scope** | **Phased country allow-list** | Launch only countries we actually serve; expand as registration (US 10DLC, India DLT, etc.) clears. Highest-leverage AIT-blast-radius control. |
| **Sourcing** | Two **backend** vendors (LiveKit + Twilio) | OTP is 100% server-side → "two vendors" is two backend dashboards, **not** two competing mobile SDKs. The single-vendor goal's main benefit (client integration simplicity) does not apply here. |

**Vendors considered but rejected:** Vonage (true single-vendor, but Video ~10× LiveKit + requires rebuilding the shipped call stack), Infobip (RN calling SDK deprecated/archived; opaque pricing), Sinch/Bird (no first-class RN SDK; Bird pivoted to CRM), AWS (no maintained RN Chime SDK; multi-console ops burden), Agora/100ms/Daily/Stream (calls-only, no reason to switch off LiveKit), Dolby.io (product sunset).

---

## 2. Why calls don't change (LiveKit stays)

Re-evaluated against Agora, 100ms, Daily, Stream, Dolby.io, and the CPaaS video products (Vonage/Infobip):

- **Coverage:** LiveKit Cloud has a confirmed **ap-south (Mumbai)** PoP + Frankfurt + Virginia with region-pinning. It is genuinely worldwide.
- **Cost:** ~$0.40–0.80 per 1,000 participant-minutes (+ egress GB) — the **cheapest** of every option. Agora video $3.99/1k, 100ms $4.00/1k, Vonage Video ~$4.10/1k, Stream HD $1.50/1k.
- **Integration:** Official `@livekit/react-native` + Expo config plugin, works on New Architecture in practice (the `expo-doctor` "unsupported" warning is stale metadata — a live 2-party call on SDK 56/Fabric is already verified per CLAUDE.md). Mature `livekit-server-sdk` already wired in Tranche 2.H PR-2.
- **Cost-to-stay ≈ $0; cost-to-switch is real and unrewarded** (rebuild `chat/call.tsx`, `incoming-call.tsx`, token mint, webhooks, push wakeup for zero feature gain).
- **Only future trigger to revisit:** if real-world call-quality complaints surface from India users, run a focused **Agora audio-only A/B spike** ($0.99/1k audio) before any migration — Agora's dedicated SD-RTN is the one plausible quality (not cost) edge. This is a hypothesis to test, not a planned change.

---

## 3. Provider research — categorized by use case + price

### 3.1 OTP / phone verification (the actual gap)

| Vendor | Model | Coverage | Price | Fraud protection | RN/Expo risk | Notes |
|---|---|---|---|---|---|---|
| **Twilio Verify** ⭐ chosen | Managed, multi-channel (SMS/WhatsApp/voice/email/SNA) auto-fallback | 180+ countries incl. China SMS; WhatsApp ~180 (not China) | **$0.05 / successful verification** + channel fee (US SMS ~$0.008; India SMS ~$0.083; WhatsApp-auth India ~$0.0014) | **Fraud Guard free + on by default** (Basic/Standard/Max); Geo-Permissions; Safe List | **Server-only — zero** | Best DX + docs; market-leading Node SDK; eliminates self-managed crypto. |
| Vonage Verify v2 | Managed | Truly global carrier net; Silent Auth only ~15 countries | ~$0.057 / verification + channel (~20–30% cheaper at volume) | Fraud Defender + Network APIs (silent auth) | Server-only | The single-vendor key (Verify + Video + Voice in-house); cheaper OTP than Twilio. |
| Sinch Verification | Managed | 600+ carriers, 190+ countries | per-country (~$0.04–0.07 US); flash-call 25–70% cheaper than SMS | SIM-swap / AIT intel | Server-only (OTP) | Richest channel mix incl. **flash-call** (Twilio lacks it); best intl SMS routes. |
| Infobip 2FA | Managed | 190+ countries | quote-only (opaque) | Signals (strong) | Server-only (OTP) | Strong routing; bad price transparency; RN calling SDK deprecated. |
| AWS End-User Messaging | Raw SMS or managed ($0.045/verify) | Global, per-country registration | US SMS ~$0.02; keep own argon2 if raw | SMS Protect (DIY country rules) | Server-only | Cheapest granular control, most ops burden; Cognito SMS routes via SNS (separate billing). |
| MSG91 (current) | Raw SMS | **India only** ❌ | ₹0.15/SMS | none | Server-only | The thing being replaced. |

### 3.2 Channel economics worldwide (why SMS-first is the *simple* — not the *cheap* — choice)

SMS is expensive/unreliable in several markets; WhatsApp-auth is dramatically cheaper there (and on-brand for a WhatsApp-style app). Kept as the documented **next optimization**, not v1:

| Market | SMS (per msg) | WhatsApp auth (per msg) | v1 channel | Future |
|---|---|---|---|---|
| India | ~$0.003–0.005 (₹) / ~$0.083 via Twilio | **$0.0014** | SMS | → WhatsApp (huge win) |
| US / Canada | ~$0.011–0.014 all-in (10DLC fees) | $0.0034 (low WA penetration) | SMS | stay SMS |
| UK / EU | ~$0.04 (UK) / €0.03+ | $0.022 (UK) | SMS | stay SMS |
| Indonesia | ⚠️ **$0.12–0.44** | $0.025 | SMS (costly) | → WhatsApp |
| Saudi Arabia | ⚠️ **$0.195** | $0.0107 | SMS (costly) | → WhatsApp |
| Brazil | ~$0.06+ | **$0.0068** | SMS (costly) | → WhatsApp (register local WABA; cross-border WA blocked) |
| Nigeria / Kenya | $0.0055–0.20 | $0.0067 | SMS | → WhatsApp |

> **Action for later (not v1):** move high-volume markets (India, Indonesia, Brazil) to WhatsApp-auth + local WABA to escape both the SMS premium and the $0.05/verify abstraction fee.

### 3.3 Calls / RTC (re-evaluated, kept on LiveKit)

| Vendor | Video $/1k part-min | India edge | RN/Expo + New Arch | Verdict |
|---|---|---|---|---|
| **LiveKit** ⭐ keep | ~$0.40 (+ bandwidth) | ✅ Mumbai | ✅ official plugin, live-verified | **No change** |
| Daily | ~$4.00 (bw incl.) | ⚠️ unverified | ✅ good | No reason to switch |
| Agora | $3.99 video / $0.99 audio | ✅✅ strongest India net | ⚠️ no Expo plugin, New-Arch unverified | Only if measured LiveKit quality issue |
| 100ms | $4.00 | ✅ India-founded | ✅ best docs | Already migrated off it |
| Stream | $1.50 HD / $3.00 FHD | ⚠️ unverified | ✅ | Only if consolidating chat too |
| Vonage Video | ~$4.10 | ✅ | ✅ New-Arch-native + Expo plugin | The single-vendor option (rejected on cost) |
| Dolby.io | — | — | — | ❌ product sunset, disqualified |

---

## 4. Architecture / migration design

### 4.1 The core decision: managed Verify replaces self-managed crypto

Twilio Verify **owns** code generation, storage, throttling, and checking. The current self-managed core — `generateOtp()`, argon2 hash-on-send, Redis `otp:<phone>` key, attempts counter — is **replaced**, not extended. To keep the offline/e2e dev flow deterministic (CLAUDE.md §3 mock-first), introduce a provider seam mirroring the existing `Msg91Service` injection:

```
OtpService  (keeps: rate-limit, country allow-list, otp_requests audit,
             security events, user upsert, JWT mint — all provider-agnostic)
   └── OtpVerificationProvider   (interface: start(phoneE164) / check(phoneE164, code))
         ├── TwilioVerifyProvider   → prod: verifications.create({to, channel:'sms'})
         │                                  verificationChecks.create({to, code})
         └── DevVerifyProvider      → local + e2e: existing Redis + argon2 path, offline
```

- `OtpService.request()` / `verify()` keep their outer responsibilities; only the "make + send + check the code" core delegates to the provider.
- **Orphaned code is relocated, not deleted** (CLAUDE.md §3 surgical-changes): `generateOtp()` + argon2 + Redis attempts logic move *into* `DevVerifyProvider` as the local-dev implementation.
- This preserves the codebase property that the provider-specific surface is one swappable file — exactly like `livekit.client.ts` for calls.

### 4.2 Country allow-list (phased rollout + AIT guardrail)

- Config-driven set of allowed E.164 country codes, e.g. `OTP_ALLOWED_COUNTRIES=IN,US,GB`.
- `OtpService.request()` derives the country from `phoneE164` (via the `libphonenumber` / phone helper already in `packages/shared`) and rejects disallowed countries with `country_not_supported` **before any send** — the single highest-leverage SMS-pumping defense.
- Belt-and-suspenders: enable Twilio **Geo-Permissions** + **Fraud Guard (Standard)** in the Twilio console (free).
- Expand the env list as each market's registration clears.

### 4.3 Config / env

New env vars (validated in `apps/api/src/config/env.ts`):
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`
- `OTP_ALLOWED_COUNTRIES` (comma-separated ISO country codes)

When Twilio vars are unset → `DevVerifyProvider` (mirrors today's MSG91 dev fallback that logs the code). MSG91 env vars (`MSG91_*`) become dead config — flagged, not deleted, per conventions.

### 4.4 Testing

- **Backend e2e** (`apps/api/test`): unchanged happy path via `DevVerifyProvider` → existing OTP cases stay green offline. **Add:** `country_not_supported` case (disallowed prefix) + rate-limit interaction; `it.todo` for a live Twilio smoke test (manual, gated on creds).
- **Mobile:** no change — the app already posts `{ phone, code }` to the API; the wire contract is identical, so mock + Jest suites are unaffected.

### 4.5 Wire contract

Unchanged. `POST /auth/otp/request { phoneE164 }` and `POST /auth/otp/verify { phoneE164, code }` keep their shapes and response codes; a new `country_not_supported` rejection is added to the request endpoint.

---

## 5. Rollout phases

1. **Provider seam + `DevVerifyProvider`** — pure refactor, no behavior change, all tests green. (Relocates argon2/Redis/`generateOtp` into the dev provider.)
2. **`TwilioVerifyProvider` + env + country allow-list** — add the prod path + `country_not_supported` guard + e2e cases.
3. **Twilio console config** — create the Verify Service, enable Fraud Guard + Geo-Permissions, set allow-list to first launch countries.
4. **Per-market device verification** — verify on a real device as each market's registration (US 10DLC, India DLT, sender-ID where required) clears; expand the `OTP_ALLOWED_COUNTRIES` env as markets open.

---

## 6. Cost projection (SMS-first, managed Verify)

- **~$0.05 / successful verification + per-SMS channel fee.** At low early volume this is negligible in absolute terms (1,000 signups ≈ $55–90 blended) and buys Fraud Guard.
- **Scaling flag:** when a market's volume grows, that market is the candidate to move to WhatsApp-auth or a direct local BSP to shed the per-verify fee + SMS premium (see § 3.2).

---

## 7. Compliance & fraud notes (worldwide)

- **SMS-pumping / AIT** is the dominant hidden cost on an unauthenticated worldwide OTP endpoint. Defenses, in priority order: (1) **country allow-list** (§4.2), (2) **managed Verify with Fraud Guard** (not raw send), (3) **spend circuit-breakers** (per-country daily caps + alerts), (4) **bot friction** on the request endpoint (Play Integrity / App Attest), (5) per-destination-prefix anomaly detection. The existing per-phone + per-IP rate limits are necessary but **not sufficient** (AIT rotates IPs/numbers).
- **Registration hurdles (blocking, per-region):** US **10DLC** (needs registered entity), India **DLT/TRAI** (needs *Indian* entity — usually not self-serve from abroad; lean on a CPaaS/aggregator), UAE/KSA (local license or aggregator). → reinforces the **phased allow-list**: open a country only once its registration path clears.
- **Privacy:** `phoneE164` + OTP audit logs are personal data (GDPR / India DPDP). Keep storing the hash, never plaintext (already done — key is burned on success); define an OTP-log retention period; sign DPAs/SCCs with Twilio. (Engineering-level guidance — get a privacy review before EU launch.)

---

## 8. Open questions / future work (not v1)

- WhatsApp-auth channel for India/LATAM/SEA/MEA/Africa (5–10× cheaper) — needs WABA + Meta business verification.
- Voice OTP as a last-resort fallback.
- Per-market migration to direct local BSPs once volume justifies escaping the $0.05/verify fee.
- Optional: Agora audio-only A/B spike *only if* India call-quality complaints surface on LiveKit.

---

## 9. Sources (all accessed 2026-05-27)

**Twilio:** Verify pricing https://www.twilio.com/en-us/verify/pricing · Fraud Guard https://www.twilio.com/docs/verify/preventing-toll-fraud/sms-fraud-guard · Verify deliverability https://www.twilio.com/docs/verify/verify-countries-and-regions-deliverability · Video EOL reversal https://www.twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product · Voice RN SDK https://github.com/twilio/twilio-voice-react-native
**Vonage:** Verify/Video/Voice pricing https://www.vonage.com/communications-apis/ · RN video SDK https://github.com/Vonage/vonage-video-react-native-sdk · Node SDK https://github.com/Vonage/vonage-node-sdk
**Infobip:** Voice pricing https://www.infobip.com/voice/pricing · RTC RN (deprecated) https://github.com/infobip/infobip-rtc-react-native · 2FA https://www.infobip.com/sms/2fa
**Sinch / Bird:** Sinch verification https://sinch.com/apis/verification/ · flash-call https://sinch.com/verification-api/flash-call-verification/ · Bird verify https://docs.bird.com/api/verify-api
**AWS:** End User Messaging pricing https://aws.amazon.com/end-user-messaging/pricing/ · Chime SDK pricing https://aws.amazon.com/chime/chime-sdk/pricing/ · SMS Protect https://docs.aws.amazon.com/sms-voice/latest/userguide/protect.html
**RTC:** LiveKit pricing https://livekit.com/pricing · Agora pricing https://www.agora.io/en/pricing/ · 100ms pricing https://www.100ms.live/pricing · Daily pricing https://www.daily.co/pricing/video-sdk/ · Stream pricing https://getstream.io/video/pricing/
**Channel economics:** WhatsApp pricing https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing · India SMS https://www.messagecentral.com/blog/sms-otp-pricing-india · T-Mobile 2026 A2P fees https://www.telgorithm.com/news/t-mobile-announces-new-2026-a2p-sms-pass-through-fees
**Fraud/compliance:** Twilio Fraud Guard (above) · Sinch AIT https://sinch.com/blog/artificial-inflation-traffic-ait-growing-threat-messaging-ecosystem/ · AWS AIT defenses https://aws.amazon.com/blogs/messaging-and-targeting/defending-against-sms-pumping-new-aws-features-to-help-combat-artificially-inflated-traffic/ · India DLT https://digintra.com/blog/dlt-registration-for-sms-in-india-a-complete-2025-guide

> **Uncertainty flags:** per-country SMS surcharges shift frequently — confirm live in the Twilio console for target markets before budgeting. Twilio Voice 2.x Expo support is preview-only (irrelevant to this OTP-only plan). LiveKit free-minute allowance is inconsistent across its own pages (5k–10k) — verify in-dashboard.
