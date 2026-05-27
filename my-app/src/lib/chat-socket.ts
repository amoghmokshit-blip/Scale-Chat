import Constants from 'expo-constants';
import {
  type MessageDto,
  type SocketCallAccepted,
  type SocketCallEnded,
  type SocketCallRing,
  type SocketCallTaken,
  type SocketMessageDeleted,
  type SocketMessagePinned,
  type SocketMessageUnpinned,
  type SocketMessageSendAck,
  type SocketMessageSendPayload,
  type SocketPollVoted,
  type SocketPresenceUpdate,
  type SocketReactionUpdated,
  type SocketReadReceipt,
  type SocketSessionResumePayload,
  type SocketSessionResumeReply,
  type SocketTypingUpdate,
  SocketEvents,
} from '@scalechat/shared';
import { io, type Socket } from 'socket.io-client';

import { StorageKeys, storage } from './mmkv';

/**
 * Singleton Socket.IO client for the chat gateway.
 *
 * Design notes:
 *   - **One socket per app session.** Pages subscribe via `subscribe()` and
 *     receive `message:new` / read-receipt events; the socket itself is shared.
 *     Multiple chat screens mounting in quick succession do NOT open multiple
 *     sockets.
 *   - **JWT-in-handshake.** We pass the access token via `auth: { token }` on
 *     connect. On a 401 the API client refreshes; we then `disconnect()` + open
 *     a fresh socket so the next handshake uses the new token. This avoids
 *     trying to mutate an in-flight handshake's auth.
 *   - **No socket = mock**: in the mock-driven dev flow the socket simply never
 *     connects (no base URL). The repo's pub/sub still drives screen updates.
 */

type Listeners = {
  messageNew: Set<(m: MessageDto) => void>;
  messageDeleted: Set<(d: SocketMessageDeleted) => void>;
  readReceipt: Set<(r: SocketReadReceipt) => void>;
  typing: Set<(t: SocketTypingUpdate) => void>;
  presence: Set<(p: SocketPresenceUpdate) => void>;
  reactionUpdated: Set<(r: SocketReactionUpdated) => void>;
  messagePinned: Set<(p: SocketMessagePinned) => void>;
  messageUnpinned: Set<(p: SocketMessageUnpinned) => void>;
  pollVoted: Set<(p: SocketPollVoted) => void>;
  callRing: Set<(r: SocketCallRing) => void>;
  callAccepted: Set<(a: SocketCallAccepted) => void>;
  callEnded: Set<(e: SocketCallEnded) => void>;
  callTaken: Set<(t: SocketCallTaken) => void>;
  connectionChange: Set<(connected: boolean) => void>;
};

function resolveBaseUrl(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromExtra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  const base = (fromEnv && fromEnv.length > 0 ? fromEnv : fromExtra ?? '').replace(/\/$/, '');
  return base.length > 0 ? base : null;
}

class ChatSocketManager {
  private socket: Socket | null = null;
  private connecting = false;
  private readonly listeners: Listeners = {
    messageNew: new Set(),
    messageDeleted: new Set(),
    readReceipt: new Set(),
    typing: new Set(),
    presence: new Set(),
    reactionUpdated: new Set(),
    messagePinned: new Set(),
    messageUnpinned: new Set(),
    pollVoted: new Set(),
    callRing: new Set(),
    callAccepted: new Set(),
    callEnded: new Set(),
    callTaken: new Set(),
    connectionChange: new Set(),
  };

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /** Ensure the socket is connected. Safe to call repeatedly. */
  async ensureConnected(): Promise<void> {
    if (this.socket?.connected) return;
    if (this.connecting) return;
    const base = resolveBaseUrl();
    if (!base) return; // mock-only mode; no server.

    const token = storage.getString(StorageKeys.authAccessToken);
    if (!token) return; // not signed in yet; reconnect after verify lands.

    this.connecting = true;
    try {
      const socket = io(`${base}/chat`, {
        transports: ['websocket'],
        auth: { token },
        // Socket.IO's built-in reconnect is fine; we layer on top by force-
        // reconnecting on token refresh (see `restart()`).
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5_000,
        timeout: 10_000,
      });
      this.attach(socket);
      this.socket = socket;
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Tear down the current socket and open a fresh one. Use after a token
   * refresh so the next handshake carries the new bearer.
   */
  async restart(): Promise<void> {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    await this.ensureConnected();
  }

  disconnect(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
    this.notifyConnection(false);
  }

  /**
   * Send a message via the gateway. Resolves with the server ack — `ok:true` carries
   * the durable `MessageDto`; `ok:false` carries an error code the screen can map.
   * If the socket isn't connected the caller should fall back to the REST send.
   */
  send(payload: SocketMessageSendPayload, timeoutMs = 8_000): Promise<SocketMessageSendAck> {
    return new Promise((resolve, reject) => {
      const s = this.socket;
      if (!s || !s.connected) {
        reject(new Error('socket_not_connected'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('socket_timeout'));
      }, timeoutMs);
      s.emit(SocketEvents.messageSend, payload, (ack: SocketMessageSendAck) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ack);
      });
    });
  }

