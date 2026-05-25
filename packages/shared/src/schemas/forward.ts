import { z } from 'zod';

import { MessageSchema } from './messages.js';

/**
 * Forward a message into one or more other 1-on-1 chats (Tranche 2.E).
 *
 * Wire shape:
 *   - POST /messages/:messageId/forward  body: { targetChatIds }  → ForwardResponse
 *
 * Per-target partial success: targets the forwarder isn't a member of, or where
 * either party blocked the other, are returned in `skipped` (NOT a 4xx) — the
 * delivered ones still land. Matches WhatsApp's silent-skip behaviour.
 */
export const ForwardRequestSchema = z.object({
  targetChatIds: z.array(z.string().uuid()).min(1).max(20),
});
export type ForwardRequestBody = z.infer<typeof ForwardRequestSchema>;

export const ForwardSkipReasonEnum = z.enum([
  'not_a_member',
  'peer_blocked',
  'source_not_forwardable',
]);
export type ForwardSkipReason = z.infer<typeof ForwardSkipReasonEnum>;

export const ForwardResponseSchema = z.object({
  /** The forwarded copies that were created (one per delivered target). */
  items: z.array(MessageSchema),
  /** Targets that were skipped, with the reason. */
  skipped: z.array(
    z.object({
      chatId: z.string().uuid(),
      reason: ForwardSkipReasonEnum,
    }),
  ),
});
export type ForwardResponse = z.infer<typeof ForwardResponseSchema>;
