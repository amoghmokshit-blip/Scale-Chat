import { z } from 'zod';

import { MessageKindEnum } from './messages.js';

/**
 * One row in the per-kind breakdown — counts + bytes for a single MessageKind.
 * `totalBytes` is returned as a string (serialised bigint) so it can cross
 * the JSON boundary without precision loss (> 2^53 is possible for heavy media
 * chats on 64-bit Postgres BIGINT SUM).
 */
export const ChatStorageKindRowSchema = z.object({
  kind: MessageKindEnum,
  count: z.number().int().nonnegative(),
  totalBytes: z.string().regex(/^\d+$/),
});
export type ChatStorageKindRow = z.infer<typeof ChatStorageKindRowSchema>;

/**
 * Response for `GET /chats/:chatId/storage`.
 * `perKind` is ordered by `totalBytes` DESC (heaviest kind first).
 * `totalBytes` is the grand total across all kinds.
 */
export const ChatStorageSummarySchema = z.object({
  perKind: z.array(ChatStorageKindRowSchema),
  totalBytes: z.string().regex(/^\d+$/),
});
export type ChatStorageSummary = z.infer<typeof ChatStorageSummarySchema>;
