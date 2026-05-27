import { Feather } from '@expo/vector-icons';
import { isTrackReference } from '@livekit/components-core';
import { useLocalParticipant, useTracks } from '@livekit/components-react';
import { AudioSession, LiveKitRoom, VideoTrack } from '@livekit/react-native';
import type { CallKind } from '@scalechat/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Spacing } from '@/constants/theme';
import { ChatCopy } from '@/features/chat/copy';
import { chatRepository } from '@/features/chat/data';
import { chatSocket } from '@/lib/chat-socket';

/**
 * Active CallScreen (Tranche 2.I). Connects to the LiveKit room with the token
 * minted by /calls/token (caller) or /calls/:id/accept (callee). Audio always;
 * camera for VIDEO. Single "abnormal termination → hangup" path so a connect
 * failure / terminal disconnect never leaves a dangling ACCEPTED session, and a
 * peer/server-side end (call:ended socket) just leaves.
 */
export default function CallScreen() {
  const p = useLocalSearchParams<{
    callId: string;
    accessToken: string;
    wsUrl: string;
    kind: CallKind;
    peerName?: string;
  }>();
  const router = useRouter();
  const isVideo = p.kind === 'VIDEO';
  const [connected, setConnected] = useState(false);
  const endedRef = useRef(false);
  // Mirror `connected` into a ref so the LiveKitRoom callbacks (stable closures)
  // can read the latest connection state without re-subscribing.
  const connectedRef = useRef(false);
  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    // Reclaim audio focus (K5) — interrupts any expo-audio voice playback.
    AudioSession.startAudioSession();
    return () => {
      void AudioSession.stopAudioSession();
    };
  }, []);

  const leave = useCallback(
    (doHangup: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      if (doHangup) chatRepository.hangupCall?.(p.callId).catch(() => undefined);
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    },
    [p.callId, router],
  );

  // Peer/server ended it (declined/missed/hangup/webhook) → leave; the
  // CALL_EVENT row is already recorded server-side.
  useEffect(() => {
    const off = chatSocket.onCallEnded((e) => {
      if (e.callId === p.callId) leave(false);
    });
    return off;
  }, [p.callId, leave]);

  return (
    <View style={styles.root}>
      <LiveKitRoom
        serverUrl={p.wsUrl}
        token={p.accessToken}
        connect
        audio
        video={isVideo}
        onConnected={() => setConnected(true)}
        onDisconnected={() => leave(true)}
        // Only hang up on error once we've actually connected. A pre-connect
        // error (e.g. a transient signal hiccup) shouldn't fire a hangup on a
        // call that may not be ACCEPTED yet — just leave the screen.
        onError={() => leave(connectedRef.current)}>
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <Stage isVideo={isVideo} peerName={p.peerName ?? ''} connected={connected} />
          <Controls isVideo={isVideo} onHangup={() => leave(true)} />
        </SafeAreaView>
      </LiveKitRoom>
    </View>
  );
}

function Stage({ isVideo, peerName, connected }: { isVideo: boolean; peerName: string; connected: boolean }) {
  const cameras = useTracks([Track.Source.Camera]).filter(isTrackReference);
  if (isVideo && cameras.length > 0) {
    // Last published camera (remote peer) full-screen; our own as a PiP tile.
    const remote = cameras[cameras.length - 1];
    const local = cameras.length > 1 ? cameras[0] : undefined;
    return (
      <View style={styles.stage}>
        <VideoTrack trackRef={remote} style={styles.remoteVideo} />
        {local ? <VideoTrack trackRef={local} style={styles.localVideo} /> : null}
        {peerName ? <ThemedText style={styles.peerNameOverlay}>{peerName}</ThemedText> : null}
      </View>
    );
  }
  return (
    <View style={styles.stage}>
      <View style={styles.avatar}>
        <Feather name={isVideo ? 'video' : 'user'} size={56} color="#FFFFFF" />
      </View>
      {peerName ? <ThemedText style={styles.peerName}>{peerName}</ThemedText> : null}
      <ThemedText style={styles.status}>{connected ? '' : ChatCopy.calls.connecting}</ThemedText>
    </View>
  );
}

function Controls({ isVideo, onHangup }: { isVideo: boolean; onHangup: () => void }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const micOn = isMicrophoneEnabled ?? true;
  const camOn = isCameraEnabled ?? isVideo;

  return (
    <View style={styles.controls}>
      <CircleBtn
        icon={micOn ? 'mic' : 'mic-off'}
        label={micOn ? ChatCopy.calls.mute : ChatCopy.calls.unmute}
        onPress={() => void localParticipant.setMicrophoneEnabled(!micOn)}
      />
      {isVideo ? (
        <CircleBtn
          icon={camOn ? 'video' : 'video-off'}
          label="Camera"
          onPress={() => void localParticipant.setCameraEnabled(!camOn)}
        />
      ) : null}
      <CircleBtn icon="phone-off" label={ChatCopy.calls.endCall} danger onPress={onHangup} />
    </View>
  );
}

function CircleBtn({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <View style={styles.ctrl}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.ctrlBtn, danger && styles.ctrlDanger]}>
        <Feather name={icon} size={24} color="#FFFFFF" />
      </Pressable>
      <ThemedText style={styles.ctrlLabel}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.chatBody },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  remoteVideo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000' },
  localVideo: {
    position: 'absolute',
    top: Spacing.four,
    right: Spacing.three,
    width: 110,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111111',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerName: { fontSize: 24, fontWeight: FontWeight.semibold, color: '#FFFFFF' },
  peerNameOverlay: {
    position: 'absolute',
    top: Spacing.four,
    left: Spacing.four,
    fontSize: 18,
    fontWeight: FontWeight.semibold,
    color: '#FFFFFF',
  },
  status: { fontSize: 15, color: 'rgba(255,255,255,0.7)' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.five,
    paddingVertical: Spacing.four,
  },
  ctrl: { alignItems: 'center', gap: Spacing.one },
  ctrlBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlDanger: { backgroundColor: '#E5484D' },
  ctrlLabel: { fontSize: 12, color: 'rgba(255,255,255,0.85)' },
});
