import type { SocketCallRing } from '@scalechat/shared';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';

import { chatSocket } from '@/lib/chat-socket';
import { registerForPushAsync } from '@/lib/push';

/**
 * App-wide call wakeup (Tranche 2.I). Headless — mounted once in the root
 * layout. Routes an incoming `call:ring` (foreground socket OR a tapped
 * background push) to the IncomingCallScreen, de-duping the two paths.
 *
 * It also ensures the chat socket is connected and registers this device's
 * push token, so calls ring even when no chat screen is open.
 */
export function CallRingListener() {
  const router = useRouter();
  const handledCallId = useRef<string | null>(null);

  useEffect(() => {
    void chatSocket.ensureConnected();
    void registerForPushAsync();

    function openIncoming(r: SocketCallRing): void {
      if (handledCallId.current === r.callId) return; // socket + push de-dupe
      handledCallId.current = r.callId;
      router.push({
        pathname: '/chat/incoming-call',
        params: {
          callId: r.callId,
          chatId: r.chatId,
          roomName: r.roomName,
          kind: r.kind,
          initiatorName: r.initiator.displayName,
          initiatorAvatar: r.initiator.avatarUri ?? '',
          ringExpiresAt: r.ringExpiresAt,
        },
      });
    }

    const offRing = chatSocket.onCallRing(openIncoming);
    const offTaken = chatSocket.onCallTaken(() => {
      handledCallId.current = null;
    });
    const offEnded = chatSocket.onCallEnded(() => {
      handledCallId.current = null;
    });

    // Background push tap → route from the notification's data payload.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp.notification.request.content.data as
        | (Partial<SocketCallRing> & { type?: string; initiatorName?: string; initiatorAvatar?: string })
        | undefined;
      if (data?.type === 'call:ring' && data.callId && data.chatId && data.roomName && data.kind) {
        openIncoming({
          callId: data.callId,
          chatId: data.chatId,
          roomName: data.roomName,
          kind: data.kind,
          initiator: { id: '', displayName: data.initiatorName ?? 'Unknown', avatarUri: null },
          ringExpiresAt: data.ringExpiresAt ?? new Date(Date.now() + 30_000).toISOString(),
        });
      }
    });

    return () => {
      offRing();
      offTaken();
      offEnded();
      sub.remove();
    };
  }, [router]);

  return null;
}
