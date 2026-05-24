import { z } from 'zod';

import { paginatedResponse } from './common.js';

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
