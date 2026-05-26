import type { ReportReason } from '@scalechat/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { chatSocket } from '@/lib/chat-socket';

import { chatRepository } from '../data';
import type { Message, Thread } from '../types';

export type PeerPresence = {
  isOnline: boolean;
  lastSeenAt: string | null;
};

/**
 * Reactive view of one thread + its messages, driven by the repo's pub/sub.
 *
 * Adds WhatsApp-style live state on top of the message cache:
 *   - `replyingTo`: which message the composer is quoting (null = normal send)
 *   - `peerTyping`: true when the gateway's `typing:update` for the peer fires
 *     and hasn't gone stale (server enforces a 5s TTL; we lower it client-side
 *     to 4.5s so the indicator can't out-live the server's grace window)
 *   - `peerPresence`: { isOnline, lastSeenAt } from the gateway's presence
 *     stream. Bootstraps via `presence:request`, then live-updates on each
 *     `presence:update`.
 *
 * Optimistic send is handled inside the repo (`sendMessage` writes a `sending`
 * row to the cache and notifies before the network round-trip). Optimistic
 * delete (tombstone) is the same — the repo flips `deletedAt` immediately.
 */
export type SendImageInput = {
  /** Device-local file URI from `expo-image-picker`. */
  uri: string;
  width: number;
  height: number;
  /** Defaults to `image/jpeg` if the picker doesn't report it. */
  contentType?: string;
  /** Picker may not report size; the repo `stat`s the file if missing. */
  sizeBytes?: number;
};

export type SendVoiceInput = {
  /** Device-local m4a/aac file URI from the voice recorder. */
  uri: string;
  durationSec: number;
  waveform: number[];
};

export type SendDocumentInput = {
  /** Device-local file URI from `expo-document-picker`. */
  uri: string;
  fileName: string;
  /** Positive byte size (the server rejects 0); validated before this call. */
  sizeBytes: number;
  /** Allowlisted MIME (validated before this call). */
  mimeType: string;
};

export type SendVideoInput = {
  /** Device-local file URI from `expo-image-picker` video pick. */
  uri: string;
  width: number;
  height: number;
  durationSec: number;
  mimeType: string;
  sizeBytes: number;
};

export type SendLocationInput = {
  latitude: number;
  longitude: number;
  /** Reverse-geocoded name; omitted when unavailable. */
  locationName?: string;
};

