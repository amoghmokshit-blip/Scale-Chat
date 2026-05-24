import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Inject } from '@nestjs/common';
import {
  type MessageDto,
  type SocketMessageDeleted,
  type SocketMessageSendAck,
  type SocketPresenceUpdate,
  type SocketSessionResumePayload,
  type SocketSessionResumeReply,
  SendMessageSchema,
  SocketEvents,
  SocketMessageSendSchema,
  SocketPresenceRequestSchema,
  SocketSessionResumeSchema,
  SocketTypingPingSchema,
} from '@scalechat/shared';
import { Server, Socket } from 'socket.io';

import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { AppJwtService } from '../../common/auth/jwt.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { MessagesService } from './messages.service';

/**
 * Socket.IO chat gateway — real-time push for the 1-on-1 chat slice.
 *
 * Connection lifecycle:
 *   1. Client opens a socket with `auth: { token: <accessJwt> }`. We verify the
 *      JWT in `handleConnection`; reject otherwise. The verified `userId` lives
 *      on `socket.data.userId` for the rest of the connection.
 *   2. On connect we look up every chat the user is a member of and join the
 *      `chat:{chatId}` rooms so server-emitted `message:new` reaches them
 *      without a per-event subscribe.
 *
 * Events:
 *   - `message:send`     (C→S)   send a new message; server validates, persists
 *                                with idempotent advisory-locked sequence, and
 *                                fans out `message:new` to the room. Acks the
 *                                sender with the durable `MessageDto`.
 *   - `message:new`      (S→C)   broadcast on the chat room when a message lands.
 *   - `session:resume`   (C→S)   "catch me up since `lastSeenSequence`" — emits
 *                                missed messages in chronological order.
 *   - `chat:read`        (S→C)   peer's read-receipt advanced (REST `PATCH
 *                                /chats/:id/read` triggers this).
 *
 * Horizontal scaling: the Redis adapter fans events between Fly instances so two
 * users connected to different machines still see each other's messages. The
 * pub/sub channel uses the same Upstash instance the rest of the app uses.
 *
 * **Why both REST + socket?** REST send remains the canonical durable path
 * (idempotent, cursored pagination, predictable HTTP semantics). The socket is
 * the *real-time* path — it reuses `MessagesService.send()` so the storage
 * contract (advisory lock, idempotency, sequence allocation) is bit-identical.
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    // Allowed origins are validated by main.ts CORS already; mirror here so the
    // socket.io handshake matches.
    origin: (origin, cb) => cb(null, origin ?? true),
    credentials: false,
  },
})
export class MessagesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(MessagesGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: AppJwtService,
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  onModuleInit(): void {
    // No-op — adapter is wired in `afterInit` once `server` is available.
  }

  async afterInit(): Promise<void> {
    try {
      const pub = this.redis.duplicate();
      const sub = this.redis.duplicate();
      // Best-effort: if Redis is unavailable we keep running with the in-memory
      // adapter (single-instance dev). Multi-instance prod always has Redis.
      this.server.adapter(createAdapter(pub, sub));
      this.logger.log('chat gateway initialized with redis adapter');
    } catch (err) {
      this.logger.warn(
        { err },
        'chat gateway: redis adapter init failed — falling back to in-memory'
      );
    }
  }

  async handleConnection(@ConnectedSocket() socket: Socket): Promise<void> {
    const token = extractToken(socket);
    if (!token) {
      socket.emit('connect_error', { code: 'missing_token', message: 'No access token in handshake' });
      socket.disconnect(true);
      return;
    }
    let claims: AccessTokenPayload;
    try {
      claims = this.jwt.verifyAccessToken(token);
    } catch {
      socket.emit('connect_error', { code: 'invalid_token', message: 'Access token rejected' });
      socket.disconnect(true);
      return;
    }
    socket.data.userId = claims.sub;

    // Join every active chat the user is a member of so room broadcasts reach them.
    const memberships = await this.prisma.chatMember.findMany({
      where: { userId: claims.sub, leftAt: null },
      select: { chatId: true },
    });
    for (const m of memberships) {
      await socket.join(roomFor(m.chatId));
    }

    // Join this user's own presence room so peers can subscribe to their status.
    await socket.join(presenceRoomFor(claims.sub));

    // Presence: increment socket count, broadcast `isOnline=true` on the
    // edge from 0→1. Idempotent on reconnect.
    try {
      const count = await this.redis.incr(presenceKey(claims.sub));
      if (count === 1) {
        const update: SocketPresenceUpdate = {
          userId: claims.sub,
          isOnline: true,
          lastSeenAt: null,
        };
        this.server.to(presenceRoomFor(claims.sub)).emit(SocketEvents.presenceUpdate, update);
      }
    } catch (err) {
      this.logger.warn({ err }, 'presence increment failed (non-fatal)');
    }

    this.logger.log(
      { userId: claims.sub, rooms: memberships.length },
      'socket connected'
    );
  }

  async handleDisconnect(@ConnectedSocket() socket: Socket): Promise<void> {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;

    try {
      const remaining = await this.redis.decr(presenceKey(userId));
      if (remaining <= 0) {
        // Reset to 0 (defensive — never go negative if redis was flushed mid-session).
        if (remaining < 0) await this.redis.set(presenceKey(userId), 0);
        const lastSeenAt = new Date().toISOString();
        await this.redis.set(lastSeenKey(userId), lastSeenAt);
        const update: SocketPresenceUpdate = {
          userId,
          isOnline: false,
          lastSeenAt,
        };
        this.server.to(presenceRoomFor(userId)).emit(SocketEvents.presenceUpdate, update);
      }
    } catch (err) {
      this.logger.warn({ err, userId }, 'presence decrement failed (non-fatal)');
    }

    this.logger.log({ userId }, 'socket disconnected');
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  @SubscribeMessage(SocketEvents.messageSend)
  async onSend(
    @MessageBody() raw: unknown,
    @ConnectedSocket() socket: Socket
  ): Promise<SocketMessageSendAck> {
    const userId = socket.data.userId as string | undefined;
    if (!userId) {
      return { ok: false, clientMessageId: 'unknown', code: 'not_a_member', message: 'Not authenticated' };
    }

    // Parse on the wire; the outer envelope is the chatId + the same SendMessageBody
    // the REST endpoint accepts.
    const parsed = SocketMessageSendSchema.safeParse(raw);
    if (!parsed.success) {
      const clientMessageId = extractClientMessageId(raw);
      return {
        ok: false,
        clientMessageId,
        code: 'invalid_payload',
        message: parsed.error.issues[0]?.message ?? 'Invalid payload',
      };
    }
    // Defense-in-depth: SendMessageSchema's superRefine (kind-specific required
    // fields) runs as part of the parent schema. Re-validate to make the failure
    // surface as `invalid_payload` rather than an exception.
    const inner = SendMessageSchema.safeParse(parsed.data.body);
    if (!inner.success) {
      return {
        ok: false,
        clientMessageId: parsed.data.body.clientMessageId,
        code: 'invalid_payload',
        message: inner.error.issues[0]?.message ?? 'Invalid send body',
      };
    }

    const { chatId, body } = parsed.data;

    try {
      const created = await this.messages.send(userId, chatId, body);
      // Broadcast to everyone in the room (including the sender — they reconcile
      // by `clientMessageId` so duplicates collapse into the optimistic insert).
      this.server.to(roomFor(chatId)).emit(SocketEvents.messageNew, created satisfies MessageDto);
      return { ok: true, clientMessageId: body.clientMessageId, message: created };
    } catch (err) {
      const e = err as { name?: string; message?: string; status?: number };
      this.logger.warn({ err: e, chatId, userId }, 'message:send failed');
      if (e?.status === 403 || e?.name === 'ForbiddenException') {
        return { ok: false, clientMessageId: body.clientMessageId, code: 'not_a_member', message: 'Not a member of this chat' };
      }
      return {
        ok: false,
        clientMessageId: body.clientMessageId,
        code: 'server_error',
        message: 'Could not send. Try again.',
      };
    }
  }

  @SubscribeMessage(SocketEvents.sessionResume)
  async onResume(
    @MessageBody() raw: unknown,
    @ConnectedSocket() socket: Socket
  ): Promise<SocketSessionResumeReply | { ok: false; code: string; message: string }> {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return { ok: false, code: 'unauthenticated', message: 'Not authenticated' };

    const parsed = SocketSessionResumeSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, code: 'invalid_payload', message: 'Invalid resume payload' };
    }
    const { chatId, lastSeenSequence } = parsed.data as SocketSessionResumePayload;

    // Membership check piggybacks on the service.
    const fresh = await this.messages.list(userId, chatId, undefined, 100, 'asc');
    const since = BigInt(lastSeenSequence);
    const missed = fresh.items.filter((m) => BigInt(m.sequence) > since);
    return { chatId, items: missed, hasMore: fresh.meta.hasMore };
  }

  // ─── Typing indicator ──────────────────────────────────────────────────────

  @SubscribeMessage(SocketEvents.typingPing)
  async onTypingPing(
    @MessageBody() raw: unknown,
    @ConnectedSocket() socket: Socket
  ): Promise<void> {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;
    const parsed = SocketTypingPingSchema.safeParse(raw);
    if (!parsed.success) return;
    const { chatId } = parsed.data;

    // Membership check — cheap one-row select; without this any authed user
    // could spam typing events into arbitrary chats.
    const ok = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { id: true, leftAt: true },
    });
    if (!ok || ok.leftAt !== null) return;

    // 5-second TTL window. Client refreshes every ~3s while typing; if the
    // refresh stops arriving, the key expires naturally and we don't have to
    // race a stop event.
    await this.redis.set(typingKey(chatId, userId), '1', 'EX', 5);
    this.server.to(roomFor(chatId)).emit(SocketEvents.typingUpdate, {
      chatId,
      userId,
      isTyping: true,
    });
  }

  // ─── Presence snapshot (initial bootstrap) ─────────────────────────────────

  @SubscribeMessage(SocketEvents.presenceRequest)
  async onPresenceRequest(
    @MessageBody() raw: unknown,
    @ConnectedSocket() socket: Socket
  ): Promise<{ items: SocketPresenceUpdate[] } | { ok: false; code: string }> {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return { ok: false, code: 'unauthenticated' };
    const parsed = SocketPresenceRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'invalid_payload' };

    const items: SocketPresenceUpdate[] = [];
    for (const uid of parsed.data.userIds) {
      const [countRaw, lastSeenAt] = await Promise.all([
        this.redis.get(presenceKey(uid)),
        this.redis.get(lastSeenKey(uid)),
      ]);
      const count = countRaw ? Number.parseInt(countRaw, 10) : 0;
      items.push({
        userId: uid,
        isOnline: count > 0,
        lastSeenAt: count > 0 ? null : lastSeenAt ?? null,
      });
      // Also subscribe this socket to that user's presence room so it gets
      // future updates without re-querying.
      await socket.join(presenceRoomFor(uid));
    }
    return { items };
  }

  // ─── Server-side broadcast helpers (called by REST controllers) ─────────────

  emitMessageNew(message: MessageDto): void {
    this.server.to(roomFor(message.chatId)).emit(SocketEvents.messageNew, message);
  }

  emitReadReceipt(chatId: string, userId: string, uptoSequence: string): void {
    this.server.to(roomFor(chatId)).emit(SocketEvents.readReceipt, { chatId, userId, uptoSequence });
  }

  emitMessageDeleted(payload: SocketMessageDeleted): void {
    this.server.to(roomFor(payload.chatId)).emit(SocketEvents.messageDeleted, payload);
  }
}

function roomFor(chatId: string): string {
  return `chat:${chatId}`;
}

function presenceRoomFor(userId: string): string {
  return `presence:${userId}`;
}

function presenceKey(userId: string): string {
  return `presence:count:${userId}`;
}

function lastSeenKey(userId: string): string {
  return `presence:lastseen:${userId}`;
}

function typingKey(chatId: string, userId: string): string {
  return `typing:${chatId}:${userId}`;
}

function extractToken(socket: Socket): string | null {
  const handshake = socket.handshake;
  // Preferred: explicit `auth: { token }` per socket.io-client convention.
  const fromAuth = (handshake.auth as { token?: string } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
  // Fallback: `?token=` query param for clients that can't set auth.
  const fromQuery = handshake.query.token;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  // Fallback: `Authorization: Bearer ...` header.
  const header = handshake.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

function extractClientMessageId(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'body' in raw) {
    const body = (raw as { body?: { clientMessageId?: unknown } }).body;
    if (body && typeof body.clientMessageId === 'string') return body.clientMessageId;
  }
  return 'unknown';
}
