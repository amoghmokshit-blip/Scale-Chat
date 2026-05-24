import { z } from 'zod';

/**
 * Generic cursor-pagination envelope shared by every list endpoint
 * (`/contacts`, `/chats`, `/stories`).
 *
 * The cursor itself is an opaque base64 string the API encodes/decodes via
 * `apps/api/src/common/pagination/cursor.ts`. Callers should NEVER parse it.
 */
export const CursorMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type CursorMeta = z.infer<typeof CursorMetaSchema>;

export const CursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});
export type CursorQuery = z.infer<typeof CursorQuerySchema>;

export function paginatedResponse<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    meta: CursorMetaSchema,
  });
}