export function useThread(threadId: string | undefined): {
  thread: Thread | null;
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasMoreOlder: boolean;
  send: (text: string) => Promise<void>;
  sendImage: (input: SendImageInput) => Promise<void>;
  sendVoice: (input: SendVoiceInput) => Promise<void>;
  sendDocument: (input: SendDocumentInput) => Promise<void>;
  sendVideo: (input: SendVideoInput) => Promise<void>;
  sendLocation: (input: SendLocationInput) => Promise<void>;
  loadOlder: () => Promise<void>;
  /** Set the reply target; pass null to clear. */
  replyTo: (message: Message | null) => void;
  replyingTo: Message | null;
  deleteMessage: (messageId: string) => Promise<void>;
  reportMessage: (messageId: string, reason: ReportReason, note?: string) => Promise<void>;
  /** Call on every keystroke; we debounce + rate-limit internally. */
  notifyTyping: () => void;
  peerTyping: boolean;
  peerPresence: PeerPresence;
} {
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerPresence, setPeerPresence] = useState<PeerPresence>({
    isOnline: false,
    lastSeenAt: null,
  });

  // Refs for managing typing emit throttle + receiver expiry.
  const lastTypingEmittedAtRef = useRef(0);
  const peerTypingExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Data load + repo subscription ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (!threadId) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const [nextThread, nextMessages] = await Promise.all([
          chatRepository.getThread(threadId),
          chatRepository.listMessages(threadId),
        ]);
        if (cancelled) return;
        setThread(nextThread);
        setMessages(nextMessages);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    refresh();
    const unsub = chatRepository.subscribe(refresh);
    if (threadId) chatRepository.markThreadRead(threadId);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [threadId]);

  // ─── Typing receiver: subscribe to gateway typing:update ───────────────────
  useEffect(() => {
    if (!threadId || !thread) return;
    const counterpartId = thread.counterpart.id;

    const unsub = chatSocket.onTyping((t) => {
      if (t.chatId !== threadId) return;
      if (t.userId !== counterpartId) return;
      if (!t.isTyping) {
        setPeerTyping(false);
        return;
      }
      setPeerTyping(true);
      if (peerTypingExpiryRef.current) clearTimeout(peerTypingExpiryRef.current);
      // Server TTL is 5s; we expire slightly earlier so we never lag the server.
      peerTypingExpiryRef.current = setTimeout(() => setPeerTyping(false), 4_500);
    });
    return () => {
      unsub();
      if (peerTypingExpiryRef.current) clearTimeout(peerTypingExpiryRef.current);
    };
  }, [threadId, thread]);

  // ─── Presence: bootstrap + subscribe to updates ────────────────────────────
  useEffect(() => {
    if (!thread) return;
    const counterpartId = thread.counterpart.id;
    let cancelled = false;

    void chatSocket.requestPresence([counterpartId]).then((items) => {
      if (cancelled) return;
      const me = items.find((i) => i.userId === counterpartId);
      if (me) setPeerPresence({ isOnline: me.isOnline, lastSeenAt: me.lastSeenAt });
    });

    const unsub = chatSocket.onPresence((p) => {
      if (p.userId !== counterpartId) return;
      setPeerPresence({ isOnline: p.isOnline, lastSeenAt: p.lastSeenAt });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [thread]);

  // ─── Send ──────────────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string) => {
      if (!threadId) return;
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      const replyId = replyingTo?.id;
      // Clear the reply chip BEFORE we await so the composer re-renders cleanly
      // even if the server is slow.
      setReplyingTo(null);
      try {
        await chatRepository.sendMessage({
          threadId,
          type: 'text',
          text: trimmed,
          clientMessageId: newClientMessageId(),
          replyToMessageId: replyId,
        });
      } catch {
        // The repo has already marked the optimistic row as failed and notified.
      }
    },
    [threadId, replyingTo]
  );

  const sendImage = useCallback(
    async (input: SendImageInput) => {
      if (!threadId) return;
      const replyId = replyingTo?.id;
      setReplyingTo(null);
      try {
        await chatRepository.sendMessage({
          threadId,
          type: 'image',
          uri: input.uri,
          width: input.width,
          height: input.height,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          clientMessageId: newClientMessageId(),
          replyToMessageId: replyId,
        });
      } catch {
        // Repo already flipped the optimistic row to `failed`.
      }
    },
    [threadId, replyingTo]
  );

  const sendVoice = useCallback(
    async (input: SendVoiceInput) => {
      if (!threadId) return;
      const replyId = replyingTo?.id;
      setReplyingTo(null);
      try {
        await chatRepository.sendMessage({
          threadId,
          type: 'voice',
          uri: input.uri,
          durationSec: input.durationSec,
          waveform: input.waveform,
          clientMessageId: newClientMessageId(),
          replyToMessageId: replyId,
        });
      } catch {
        // Repo already flipped the optimistic row to `failed`.
      }
    },
    [threadId, replyingTo]
  );

  const sendDocument = useCallback(
    async (input: SendDocumentInput) => {
      if (!threadId) return;
      const replyId = replyingTo?.id;
      setReplyingTo(null);
      try {
        await chatRepository.sendMessage({
          threadId,
          type: 'document',
          uri: input.uri,
          fileName: input.fileName,
          sizeBytes: input.sizeBytes,
          mimeType: input.mimeType,
          clientMessageId: newClientMessageId(),
          replyToMessageId: replyId,
        });
      } catch {
        // Repo already flipped the optimistic row to `failed`.
      }
    },
    [threadId, replyingTo]
  );

  const sendVideo = useCallback(
    async (input: SendVideoInput) => {
      if (!threadId) return;
      const replyId = replyingTo?.id;
      setReplyingTo(null);
      try {
        await chatRepository.sendMessage({
          threadId,
          type: 'video',
          uri: input.uri,
          width: input.width,
          height: input.height,
          durationSec: input.durationSec,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          clientMessageId: newClientMessageId(),
          replyToMessageId: replyId,
        });
      } catch {
        // Repo already flipped the optimistic row to `failed`.
      }
    },
    [threadId, replyingTo]
  );

  const sendLocation = useCallback(
    async (input: SendLocationInput) => {
      if (!threadId) return;
      const replyId = replyingTo?.id;
      setReplyingTo(null);
      try {
        await chatRepository.sendMessage({
          threadId,
          type: 'location',
          latitude: input.latitude,
          longitude: input.longitude,
          locationName: input.locationName,
          clientMessageId: newClientMessageId(),
          replyToMessageId: replyId,
        });
      } catch {
        // Repo already flipped the optimistic row to `failed`.
      }
    },
    [threadId, replyingTo]
  );

  // ─── Load older ────────────────────────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    if (!threadId || loadingOlder || !hasMoreOlder) return;
    const fn = chatRepository.loadOlder;
    if (!fn) return;
    setLoadingOlder(true);
    try {
      const res = await fn.call(chatRepository, threadId);
      setHasMoreOlder(res.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }, [threadId, loadingOlder, hasMoreOlder]);

  // ─── Delete ────────────────────────────────────────────────────────────────
  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!threadId) return;
      const fn = chatRepository.deleteMessage;
      if (!fn) return;
      await fn.call(chatRepository, threadId, messageId);
    },
    [threadId]
  );

  // ─── Reply state setter ────────────────────────────────────────────────────
  const replyTo = useCallback((message: Message | null) => {
    setReplyingTo(message);
  }, []);

  // ─── Report ────────────────────────────────────────────────────────────────
  const reportMessage = useCallback(
    async (messageId: string, reason: ReportReason, note?: string) => {
      const fn = chatRepository.reportMessage;
      if (!fn) return;
      await fn.call(chatRepository, { messageId, reason, note });
    },
    []
  );

  // ─── Typing emitter (rate-limited) ─────────────────────────────────────────
  const notifyTyping = useCallback(() => {
    if (!threadId) return;
    const now = Date.now();
    // Server enforces a 5s TTL; emit at most every 2.5s so we refresh the
    // window without flooding the socket.
    if (now - lastTypingEmittedAtRef.current < 2_500) return;
    lastTypingEmittedAtRef.current = now;
    chatSocket.emitTyping(threadId);
  }, [threadId]);

  return {
    thread,
    messages,
    loading,
    loadingOlder,
    hasMoreOlder,
    send,
    sendImage,
    sendVoice,
    sendDocument,
    sendVideo,
    sendLocation,
    loadOlder,
    replyTo,
    replyingTo,
    deleteMessage,
    reportMessage,
    notifyTyping,
    peerTyping,
    peerPresence,
  };
}

/** Compact-but-unique id for the idempotency key the server uses to dedupe. */
function newClientMessageId(): string {
  return `c-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
