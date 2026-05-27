import { z } from 'zod';

/**
 * Voice/Video calls (Tranche 2.H — 1-on-1 scope).
 *
 * Scope note: calls are STRICTLY 1-on-1 in v1. The schema is intentionally
 * narrow — no group calls, no SIP / phone-number ingress, no scheduled
 * calls. Multi-device first-accept-wins semantics live on the gateway
 * (per-call `pg_advisory_xact_lock`); the wire format here is provider-
 * agnostic (works for 100ms or LiveKit Cloud — see
 * `docs/architecture/calls-provider-poc.md`).
 *
 * Wire shapes:
 *   - POST  /calls/token               body: CallTokenRequest → CallTokenResponse
 *   - POST  /calls/:callId/accept      → CallAcceptResponse
 *   - POST  /calls/:callId/decline     → 204
 *   - POST  /calls/:callId/hangup      → 204
 *   - POST  /calls/webhooks/livekit    (JWT-signed Authorization header) → 200
 *   - GET   /chats/:chatId/calls       → { items: CallSummary[] }
 *
 * Socket events (per-viewer via the existing `user:{userId}` room joined on
 * connect in 2.F PR-1):
 *   - call:ring       (callee's devices)
 *   - call:accepted   (both peers)
 *   - call:ended      (both peers — reason: missed | declined | hangup | webhook)
 *   - call:taken      (callee's OTHER devices when one accepts)
 *
 * Authoring rule: CALL_EVENT messages are server-authored (POLL / SYSTEM /
 * CALL_EVENT are all in `SERVER_ONLY_KINDS` — see messages.ts:27-32). The
 * calls module uses `MessagesService.createServerAuthored` (introduced in
 * 2.F PR-1) to insert "Missed voice call" / "Voice call · 4m 12s" rows.
 */

export const CallKindEnum = z.enum(['VOICE', 'VIDEO']);
export type CallKind = z.infer<typeof CallKindEnum>;

export const CallStatusEnum = z.enum([
  'RINGING',
  'ACCEPTED',
  'DECLINED',
  'MISSED',
  'COMPLETED',
]);
export type CallStatus = z.infer<typeof CallStatusEnum>;

/** End-reason for `call:ended` broadcasts — drives the in-thread CALL_EVENT text. */
export const CallEndReasonEnum = z.enum(['missed', 'declined', 'hangup', 'webhook']);
export type CallEndReason = z.infer<typeof CallEndReasonEnum>;

/**
 * Compact user card sent on `call:ring` — `displayName` + avatar drive the
 * IncomingCallScreen header. **No phone number** by design — calls are 1-on-1
 * so the callee already has the initiator in their contacts (or has shared a
 * chat with them); leaking phone on the ring envelope adds zero value and
 * widens the PII surface.
 */
export const CallParticipantSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  avatarUri: z.string().url().nullable(),
});
export type CallParticipant = z.infer<typeof CallParticipantSchema>;

// ─── REST shapes ─────────────────────────────────────────────────────────────

export const CallTokenRequestSchema = z.object({
  chatId: z.string().uuid(),
  kind: CallKindEnum,
});
export type CallTokenRequestBody = z.infer<typeof CallTokenRequestSchema>;

/**
 * Returned by POST /calls/token (initiator). `wsUrl` + `accessToken` are what
 * `@livekit/react-native` `Room.connect(wsUrl, accessToken)` needs; `roomName`
 * is carried for display/debugging (the token already encodes the room grant).
 */
export const CallTokenResponseSchema = z.object({
  callId: z.string().uuid(),
  roomName: z.string().min(1),
  accessToken: z.string().min(1),
  wsUrl: z.string().min(1),
  expiresAt: z.string().datetime(),
});
export type CallTokenResponse = z.infer<typeof CallTokenResponseSchema>;

/** Returned by /accept (the callId is already known to the caller). */
export const CallAcceptResponseSchema = z.object({
  roomName: z.string().min(1),
  accessToken: z.string().min(1),
  wsUrl: z.string().min(1),
  expiresAt: z.string().datetime(),
});
export type CallAcceptResponse = z.infer<typeof CallAcceptResponseSchema>;

/** History row for the in-thread Calls section (BRD §3.6 Per-chat options "Calls"). */
export const CallSummarySchema = z.object({
  callId: z.string().uuid(),
  chatId: z.string().uuid(),
  kind: CallKindEnum,
  status: CallStatusEnum,
  initiatorUserId: z.string().uuid(),
  calleeUserId: z.string().uuid(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  durationSec: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
});
export type CallSummary = z.infer<typeof CallSummarySchema>;

export const CallListResponseSchema = z.object({
  items: z.array(CallSummarySchema),
});
export type CallListResponse = z.infer<typeof CallListResponseSchema>;

// ─── Socket payloads ─────────────────────────────────────────────────────────

/**
 * S→C on the callee's `user:{calleeUserId}` room (fan-out to ALL their
 * devices). `ringExpiresAt` is when the BullMQ ring-timeout fires — clients
 * can use it to drive a local countdown that matches the server's 30s budget.
 */
export const SocketCallRingSchema = z.object({
  callId: z.string().uuid(),
  chatId: z.string().uuid(),
  roomName: z.string().min(1),
  kind: CallKindEnum,
  initiator: CallParticipantSchema,
  ringExpiresAt: z.string().datetime(),
});
export type SocketCallRing = z.infer<typeof SocketCallRingSchema>;

/** S→C on both peers' `user:{userId}` rooms when the callee accepts. */
export const SocketCallAcceptedSchema = z.object({
  callId: z.string().uuid(),
});
export type SocketCallAccepted = z.infer<typeof SocketCallAcceptedSchema>;

/**
 * S→C on both peers when the call ends. `durationSec` is null for
 * missed/declined (the call never started); populated for hangup/webhook.
 */
export const SocketCallEndedSchema = z.object({
  callId: z.string().uuid(),
  reason: CallEndReasonEnum,
  durationSec: z.number().int().nonnegative().nullable(),
});
export type SocketCallEnded = z.infer<typeof SocketCallEndedSchema>;

/**
 * S→C broadcast on the callee's `user:{calleeUserId}` room AFTER an accept
 * lands. The accepting device transitions to the CallScreen; OTHER devices
 * receive `call:taken` and dismiss their IncomingCallScreen. (Sent to the
 * whole room — the accepting socket is already navigating away and just
 * ignores its own self-echo.)
 */
export const SocketCallTakenSchema = z.object({
  callId: z.string().uuid(),
});
export type SocketCallTaken = z.infer<typeof SocketCallTakenSchema>;
