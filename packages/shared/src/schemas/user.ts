import { z } from 'zod';

/**
 * Public-facing user shape (what `/me` returns). PII fields (phoneE164) are only
 * present in admin views of other users; for the *self* view they're always set.
 */
export const SelfUserSchema = z.object({
  id: z.string().uuid(),
  phoneE164: z.string(),
  fullName: z.string(),
  bio: z.string().nullable(),
  avatarUri: z.string().nullable(),
  isPremium: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SelfUser = z.infer<typeof SelfUserSchema>;

export const ProfileUpdateSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long'),
  bio: z.string().trim().max(160, 'Bio is too long').nullable().optional(),
  avatarUri: z.string().url().nullable().optional(),
});
export type ProfileUpdateBody = z.infer<typeof ProfileUpdateSchema>;
