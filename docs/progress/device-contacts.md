# Progress — Device Contacts Sync (PR 6)

| | |
|---|---|
| **Owner** | Surya (founder) — implementation in progress |
| **Slice** | 1-on-1 — Device Contacts Sync (BRD §4.20, §12) |
| **Status** | ✅ **Shipped** — all 4 sub-PRs landed |
| **Plan** | `C:\Users\surya\.claude\plans\go-with-the-recommendation-cozy-lantern.md` |
| **BRD** | [`docs/brd/1-on-1.md`](../brd/1-on-1.md) §4.20, §12 |

---

## Sub-PR progress

| Sub-PR | Scope | Status |
|---|---|---|
| **6.1 — Shared schemas + Jest harness** | Discover/Bulk zod schemas; expand `toE164India` for E.164-prefixed input; add edge-case tests | ✅ Shipped (`07a61b3`) |
| **6.2 — Backend `POST /contacts/discover`** | Stateless discovery, rate-limited, privacy-shaped response, first contacts e2e spec | ✅ Shipped (`cb3a9fd`) |
| **6.3 — Backend `POST /contacts/bulk`** | Idempotent bulk save, transaction-based dedup | ✅ Shipped (`00b3bd3`) |
| **6.4 — Frontend `expo-contacts` + Import Contacts modal** | `useDeviceContacts` hook, `/import-contacts` screen, "Pick from phonebook" entry | ✅ **Shipped** (this commit) |

---

## PR 6.1 — What shipped

### Files touched

- **`packages/shared/src/schemas/contacts.ts`** — added 5 new schemas:
  - `DiscoverContactsSchema` (request: `phones: e164India[]`, capped at 500)
  - `ContactDiscoveryMatchSchema` (per-match payload, STRICT — no `id` / `userId` / `contactUserId`)
  - `DiscoverContactsResponseSchema` (response wrapper)
  - `BulkAddContactsSchema` (request: `items: AddContactBody[]`, capped at 500)
  - `BulkAddContactsResponseSchema` (response: `{ saved: Contact[], alreadyHad: number }`)
- **`my-app/src/lib/phone.ts`** — added private `toLocalDigits()` helper; both `isValidIndianMobile` and `toE164India` now accept E.164-prefixed input and the legacy STD `0` prefix that Indian users commonly save.
- **`my-app/src/lib/__tests__/phone.test.ts`** — extended with 5 new edge-case test groups:
  - Accepts E.164-prefixed input (`+91 98765 43210`, `+91-98765-43210`, `+919876543210`, `919876543210`)
  - Strips legacy STD `0` prefix (`09876543210`, `0 98765 43210`)
  - Rejects foreign/malformed E.164 (US numbers, `+91 12345 67890` with starts-with-1 local)
  - Normalises every address-book shape to canonical `+919876543210`
  - Rejects foreign E.164 in `toE164India`

### Plan adaptation

The plan claimed PR 6.1 would create the Jest harness for the first time. Reading the codebase showed Jest was **already configured** by an earlier session (the 1-on-1 chat slice — `docs/progress/contact-page.md` Phase 4.2 notes the `babel-jest` + `babel-preset-expo` choice). PR 6.1 narrowed to **extending** the existing harness with the device-contacts edge cases instead of creating it. The plan's "first test lands here" framing was inaccurate; the work was still in scope but smaller than estimated.

### Why the normalizer change matters

`expo-contacts` (PR 6.4 dependency) returns numbers in the format users saved them. On Indian phones that's almost always **`+91 XXXXX XXXXX`** — saved by every default contacts app and SIM-card import flow. The prior `toE164India("+91 98765 43210")` returned `null`, which would have silently dropped every legitimate address-book entry once PR 6.4 wired it up.

Catching this in PR 6.1 (under a test) instead of in PR 6.4 (as a stealth bug discovered during emulator testing) is the explicit reason the plan front-loaded the schemas + Jest work as its own PR.

### Verification

- `npm run shared:build` — clean (zero TS errors).
- `npm --workspace=my-app test` — **50/50 tests pass** (45 pre-existing + 5 new).
- `npx tsc --noEmit` errors in the workspace are unchanged from pre-PR-6 baseline (pre-existing React 19 + RN 0.85 component-type compat issues, not from this PR).

---

## What's NOT in this sub-PR

- **No backend endpoints yet** — the new shared schemas describe a contract the API doesn't implement. Imports of `DiscoverContactsBody` / `BulkAddContactsBody` will compile fine but the routes 404. PR 6.2 + 6.3 wire them.
- **No frontend integration** — `expo-contacts` isn't installed yet; no `/import-contacts` route; the Add Contact modal is unchanged. PR 6.4 ties it all together.

---

## PR 6.2 — What shipped

### Files touched