  /** Catch up messages we missed while disconnected. */
  resume(payload: SocketSessionResumePayload, timeoutMs = 8_000): Promise<SocketSessionResumeReply | null> {
    return new Promise((resolve) => {
      const s = this.socket;
      if (!s || !s.connected) {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => resolve(null), timeoutMs);
      s.emit(SocketEvents.sessionResume, payload, (reply: SocketSessionResumeReply) => {
        clearTimeout(timer);
        resolve(reply);
      });
    });
  }

  /**
   * Fire a typing-ping for a chat. The server enforces a 5s TTL and
   * broadcasts `typing:update` to room members. Best-effort; if the socket
   * isn't connected we simply drop the ping (it's a transient signal).
   */
  emitTyping(chatId: string): void {
    const s = this.socket;
    if (!s || !s.connected) return;
    s.emit(SocketEvents.typingPing, { chatId });
  }

  /**
   * Subscribe to presence updates for the given user IDs. Returns the
   * current snapshot (online/offline + lastSeenAt) and joins the rooms so
   * future updates land via `onPresence`.
   */
  requestPresence(
    userIds: string[],
    timeoutMs = 8_000
  ): Promise<SocketPresenceUpdate[]> {
    return new Promise((resolve) => {
      const s = this.socket;
      if (!s || !s.connected || userIds.length === 0) {
        resolve([]);
        return;
      }
      const timer = setTimeout(() => resolve([]), timeoutMs);
      s.emit(
        SocketEvents.presenceRequest,
        { userIds },
        (reply: { items?: SocketPresenceUpdate[] } | undefined) => {
          clearTimeout(timer);
          resolve(reply?.items ?? []);
        }
      );
    });
  }

  // ─── Event subscription ───────────────────────────────────────────────────

  onMessage(listener: (m: MessageDto) => void): () => void {
    this.listeners.messageNew.add(listener);
    return () => this.listeners.messageNew.delete(listener);
  }

  onMessageDeleted(listener: (d: SocketMessageDeleted) => void): () => void {
    this.listeners.messageDeleted.add(listener);
    return () => this.listeners.messageDeleted.delete(listener);
  }

  onReadReceipt(listener: (r: SocketReadReceipt) => void): () => void {
    this.listeners.readReceipt.add(listener);
    return () => this.listeners.readReceipt.delete(listener);
  }

  onTyping(listener: (t: SocketTypingUpdate) => void): () => void {
    this.listeners.typing.add(listener);
    return () => this.listeners.typing.delete(listener);
  }

  onPresence(listener: (p: SocketPresenceUpdate) => void): () => void {
    this.listeners.presence.add(listener);
    return () => this.listeners.presence.delete(listener);
  }

  onReactionUpdated(listener: (r: SocketReactionUpdated) => void): () => void {
    this.listeners.reactionUpdated.add(listener);
    return () => this.listeners.reactionUpdated.delete(listener);
  }

  onMessagePinned(listener: (p: SocketMessagePinned) => void): () => void {
    this.listeners.messagePinned.add(listener);
    return () => this.listeners.messagePinned.delete(listener);
  }

  onMessageUnpinned(listener: (p: SocketMessageUnpinned) => void): () => void {
    this.listeners.messageUnpinned.add(listener);
    return () => this.listeners.messageUnpinned.delete(listener);
  }

