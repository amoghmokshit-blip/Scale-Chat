import { z } from 'zod';

import { paginatedResponse } from './common.js';
import { ContactPublicSchema } from './contacts.js';

const e164India = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile in E.164 form');

export const ChatKindEnum = z.enum(['ONE_ON_ONE', 'GROUP', 'SUPER_GROUP']);
export type ChatKind = z.infer<typeof ChatKindEnum>;

export const ChatFilterEnum = z.enum(['ALL', 'UNREAD', 'GROUP', 'SUPER_GROUP', 'FAVOURITES']);
export type ChatFilter = z.infer<typeof ChatFilterEnum>;

const LastMessagePreviewSchema = z.object({
  id: z.string().uuid(),
  /** Sender id — for the owner this maps to "me", otherwise the counterpart. */
  senderUserId: z.string().uuid(),
  kind: z.enum(['TEXT', 'VOICE', 'IMAGE', 'SYSTEM']),
  /** Preview text; voice/image kinds carry a placeholder like "Voice note · 0:39". */
  preview: z.string(),
  createdAt: z.string().datetime(),
  sequence: z.string(),
});

/**
 * Single row of the Contact Page chats list. The `counterpart` is
 * `ContactPublicSchema` (always masked-safe) so even Super Group rows render
 * without leaking phone numbers.
 */
export const ChatListItemSchema = z.object({
  id: z.string().uuid(),
  kind: ChatKindEnum,
  /** Resolved title — counterpart name for 1-on-1, group title otherwise. */
  title: z.string(),
  avatarUri: z.string().url().nullable(),
  counterpart: ContactPublicSchema.nullable(),
  lastMessage: LastMessagePreviewSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  isFavourite: z.boolean(),
  isMuted: z.boolean(),
});
export type ChatListItem = z.infer<typeof ChatListItemSchema>;

export const ChatListResponseSchema = paginatedResponse(ChatListItemSchema);
export type ChatListResponse = z.infer<typeof ChatListResponseSchema>;

export const ChatListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  filter: ChatFilterEnum.optional().default('ALL'),
});
export type ChatListQuery = z.infer<typeof ChatListQuerySchema>;

export const CreateOneOnOneSchema = z
  .object({
    contactUserId: z.string().uuid().optional(),
    phoneE164: e164India.optional(),
  })
  .refine((v) => v.contactUserId || v.phoneE164, {
    message: 'Either contactUserId or phoneE164 is required',
  });
export type CreateOneOnOneBody = z.infer<typeof CreateOneOnOneSchema>;

export const CreateGroupSchema = z.object({
  title: z.string().trim().min(2).max(80),
  memberUserIds: z.array(z.string().uuid()).min(2).max(256),
  avatarUri: z.string().url().nullable().optional(),
});
export type CreateGroupBody = z.infer<typeof CreateGroupSchema>;

export const CreateSuperGroupSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(280).optional(),
  memberPhoneE164s: z.array(e164India).min(2).max(2048),
  avatarUri: z.string().url().nullable().optional(),
});
export type CreateSuperGroupBody = z.infer<typeof CreateSuperGroupSchema>;

export const MarkReadSchema = z.object({
  uptoSequence: z.string().regex(/^\d+$/, 'sequence must be a numeric string (BigInt)'),
});
export type MarkReadBody = z.infer<typeof MarkReadSchema>;
