/**
 * Branded primitive types for the privacy engine (CLAUDE.md §4 "Privacy engine — Layer 1").
 *
 * A `Masked<T>` value is one that has been intentionally stripped of PII (no real
 * `userId` / `phoneE164` / `displayName` for non-admin viewers).
 *
 * Constructors are intentionally narrow: only `brandAsMasked()` produces a `Masked*`
 * value, so the type system refuses to let a raw Prisma row reach a member socket.
 */

declare const masked: unique symbol;

export type Masked<T> = T & { readonly [masked]: true };

/**
 * Brand a payload as already-masked. Callers MUST have done the actual stripping
 * before calling this — the brand is a *promise*, not a transform.
 */
export function brandAsMasked<T>(value: T): Masked<T> {
  return value as Masked<T>;
}

declare const e164Phone: unique symbol;

/** A phone number string that has been validated as E.164 (e.g. `+919876543210`). */
export type E164Phone = string & { readonly [e164Phone]: true };

/** A user id. Distinct branded type so leaks like "phone used as id" are caught. */
declare const userId: unique symbol;
export type UserId = string & { readonly [userId]: true };

declare const refreshFamilyId: unique symbol;
export type RefreshFamilyId = string & { readonly [refreshFamilyId]: true };