  /**
   * Subscribe to `poll:voted` broadcasts (Tranche 2.F). Personalised per
   * viewer — the server iterates chat members so each recipient receives
   * their own `votedByMe` flags. Fired on poll create, vote, and close.
   */
  onPollVoted(listener: (p: SocketPollVoted) => void): () => void {
    this.listeners.pollVoted.add(listener);
    return () => this.listeners.pollVoted.delete(listener);
  }

  // ─── Call signalling (Tranche 2.H/2.I — per-user `user:{userId}` room) ──────

  /** Incoming call for this user (all their devices). Drives IncomingCallScreen. */
  onCallRing(listener: (r: SocketCallRing) => void): () => void {
    this.listeners.callRing.add(listener);
    return () => this.listeners.callRing.delete(listener);
  }

  /** A call was accepted (both peers) — caller transitions to CallScreen. */
  onCallAccepted(listener: (a: SocketCallAccepted) => void): () => void {
    this.listeners.callAccepted.add(listener);
    return () => this.listeners.callAccepted.delete(listener);
  }

  /** A call ended (declined/missed/hangup/webhook) — dismiss call UI + show CALL_EVENT. */
  onCallEnded(listener: (e: SocketCallEnded) => void): () => void {
    this.listeners.callEnded.add(listener);
    return () => this.listeners.callEnded.delete(listener);
  }

  /** Another of this user's devices accepted — dismiss our IncomingCallScreen. */
  onCallTaken(listener: (t: SocketCallTaken) => void): () => void {
    this.listeners.callTaken.add(listener);
    return () => this.listeners.callTaken.delete(listener);
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.listeners.connectionChange.add(listener);
    return () => this.listeners.connectionChange.delete(listener);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private attach(socket: Socket): void {
    socket.on('connect', () => this.notifyConnection(true));
    socket.on('disconnect', () => this.notifyConnection(false));
    socket.on('connect_error', () => this.notifyConnection(false));
    socket.on(SocketEvents.messageNew, (m: MessageDto) => {
      this.listeners.messageNew.forEach((l) => l(m));
    });
    socket.on(SocketEvents.messageDeleted, (d: SocketMessageDeleted) => {
      this.listeners.messageDeleted.forEach((l) => l(d));
    });
    socket.on(SocketEvents.readReceipt, (r: SocketReadReceipt) => {
      this.listeners.readReceipt.forEach((l) => l(r));
    });
    socket.on(SocketEvents.typingUpdate, (t: SocketTypingUpdate) => {
      this.listeners.typing.forEach((l) => l(t));
    });
    socket.on(SocketEvents.presenceUpdate, (p: SocketPresenceUpdate) => {
      this.listeners.presence.forEach((l) => l(p));
    });
    socket.on(SocketEvents.reactionUpdated, (r: SocketReactionUpdated) => {
      this.listeners.reactionUpdated.forEach((l) => l(r));
    });
    socket.on(SocketEvents.messagePinned, (p: SocketMessagePinned) => {
      this.listeners.messagePinned.forEach((l) => l(p));
    });
    socket.on(SocketEvents.messageUnpinned, (p: SocketMessageUnpinned) => {
      this.listeners.messageUnpinned.forEach((l) => l(p));
    });
    socket.on(SocketEvents.pollVoted, (p: SocketPollVoted) => {
      this.listeners.pollVoted.forEach((l) => l(p));
    });
    socket.on(SocketEvents.callRing, (r: SocketCallRing) => {
      this.listeners.callRing.forEach((l) => l(r));
    });
    socket.on(SocketEvents.callAccepted, (a: SocketCallAccepted) => {
      this.listeners.callAccepted.forEach((l) => l(a));
    });
    socket.on(SocketEvents.callEnded, (e: SocketCallEnded) => {
      this.listeners.callEnded.forEach((l) => l(e));
    });
    socket.on(SocketEvents.callTaken, (t: SocketCallTaken) => {
      this.listeners.callTaken.forEach((l) => l(t));
    });
  }

  private notifyConnection(connected: boolean): void {
    this.listeners.connectionChange.forEach((l) => l(connected));
  }
}

export const chatSocket = new ChatSocketManager();
