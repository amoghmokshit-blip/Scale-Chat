import { z } from 'zod';
import { paginatedResponse } from './common.js';

/**
 * P2-Search — GET /chats/:chatId/messages/search
 *
 * A lightweight full-text search over a user's visible message history within
 * a single chat. Results are ordered by sequence DESC (newest first) and
 * cursor-paginated.
 *
 * Note: the privacy interceptor logs a debug warning for `senderUserId` in
 * audit mode (not fail-closed) — the field is intentionally retained here
 * because it is essential domain data for the search-hit card UI (shows who
 * sent the matched message). Once the interceptor graduates to fail-closed,
 * endpoints opting in to PII should use `@SelfView()` or an equivalent
 * decorator.
 */

/** A single matched message returned from the search endpoint. */
export const MessageSearchHitSchema = z.object({
  messageId: z.string().uuid(),
  /** Monotonic sequence number within the chat. Matches `/^\d+$/`. */
  sequence: z.string().regex(/^\d+$/),
  /** ±~20-char window around the first match, with ellipsis trimming. */
  snippet: z.string(),
  createdAt: z.string().datetime(),
  senderUserId: z.string().uuid(),
});
export type MessageSearchHit = z.infer<typeof MessageSearchHitSchema>;

/** Paginated search result — the wire shape for the endpoint response. */
export const MessageSearchPageSchema = paginatedResponse(MessageSearchHitSchema);
export type MessageSearchPage = z.infer<typeof MessageSearchPageSchema>;

/** Validated query params for GET /chats/:chatId/messages/search. */
export const MessageSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
export type MessageSearchQuery = z.infer<typeof MessageSearchQuerySchema>;
