import { z } from 'zod';

import { CursorQuerySchema, paginatedResponse } from './common.js';

const e164India = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile in E.164 form');

/** Owner-self view of a contact directory entry. */
export const ContactSchema = z.object({
  id: z.string().uuid(),
  /** Resolved platform user id when the contact has joined; null otherwise. */
  contactUserId: z.string().uuid().nullable(),
  phoneE164: z.string(),
  displayName: z.string(),
  /** ISO timestamp; null when not favourited. */
  favouriteAt: z.string().datetime().nullable(),
  /** Synthesised — set to the linked User's avatar if any. */
  avatarUri: z.string().url().nullable(),
  /** Synthesised — true when `contactUserId` is set. */
  isOnPlatform: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Contact = z.infer<typeof ContactSchema>;

/**
 * Masked variant — used when a contact (or chat counterpart) is referenced in
 * a payload that crosses the privacy boundary (e.g. Super Group member list
 * shown to other members). PII fields collapse to display-only aliases.
 */
export const ContactPublicSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUri: z.string().url().nullable(),
});
export type ContactPublic = z.infer<typeof ContactPublicSchema>;

export const AddContactSchema = z.object({
  phoneE164: e164India,
  displayName: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
});
export type AddContactBody = z.infer<typeof AddContactSchema>;

export const UpdateContactSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  favourite: z.boolean().optional(),
});
export type UpdateContactBody = z.infer<typeof UpdateContactSchema>;

export const ContactsListResponseSchema = paginatedResponse(ContactSchema);
export type ContactsListResponse = z.infer<typeof ContactsListResponseSchema>;

/**
 * Cursor query extended with a free-text `search` predicate. The server matches
 * against displayName (case-insensitive) and phoneE164 (substring). Trim+length
 * cap mirrors the displayName max length so the index isn't fed pathological
 * inputs.
 */
export const ContactsListQuerySchema = CursorQuerySchema.extend({
  search: z.string().trim().min(1).max(60).optional(),
});
export type ContactsListQuery = z.infer<typeof ContactsListQuerySchema>;

// ─── Device-contacts sync (PR 6) ───────────────────────────────────────────
//
// Two-endpoint contract — stateless discovery + intentional bulk save. The
// phone is the source of truth; our DB only grows when the user explicitly
// taps Save on a discovered match.
//
// Both endpoints cap at 500 phones/request so an unusually large address
// book (e.g. 2500 contacts) chunks client-side and applies the per-minute
// rate limit per chunk instead of one giant request.

/**
 * Request for `POST /contacts/discover` — stateless lookup. Server matches
 * the submitted E.164 phones against the `users` table and returns ONLY the
 * matches. No row writes, no persistence; safe to hit on every modal open.
 */
export const DiscoverContactsSchema = z.object({
  phones: z.array(e164India).min(1).max(500),
});
export type DiscoverContactsBody = z.infer<typeof DiscoverContactsSchema>;

/**
 * Per-match payload. STRICT shape — must NOT leak the matched user's `id`
 * (would expose `userId` to anyone who can guess a phone). See the privacy
 * contract in docs/plans/PR-6.md.
 */
export const ContactDiscoveryMatchSchema = z.object({
  phoneE164: e164India,
  isOnPlatform: z.literal(true),
  displayName: z.string(),
  avatarUri: z.string().url().nullable(),
});
export type ContactDiscoveryMatch = z.infer<typeof ContactDiscoveryMatchSchema>;

export const DiscoverContactsResponseSchema = z.object({
  matches: z.array(ContactDiscoveryMatchSchema),
});
export type DiscoverContactsResponse = z.infer<typeof DiscoverContactsResponseSchema>;

/**
 * Request for `POST /contacts/bulk` — write path. Each item carries the same
 * shape as `POST /contacts`; the service dedups against the existing
 * `(ownerUserId, phoneE164)` unique constraint and returns saved-vs-already
 * counts.
 */
export const BulkAddContactsSchema = z.object({
  items: z.array(AddContactSchema).min(1).max(500),
});
export type BulkAddContactsBody = z.infer<typeof BulkAddContactsSchema>;

export const BulkAddContactsResponseSchema = z.object({
  /** Freshly inserted rows, full Contact DTO. */
  saved: z.array(ContactSchema),
  /** Count of items that were already in the owner's contacts (silently skipped). */
  alreadyHad: z.number().int().nonnegative(),
});
export type BulkAddContactsResponse = z.infer<typeof BulkAddContactsResponseSchema>;
