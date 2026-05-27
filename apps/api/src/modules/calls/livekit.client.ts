import { createHmac, randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient, WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk';

import type { Env } from '../../config/env';

/**
 * LiveKit room management + access-token mint (Tranche 2.H, PR-2).
 *
 * Provider note: this replaces the earlier 100ms stub (`hms.client.ts`). Only
 * this file + the env-var prefix are provider-specific — the calls lifecycle,
 * BullMQ ring-timeout, socket fan-out, and CALL_EVENT rows are all
 * provider-agnostic (see `docs/architecture/calls-provider-poc.md` §8.1).
 *
 * STUB MODE: when `LIVEKIT_*` env vars are unset (local dev + the e2e suite),
 * `createRoom` returns the room name as-is, `mintClientToken` returns a
 * self-signed HS256 token that is NOT valid against LiveKit edges (a
 * wire-format placeholder so the calls service + e2e are bit-identical with
 * and without creds), and `verifyWebhook` rejects everything. Set
 * LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL for real media.
 */

export interface LiveKitRoom {
  id: string;
  name: string;
}

export interface LiveKitClientToken {
  token: string;
  expiresAt: string;
  wsUrl: string;
}

@Injectable()
export class LiveKitClient {
  private readonly log = new Logger(LiveKitClient.name);
  private readonly apiKey: string | null;
  private readonly apiSecret: string | null;
  private readonly wsUrl: string | null;
  private readonly roomService: RoomServiceClient | null;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.apiKey = config.get('LIVEKIT_API_KEY', { infer: true }) ?? null;
    this.apiSecret = config.get('LIVEKIT_API_SECRET', { infer: true }) ?? null;
    this.wsUrl = config.get('LIVEKIT_URL', { infer: true }) ?? null;
    this.roomService =
      this.isConfigured() && this.httpUrl()
        ? new RoomServiceClient(this.httpUrl() as string, this.apiKey as string, this.apiSecret as string)
        : null;
    if (!this.isConfigured()) {
      this.log.warn(
        'LIVEKIT_* env vars not set — calls module running in STUB MODE. ' +
          '`/calls/token` mints synthetic room names + dev tokens NOT valid against LiveKit. ' +
          'Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL for real media (Tranche 2.H PR-2).',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.wsUrl);
  }

  /** LiveKit's RoomServiceClient (REST) speaks https; our env carries the wss client URL. */
  private httpUrl(): string | null {
    if (!this.wsUrl) return null;
    return this.wsUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
  }

  /**
   * Pre-create the room with a hard `maxParticipants: 2` (1-on-1 cap — the
   * server-side defense against a 3rd party joining with a leaked token) and a
   * short `emptyTimeout` so an unanswered ring's room self-cleans. LiveKit also
   * auto-creates rooms on first join, so a transient failure here is non-fatal.
   * Returns the room NAME as the id (LiveKit joins/grants/deletes by name).
   */
  async createRoom(input: { name: string }): Promise<LiveKitRoom> {
    if (!this.isConfigured() || !this.roomService) {
      this.log.debug({ name: input.name }, 'stub createRoom');
      return { id: input.name, name: input.name };
    }
    try {
      await this.roomService.createRoom({ name: input.name, emptyTimeout: 45, maxParticipants: 2 });
    } catch (err) {
      // Non-fatal: the room auto-creates on first join even if pre-create fails.
      this.log.warn({ err, name: input.name }, 'livekit createRoom failed (continuing)');
    }
    return { id: input.name, name: input.name };
  }

  /** Best-effort teardown so a finished/abandoned room can't be re-joined. */
  async disableRoom(roomName: string): Promise<void> {
    if (!this.isConfigured() || !this.roomService) {
      this.log.debug({ roomName }, 'stub disableRoom');
      return;
    }
    await this.roomService.deleteRoom(roomName);
  }

  /**
   * Mint a LiveKit access token scoped to one room. `identity = userId` so
   * LiveKit rejects duplicate-identity joins and webhook events attribute
   * cleanly. TTL is 2h (gates JOIN, not session length) so a mid-call
   * reconnect on a flaky Indian network past the 15-min mark still rejoins.
   */
  async mintClientToken(input: {
    roomName: string;
    userId: string;
    ttlSec?: number;
  }): Promise<LiveKitClientToken> {
    const ttlSec = input.ttlSec ?? 7200; // 2h
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const expiresAt = new Date(exp * 1000).toISOString();

    if (!this.isConfigured()) {
      const token = stubToken(input.roomName, input.userId, exp);
      return { token, expiresAt, wsUrl: this.wsUrl ?? 'wss://stub.invalid' };
    }

    const at = new AccessToken(this.apiKey as string, this.apiSecret as string, {
      identity: input.userId,
      ttl: ttlSec,
    });
    at.addGrant({ roomJoin: true, room: input.roomName, canPublish: true, canSubscribe: true });
    const token = await at.toJwt(); // async in livekit-server-sdk v2
    return { token, expiresAt, wsUrl: this.wsUrl as string };
  }

  /**
   * Verify a LiveKit webhook. LiveKit signs a JWT (over the body's sha256) and
   * sends it in the `Authorization` header with `Content-Type:
   * application/webhook+json`. Returns the decoded event, or `null` when
   * unverifiable (stub mode / bad signature) — the caller 403s on null.
   */
  async verifyWebhook(rawBody: Buffer, authHeader: string | undefined): Promise<WebhookEvent | null> {
    if (!this.isConfigured() || !authHeader) return null;
    try {
      const receiver = new WebhookReceiver(this.apiKey as string, this.apiSecret as string);
      return await receiver.receive(rawBody.toString('utf8'), authHeader);
    } catch (err) {
      this.log.warn({ err }, 'livekit webhook verification failed');
      return null;
    }
  }
}

/**
 * Stub-mode self-signed HS256 token. NOT valid against LiveKit — purely a
 * wire-format placeholder so the calls service + e2e behave identically
 * with/without creds. (Mirrors the shape the real `toJwt()` produces.)
 */
function stubToken(roomName: string, userId: string, exp: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    video: { roomJoin: true, room: roomName, canPublish: true, canSubscribe: true },
    iss: 'stub',
    exp,
    nbf: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  };
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = createHmac('sha256', 'stub-dev-secret')
    .update(signingInput)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${sig}`;
}
