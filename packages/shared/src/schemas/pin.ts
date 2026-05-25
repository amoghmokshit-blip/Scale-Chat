import { z } from 'zod';

import { MessageSchema } from './messages.js';

/**
 * Pin / unpin messages within a chat (Tranche 2.E). Max 3 pinned per chat.
 *
 * Wire shape:
 *   - PATCH  /chats/:chatId/messages/:messageId/pin   → MessageDto (updated)
 *   - DELETE /chats/:chatId/messages/:messageId/pin   → MessageDto (updated, idempotent)
 *   - GET    /chats/:chatId/pins                       → PinListResponse (≤3, newest pinned first)
 */
export const MAX_PINNED_PER_CHAT = 3;

export const PinListResponseSchema = z.object({
  items: z.array(MessageSchema),
});
export type PinListResponse = z.infer<typeof PinListResponseSchema>;
