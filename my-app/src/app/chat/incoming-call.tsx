import { Feather } from '@expo/vector-icons';
import type { CallKind } from '@scalechat/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Spacing } from '@/constants/theme';
import { ChatCopy } from '@/features/chat/copy';
import { chatRepository } from '@/features/chat/data';
import { ensureCallPermissions } from '@/lib/call-permissions';
import { chatSocket } from '@/lib/chat-socket';

/**
 * IncomingCallScreen (Tranche 2.I). Rendered when a `call:ring` arrives. Caller
 * card from the ring payload (no fetch). Accept → /accept → CallScreen; Decline
 * → /decline → dismiss. Auto-dismisses if the call is taken on another device
 * or ends (missed/cancelled) while ringing.
 */
export default function IncomingCallScreen() {
  const p = useLocalSearchParams<{
    callId: string;
    chatId: string;
    roomName: string;
    kind: CallKind;
    initiatorName: string;
    initiatorAvatar: string;
    ringExpiresAt: string;
  }>();
  const router = useRouter();
  const isVideo = p.kind === 'VIDEO';
  const busy = useRef(false);
  const dismissed = useRef(false);

  const dismiss = () => {
    // Idempotent: the call:taken / call:ended listeners and the accept/decline
    // paths can all reach here (e.g. the ring times out while the mic dialog is
    // up) — navigating twice would pop an extra screen off the stack.
    if (dismissed.current) return;
    dismissed.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  // Auto-dismiss when the call is taken elsewhere or ends before we answer.
  useEffect(() => {
    const offTaken = chatSocket.onCallTaken((t) => {
      if (t.callId === p.callId) dismiss();
    });
    const offEnded = chatSocket.onCallEnded((e) => {
      if (e.callId === p.callId) dismiss();
    });
    return () => {
      offTaken();
      offEnded();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.callId]);

  async function accept() {
    if (busy.current) return;
    busy.current = true;
    // Pre-grant mic (+ camera for video) BEFORE navigating to the CallScreen, so
    // the OS dialog never interrupts the LiveKit connect. Deny → decline so the
    // caller sees the "declined" pill immediately rather than the 30s MISSED wait.
    const ok = await ensureCallPermissions(p.kind);
    if (!ok) {
      Alert.alert(ChatCopy.calls.permissionTitle, ChatCopy.calls.permissionBody);
      try {
        await chatRepository.declineCall?.(p.callId);
      } catch {
        // ignore — dismiss regardless
      }
      dismiss();
      return;
    }
    try {
      const res = await chatRepository.acceptCall?.(p.callId);
      if (!res) {
        dismiss();
        return;
      }
      router.replace({
        pathname: '/chat/call',
        params: {
          callId: p.callId,
          accessToken: res.accessToken,
          wsUrl: res.wsUrl,
          kind: p.kind,
          peerName: p.initiatorName,
        },
      });
    } catch {
      dismiss();
    }
  }

  async function decline() {
    if (busy.current) return;
    busy.current = true;
    try {
      await chatRepository.declineCall?.(p.callId);
    } catch {
      // ignore — dismiss regardless
    }
    dismiss();
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.hero}>
          <View style={styles.avatar}>
            {p.initiatorAvatar ? (
              <Image source={{ uri: p.initiatorAvatar }} style={styles.avatarImg} />
            ) : (
              <Feather name="user" size={56} color="#FFFFFF" />
            )}
          </View>
          <ThemedText style={styles.name}>{p.initiatorName}</ThemedText>
          <ThemedText style={styles.sub}>
            {isVideo ? ChatCopy.calls.incomingVideo : ChatCopy.calls.incomingVoice}
          </ThemedText>
        </View>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Pressable
              onPress={decline}
              accessibilityRole="button"
              accessibilityLabel={ChatCopy.calls.decline}
              style={[styles.btn, styles.declineBtn]}>
              <Feather name="phone-off" size={26} color="#FFFFFF" />
            </Pressable>
            <ThemedText style={styles.actionLabel}>{ChatCopy.calls.decline}</ThemedText>
          </View>
          <View style={styles.action}>
            <Pressable
              onPress={accept}
              accessibilityRole="button"
              accessibilityLabel={ChatCopy.calls.accept}
              style={[styles.btn, styles.acceptBtn]}>
              <Feather name={isVideo ? 'video' : 'phone'} size={26} color={Brand.chatActionLimeText} />
            </Pressable>
            <ThemedText style={styles.actionLabel}>{ChatCopy.calls.accept}</ThemedText>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.chatHeaderTop },
  safe: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.six },
  hero: { alignItems: 'center', marginTop: Spacing.six, gap: Spacing.three },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: 120, height: 120 },
  name: { fontSize: 26, fontWeight: FontWeight.semibold, color: '#FFFFFF' },
  sub: { fontSize: 15, color: 'rgba(255,255,255,0.82)' },
  actions: { flexDirection: 'row', gap: Spacing.six, marginBottom: Spacing.four },
  action: { alignItems: 'center', gap: Spacing.two },
  btn: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { backgroundColor: '#E5484D' },
  acceptBtn: { backgroundColor: Brand.chatActionLime },
  actionLabel: { fontSize: 13, color: 'rgba(255,255,255,0.9)' },
});