- **`apps/api/src/modules/contacts/contacts.controller.ts`** — added `@Post('discover')` route (declared before `:id`-bearing routes so NestJS doesn't try to parse `"discover"` as a UUID). Wired `RateLimitService` injection; 10 req/min ceiling via `contacts:discover:{user.sub}` Redis ZSET key.
- **`apps/api/src/modules/contacts/contacts.service.ts`** — added `discover(callerUserId, phones)` method. Defensively dedups the input batch, selects `phoneE164` + `fullName` + `avatarUri` only (NOT `id`) at the SQL layer, drops the caller's own phone from matches.
- **`apps/api/test/contacts.e2e-spec.ts`** (new, first e2e for this module) — 6 cases:
  1. Happy path — 3 submitted phones, 2 platform users → 2 matches with strict shape (`['avatarUri', 'displayName', 'isOnPlatform', 'phoneE164']`).
  2. Privacy contract — `JSON.stringify(body)` grep'd for `"id":` and `/userId/i` → both must not match.
  3. Self-filter — submitting caller's own phone alongside others → caller silently dropped.
  4. Empty array → 400 (zod `.min(1)`).
  5. Malformed E.164 (`9876543210` without `+91`) → 400 (zod regex).
  6. Unauthenticated → 401 (Bearer required).
  7. Rate limit — 10 successful calls then 11th returns 429 with `{ error: { code: 'rate_limited' } }`.

### Privacy enforcement — three layers of defense

This was the most security-sensitive code path in the PR. Three layers were stacked so a single regression can't leak `userId`:

1. **Static type contract** — `ContactDiscoveryMatchSchema` in `@scalechat/shared` has no `id` field. TypeScript refuses to assign a row with `id` to a `ContactDiscoveryMatch`.
2. **SQL projection** — `prisma.user.findMany({ select: { phoneE164, fullName, avatarUri } })` doesn't include `id` in the SQL projection. Even raw row-spread (`...row`) couldn't surface a `userId`.
3. **DTO mapper** — the service maps each row to an explicit 4-field object, no spreads. Adding fields to `User` won't accidentally widen the response.

The e2e test `JSON.stringify(body)` regex check is a fourth gate: any future code change that re-introduces `id` (e.g. someone adding a `_count` include) trips the test.

### Adaptation note — global exception filter wraps errors

The first test run failed on the rate-limit assertion. The controller throws `new HttpException({ code: 'rate_limited', ... }, 429)`, but the response body is `{ error: { code: 'rate_limited', ... } }` — there's a global `HttpExceptionFilter` at `apps/api/src/common/filters/http-exception.filter.ts` that wraps every error into a stable `{ error: { code, message, requestId } }` envelope. The test now asserts `body.error.code` instead of `body.code`. This is the canonical shape for ALL API errors, not specific to rate-limiting.

### Verification

- `npm --workspace=apps/api run test:e2e -- --testPathPattern="contacts"` → **6/6 passing** (with `TEST_DATABASE_URL_BASE` pointing at `localhost:5432` instead of the default `5433` — the dev containers run on the canonical ports).
- `npm run shared:build` clean.

### Live API smoke test

```
curl -X POST http://localhost:4000/contacts/discover \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"phones":["+919812345678","+919999999999"]}'
# → { "matches": [{ "phoneE164": "+919812345678", "isOnPlatform": true, ... }] }
```

The ghost phone `+919999999999` doesn't exist in the seeded `users` table, so only the real one comes back.

---

## PR 6.3 — What shipped

### Files touched

- **`apps/api/src/modules/contacts/contacts.controller.ts`** — added `@Post('bulk')` route. 5 req/min rate limit via `contacts:bulk:{user.sub}`. Placed before `:id` routes so NestJS matches correctly.
- **`apps/api/src/modules/contacts/contacts.service.ts`** — added `addMany(ownerUserId, body)`. Five-stage pipeline:
  1. Per-batch dedup via `Map<phoneE164, item>` — first occurrence wins (handles iCloud→Google contact duplicates).
  2. Self-add filter — read caller's own `phoneE164` once, drop matching items.
  3. Partition against `(ownerUserId, phoneE164)` unique constraint via one `findMany` → `toCreate` vs `alreadyHad`.
  4. Resolve `contactUserId` for new phones via one `findMany` on `users.phoneE164`.
  5. `$transaction` → `createMany` + re-`findMany` (PG `createMany` doesn't return rows; re-read gives full DTOs).
- **`apps/api/test/contacts.e2e-spec.ts`** — extended with 6 new cases (Cases 5-10):
  - **5**: Happy path — 3 items (2 on-platform, 1 ghost) → `{ saved: 3, alreadyHad: 0 }`, `isOnPlatform` correct per item.
  - **6**: Idempotent — re-run same batch → `{ saved: 0, alreadyHad: 2 }`, no double rows in DB.
  - **7**: Self-add filter — caller's own phone silently dropped; not counted in `alreadyHad`.
  - **8**: Per-batch dedup — same phone twice → first occurrence wins, displayName from second is dropped.
  - **9**: Empty array → 400; malformed E.164 in any item → 400.
  - **10**: Rate limit — 5 calls then 11th → 429 `rate_limited`.

### Key design choices

1. **Bulk silently dedups; `add()` throws.** The single-item `add()` raises `ConflictException` if the phone is already saved. The bulk path returns `alreadyHad: N` instead — import UX shouldn't bail mid-batch because one number was already there. Two different semantics, same module, intentional.
2. **No `prisma.createMany({ skipDuplicates: true })`** — the audit showed it's not used anywhere in the repo. Application-level dedup (the `findMany`-then-partition step) makes the conflict count visible via `alreadyHad`, which the UI uses for "saved 3, you already had 2" feedback.
3. **Interactive `$transaction`** (callback form) is needed because of the read-after-write dependency: `createMany` (no row return on PG) → re-`findMany` to get full DTOs. The array-batch form doesn't support that.
4. **Resolving `contactUserId`** in a separate query (step 4) rather than via Prisma's `connect: { where: { phoneE164 } }` keeps the query plan flat — one indexed lookup, one batch insert. Trying to do this in a relational `connect` would force Prisma into a per-row subquery.

### Live API smoke test

```
TOK="<fresh JWT>"

# Save 3 contacts — 2 platform users + 1 ghost.
curl -X POST http://localhost:4000/contacts/bulk \
  -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" \
  -d '{"items":[
    {"phoneE164":"+919812345678","displayName":"Megha"},
    {"phoneE164":"+919976654321","displayName":"Anand"},
    {"phoneE164":"+919800099999","displayName":"Ghost"}
  ]}'
# → { "saved": [{ ... isOnPlatform: true ... } x2, { ... isOnPlatform: false ... }], "alreadyHad": 0 }

# Re-run the same batch — alreadyHad goes up, saved stays empty.
# (repeat the curl above)
# → { "saved": [], "alreadyHad": 3 }
```

### Verification

- **13/13 e2e cases pass** (7 from PR 6.2 + 6 new from PR 6.3).
- `npm run shared:build` clean.

---

## PR 6.4 — What shipped

### Native module + config

- **`my-app/package.json`** — `expo-contacts: "~56.0.7"` installed via `npx expo install expo-contacts` (SDK-pinned).
- **`my-app/app.json`** — `expo-contacts` plugin entry with the `contactsPermission` string ("ScaleChat looks at your contacts to find friends who already use the app. We never upload your full address book — only matches are shown, and nothing is saved until you tap Save.") The Expo config plugin auto-injects iOS `NSContactsUsageDescription` and Android `READ_CONTACTS` at prebuild time.

### Files touched / created

- **`my-app/src/features/contacts/data/contacts-repository.ts`** — interface extended with `discover(phones)` and `addMany(body)`. Both impls keep their respective contracts (api vs mock).
- **`my-app/src/features/contacts/data/api-contacts-repository.ts`** — calls `/contacts/discover` and `/contacts/bulk`. `addMany` fires `notify()` after success so any open `useContacts()` consumer (e.g. /new-chat search list) auto-refreshes.
- **`my-app/src/features/contacts/data/mock-contacts-repository.ts`** — `discover` intersects the seed against the submitted phones; `addMany` mirrors server-side per-batch dedup + already-had partitioning.
- **`my-app/src/features/contacts/hooks/use-device-contacts.ts`** (new) — state-machine hook (`idle | requesting | denied | loading | ready | error`). On grant: reads `Contacts.getContactsAsync`, normalises every phone via `toE164India()`, dedups, chunks discovery into 500-phone batches (50ms pause between chunks), persists results to MMKV with a 24h TTL.
- **`my-app/src/app/(modals)/import-contacts.tsx`** (new) — the screen. Renders one of five centered callouts (idle/requesting/denied/loading/error) OR the matches FlatList with checkbox + "Select all" + sticky "Save N selected" bottom CTA. Lime "ON PLATFORM" badge on every match.
- **`my-app/src/app/(modals)/add-contact.tsx`** — added "Pick from phonebook" entry row at the TOP of the existing form, with a "or add manually" divider below. Manual entry stays unchanged.
- **`my-app/src/lib/mmkv.ts`** — added `StorageKeys.contactsDiscoveryCache = 'contacts.discovery.cache.v1'` (was missing from PR 6.1).

### Behavior notes worth knowing

1. **Cache TTL is 24h**, matching the BRD's "X joined ScaleChat" delayed-ping UX. Re-opening Import Contacts within a day skips BOTH the OS permission re-prompt AND the device/network round-trip.
2. **Chunked discovery** — `/contacts/discover` caps at 500 phones per request and rate-limits to 10/min/user. A 2500-contact phone book → 5 chunks; the 50ms pause between chunks keeps the server from seeing one user as a burst attacker.
3. **`isMounted` ref in the hook** guards against navigation-away mid-fetch on phones with large address books (`getContactsAsync` can take 2-5s).
4. **Old-dev-client fallback** — the hook catches `getPermissionsAsync()` throwing (happens when JS loads against an APK that doesn't have the native module linked yet). Status falls back to `idle`; the actual error surfaces only when the user taps "Continue".
5. **Re-discover resets selections** — `selectedInMatches` filters out phone keys no longer in the matches array, so pull-to-refresh doesn't leave dangling check marks.
6. **`Alert` instead of toast** — the codebase doesn't have a toast primitive. Save success / error use the existing `Alert.alert` pattern (matches `/add-contact`).

### ⚠️ Native rebuild required before testing

Because `expo-contacts` adds Kotlin code to the dev client, the existing APK on the emulator can't see the new module. Before manual testing:

```
cd my-app
npx expo prebuild       # regenerate android/ + ios/ with the new plugin
npx expo run:android    # build + install the dev client
```

The JS bundle will still load against the OLD APK, but `Contacts.requestPermissionsAsync()` will throw at runtime ("native module not linked") until the rebuild lands.

### Verification (next session, after rebuild)

1. Permission denial path — fresh install (`adb shell pm clear com.surya_expo88.myapp`), sign in, ⊕ → Add Contact → Pick from phonebook → deny permission → "Open Settings" callout.
2. Permission grant + matches — emulator address book empty by default → seed via the emulator's Contacts app or `adb shell content insert` → Import Contacts lists the matches with lime "ON PLATFORM" badges.
3. Save flow — tick 3 matches → tap "Save 3 selected" → Alert dismisses → ⊕ → New Chat shows the newly-saved contacts (subscribe invalidation).
4. Cache freshness — re-open Import Contacts within 60s → no permission prompt, no device read (verify in console).
5. Mock parity — `EXPO_PUBLIC_USE_MOCKS=true`, kill+restart Metro with `--clear` → Import Contacts works against seeded mocks without hitting the API.

---

## Plan adaptation log (running)

- **PR 6.1**: Jest harness was already in place from a prior session. Scope narrowed to extending the existing `phone.test.ts` with E.164-prefixed cases + fixing `toE164India()`.
- **PR 6.2**: First test run revealed the global error filter wrapping shape. Test assertion updated; no controller/service change needed. Container ports differ from the e2e harness default (5432/6379 vs 5433/6380) — invoke with `TEST_DATABASE_URL_BASE` + `TEST_REDIS_URL` env overrides.
- **PR 6.3**: No mid-flight surprises. Per-batch dedup landed unprompted by the plan because the bulk endpoint genuinely needs it (real device contacts ship duplicates from cross-OS sync). Documented in the service docstring.
- **PR 6.4**: Plan said `StorageKeys.contactsDiscoveryCache` would land in PR 6.1; it didn't. Added in PR 6.4 instead. `ApiError` in `lib/api-client.ts` already unwraps the global error envelope (the wrapper code I started with assumed `err.body` was a raw response — fixed before commit). The plan called for a separate `src/components/menu/popover-menu.tsx` based choice sheet between phonebook vs manual; chose a simpler inline "Pick from phonebook" row + "or add manually" divider, which matches the modal's visual rhythm without adding a sheet primitive.

---

## Next-developer pickup notes

PR 6 is shipped. Follow-up tickets (not in scope here):

1. **Re-sync on app foreground** — currently we re-discover only on Import Contacts mount. A common UX upgrade is to silently re-run discovery when the app comes back from background after >24h, so the "X joined ScaleChat" notification can fire without the user opening the modal. Needs `AppState` listener + push-notification slice (not yet shipped).
2. **Bulk delete** — no way to bulk-remove contacts today. `DELETE /contacts/bulk` would mirror the new bulk save.
3. **Avatar resolution** — `ContactDiscoveryMatch.avatarUri` exists in the response but most platform users won't have an avatar set yet. When they do, the import row should render their photo instead of the first-letter fallback.
4. **Telemetry** — no analytics on how many users tap "Pick from phonebook" vs manual. Once an analytics SDK lands, this is the most informative funnel to instrument.

### Running e2e tests locally

The harness expects containers on ports 5433/6380 (the `db:setup` script's defaults). My active containers were on 5432/6379, so:

```
TEST_DATABASE_URL_BASE="postgresql://scalechat:scalechat@localhost:5432/scalechat" \
TEST_REDIS_URL="redis://localhost:6379" \
npm --workspace=apps/api run test:e2e -- --testPathPattern="contacts"
```

If you re-run `npm run db:setup` it'll start fresh containers on 5433/6380; then no env overrides needed.
