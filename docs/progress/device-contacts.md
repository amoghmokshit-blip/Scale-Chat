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
| **6.1 — Shared schemas + Jest harness** | Discover/Bulk zod schemas; expand `toE164India` for E.164-prefixed input; add edge-case tests | ✅ **Shipped** (this commit) |
| **6.2 — Backend `POST /contacts/discover`** | Stateless discovery, rate-limited, privacy-shaped response | 🚧 Pending |
| **6.3 — Backend `POST /contacts/bulk`** | Idempotent bulk save, transaction-based dedup | 🚧 Pending |
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

## Next-developer pickup notes

If you (or the next Claude session) are starting PR 6.2:

1. **Use the existing schemas** — `DiscoverContactsSchema` is in `@scalechat/shared`, validate with the existing `ZodValidationPipe` pattern.
2. **The privacy contract is enforced by the response schema, not just the controller.** `ContactDiscoveryMatchSchema` does NOT have an `id` field — if you accidentally include one in the service response, runtime zod won't catch it (zod stripping is opt-in via `.strip()`), but the static TS type will refuse the assignment. Trust the type.
3. **Rate-limit pattern** — see `apps/api/src/modules/media/media.controller.ts:39-59`. Key: `contacts:discover:{user.sub}`, limit 10/min.
4. **The `phoneE164` index on `users`** is already in place (it's the `@unique` constraint) — `WHERE phoneE164 IN (...)` is an index scan, no migration needed.
5. **First e2e test** — there's no `apps/api/test/contacts.e2e-spec.ts` yet. Copy the shape from `apps/api/test/chat.e2e-spec.ts`. The harness (`setup-e2e.ts`) already provides `seedUser()`, `authedInject()`, `truncateAll()`.

If you discover the audit / plan made a wrong assumption — like I did with the Jest setup — **adapt the plan and document it in this file**, don't blindly follow it.
