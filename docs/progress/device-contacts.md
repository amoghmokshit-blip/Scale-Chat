# Progress — Device Contacts Sync (PR 6)

| | |
|---|---|
| **Owner** | Surya (founder) — implementation in progress |
| **Slice** | 1-on-1 — Device Contacts Sync (BRD §4.20, §12) |
| **Status** | **In progress** (PR 6.1 of 4 shipped) |
| **Plan** | `C:\Users\surya\.claude\plans\go-with-the-recommendation-cozy-lantern.md` |
| **BRD** | [`docs/brd/1-on-1.md`](../brd/1-on-1.md) §4.20, §12 |

---

## Sub-PR progress

| Sub-PR | Scope | Status |
|---|---|---|
| **6.1 — Shared schemas + Jest harness** | Discover/Bulk zod schemas; expand `toE164India` for E.164-prefixed input; add edge-case tests | ✅ Shipped (`07a61b3`) |
| **6.2 — Backend `POST /contacts/discover`** | Stateless discovery, rate-limited, privacy-shaped response, first contacts e2e spec | ✅ Shipped (`cb3a9fd`) |
| **6.3 — Backend `POST /contacts/bulk`** | Idempotent bulk save, transaction-based dedup | ✅ **Shipped** (this commit) |
| **6.4 — Frontend `expo-contacts` + Import Contacts modal** | `useDeviceContacts` hook, `/import-contacts` screen, "Pick from phonebook" entry | 🚧 Pending |

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

## Plan adaptation log (running)

- **PR 6.1**: Jest harness was already in place from a prior session. Scope narrowed to extending the existing `phone.test.ts` with E.164-prefixed cases + fixing `toE164India()`.
- **PR 6.2**: First test run revealed the global error filter wrapping shape. Test assertion updated; no controller/service change needed. Container ports differ from the e2e harness default (5432/6379 vs 5433/6380) — invoke with `TEST_DATABASE_URL_BASE` + `TEST_REDIS_URL` env overrides.
- **PR 6.3**: No mid-flight surprises. Per-batch dedup landed unprompted by the plan because the bulk endpoint genuinely needs it (real device contacts ship duplicates from cross-OS sync). Documented in the service docstring.

---

## Next-developer pickup notes

If you (or the next Claude session) are starting **PR 6.4 (frontend `expo-contacts` + Import Contacts modal)**:

1. **Read the plan** — `.claude/plans/go-with-the-recommendation-cozy-lantern.md` § PR 6.4. The plan has file-by-file scope including the `useDeviceContacts` hook signature, the modal's four states (idle / requesting / denied / loaded), and the MMKV cache shape.
2. **Read `AGENTS.md` and Expo SDK 56 docs first** — `expo-contacts` API drifts across SDK versions. `Contacts.requestPermissionsAsync()` and `Contacts.getContactsAsync({ fields: ['phoneNumbers', 'name'] })` are the two calls you'll make; verify the v56 signatures before writing.
3. **`toE164India()` is already broadened** (PR 6.1) — feed raw address-book strings through it directly, no pre-processing needed. Drop any entry that returns `null`.
4. **The repository interface needs `discover(phones)` and `addMany(items)`** — add them to `contacts-repository.ts`, implement in both `api-contacts-repository.ts` (real) and `mock-contacts-repository.ts` (returns 2-3 seeded matches so the modal works offline).
5. **Call `notify()` after `addMany()`** in the api impl so the existing `useContacts()` subscribe pattern auto-refreshes any open list (matches what `add()` does at line 49 of `api-contacts-repository.ts`).
6. **Cache shape in MMKV** — `{ matches: ContactDiscoveryMatch[], expiresAt: number }`. Key `StorageKeys.contactsDiscoveryCache` (already in `mmkv.ts` from PR 6.1's work). 24h TTL.
7. **Reuse `ChatRow`'s checkbox** for the import list — see `my-app/src/features/chat/components/chat-row.tsx`'s `checkbox` style. Lime "ON PLATFORM" badge via `Brand.accent` (`#E2FA61`).
8. **Add-Contact modal** — the simplest UX is a "Pick from phonebook" row at the TOP of the existing form (above PillInput name+phone), routing to `/import-contacts`. NOT a bottom sheet. Stay consistent with the existing modal layout.
9. **The global error filter wraps everything** — when calling `discover()` / `addMany()` from the client and showing a toast on error, parse `body.error.code` not `body.code`. Same pitfall hit in PR 6.2.

If you discover the audit / plan made a wrong assumption — like I did with the Jest setup in 6.1 and the error-envelope shape in 6.2 — **adapt the plan and document it in this file's adaptation log**, don't blindly follow it.

### Running e2e tests locally

The harness expects containers on ports 5433/6380 (the `db:setup` script's defaults). My active containers were on 5432/6379, so:

```
TEST_DATABASE_URL_BASE="postgresql://scalechat:scalechat@localhost:5432/scalechat" \
TEST_REDIS_URL="redis://localhost:6379" \
npm --workspace=apps/api run test:e2e -- --testPathPattern="contacts"
```

If you re-run `npm run db:setup` it'll start fresh containers on 5433/6380; then no env overrides needed.
