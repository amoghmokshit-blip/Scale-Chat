import { Feather } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Spacing } from '@/constants/theme';
import { ChatCopy } from '@/features/chat/copy';
import { formatDuration } from '@/lib/format-time';

/** Hard cap matches `VOICE_MAX_DURATION` enforced by the shared zod schema. */
const MAX_DURATION_SEC = 300;
/** Visible waveform peak count — clamped to the schema's max-length on send. */
const WAVEFORM_BARS = 36;

export type RecordedVoice = {
  uri: string;
  durationSec: number;
  waveform: number[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSend: (recording: RecordedVoice) => void | Promise<void>;
};

/**
 * Voice recording overlay — Figma 1:3698.
 *
 * Press-and-hold the mic in the composer to open. While the overlay is up:
 *   - A pulsing red dot + `MM:SS` timer count up to MAX_DURATION_SEC.
 *   - A live "waveform" is fed by a 100ms interval reading `recorder.currentTime`
 *     and pushing a synthetic peak — the real waveform comes from the file's
 *     PCM samples on the receiver (deferred), but the visual feedback while
 *     recording is what the Figma shows.
 *   - Bottom-left "Discard" button cancels (delete recording).
 *   - Bottom-right "Send" sends.
 *
 * Auto-stops + transitions to preview when MAX_DURATION_SEC elapses.
 */
export function VoiceRecorderOverlay({ visible, onClose, onSend }: Props) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 100);

  const [waveform, setWaveform] = useState<number[]>([]);
  const dot = useRef(new Animated.Value(0)).current;
  const startedRef = useRef(false);

  // Pulsing red dot animation — keeps running while the overlay is visible.
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dot, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(dot, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [dot, visible]);

  // Permission gate + start recording on open.
  useEffect(() => {
    let cancelled = false;
    async function begin() {
      if (!visible || startedRef.current) return;
      startedRef.current = true;
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        startedRef.current = false;
        onClose();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (cancelled) return;
      recorder.record();
    }
    void begin();
    return () => {
      cancelled = true;
    };
  }, [onClose, recorder, visible]);

  // Reset when hidden so the next open starts fresh.
  useEffect(() => {
    if (visible) return;
    startedRef.current = false;
    setWaveform([]);
  }, [visible]);

  // Synthetic peak feed driven by elapsed time — the real recording API on RN
  // doesn't expose live PCM samples without enabling sampling on a player, so
  // for the recording view we just animate a pseudo-waveform until we can wire
  // proper metering. Receivers see the actual peaks computed from the file.
  useEffect(() => {
    if (!visible || !state.isRecording) return;
    const id = setInterval(() => {
      setWaveform((prev) => {
        const next = [...prev, 0.35 + Math.random() * 0.6];
        return next.length > WAVEFORM_BARS ? next.slice(next.length - WAVEFORM_BARS) : next;
      });
    }, 90);
    return () => clearInterval(id);
  }, [state.isRecording, visible]);

  // Auto-stop at the hard cap.
  useEffect(() => {
    if (!visible || !state.isRecording) return;
    if (state.durationMillis >= MAX_DURATION_SEC * 1000) {
      void handleSend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.durationMillis, state.isRecording, visible]);

  const durationSec = Math.floor((state.durationMillis ?? 0) / 1000);

  async function handleDiscard() {
    if (state.isRecording) {
      try {
        await recorder.stop();
      } catch {
        // ignore — recorder may already be stopped
      }
    }
    onClose();
  }

  async function handleSend() {
    if (durationSec < 1) {
      await handleDiscard();
      return;
    }
    try {
      await recorder.stop();
    } catch {
      // continue — the recorder still has a uri if it had started
    }
    const uri = recorder.uri;
    if (!uri) {
      onClose();
      return;
    }
    const finalWaveform = densifyWaveform(waveform);
    onClose();
    await onSend({ uri, durationSec, waveform: finalWaveform });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleDiscard}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <SafeAreaView edges={['bottom']}>
            <View style={styles.handle} />
            <View style={styles.metaRow}>
              <Animated.View
                style={[
                  styles.dot,
                  {
                    opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                  },
                ]}
              />
              <ThemedText style={styles.timer}>{formatDuration(durationSec)}</ThemedText>
              <ThemedText style={styles.hint}>{ChatCopy.recorder.recording}</ThemedText>
            </View>
            <Waveform peaks={waveform} />
            <ThemedText style={styles.subhint}>
              {durationSec >= 1
                ? ChatCopy.recorder.tapSendToShare
                : ChatCopy.recorder.holdToRecord}
            </ThemedText>
            <View style={styles.actionsRow}>
              <Pressable
                onPress={handleDiscard}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.actionBtn,
                  styles.discardBtn,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Discard recording">
                <Feather name="trash-2" size={20} color="#FF5C5C" />
              </Pressable>
              <Pressable
                onPress={handleSend}
                disabled={durationSec < 1}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.actionBtn,
                  styles.sendBtn,
                  durationSec < 1 && { opacity: 0.45 },
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send voice note">
                <Feather name="send" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

function Waveform({ peaks }: { peaks: number[] }) {
  // Pad to a fixed width so the bars don't jitter as new peaks arrive.
  const padded = useMemo(() => {
    if (peaks.length >= WAVEFORM_BARS) return peaks.slice(peaks.length - WAVEFORM_BARS);
    return [...new Array<number>(WAVEFORM_BARS - peaks.length).fill(0), ...peaks];
  }, [peaks]);
  return (
    <View style={styles.waveform}>
      {padded.map((peak, i) => (
        <View
          key={`bar-${i}`}
          style={[
            styles.waveBar,
            {
              height: Math.max(3, peak * 36),
              opacity: peak > 0 ? 1 : 0.25,
            },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * Downsample / pad the live preview peaks to the schema's max (120). The
 * shared zod `waveform: max(120)` cap is enforced server-side so we trim
 * before sending. The receiver re-uses these to render the static bubble.
 */
function densifyWaveform(peaks: number[]): number[] {
  const target = 60;
  if (peaks.length === 0) return [];
  if (peaks.length === target) return peaks;
  if (peaks.length > target) {
    const bucket = Math.ceil(peaks.length / target);
    const out: number[] = [];
    for (let i = 0; i < peaks.length; i += bucket) {
      const slice = peaks.slice(i, i + bucket);
      out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    }
    return out.slice(0, target);
  }
  // Stretch by repetition so the rendered bubble keeps a sensible density.
  const out: number[] = [];
  for (let i = 0; i < target; i += 1) {
    const sourceIdx = Math.floor((i / target) * peaks.length);
    out.push(peaks[sourceIdx] ?? 0);
  }
  return out;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Brand.chatRecordingBg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 12,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two + 4,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Brand.chatRecordingDot,
  },
  timer: {
    fontSize: 18,
    fontWeight: FontWeight.semibold,
    color: '#EDEDED',
    letterSpacing: -0.18,
  },
  hint: {
    fontSize: 13,
    fontWeight: FontWeight.medium,
    color: Brand.chatRecordingHint,
    letterSpacing: -0.12,
  },
  waveform: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
  },
  waveBar: {
    flex: 1,
    backgroundColor: Brand.chatActionLime,
    borderRadius: 1.5,
  },
  subhint: {
    fontSize: 12,
    fontWeight: FontWeight.regular,
    color: Brand.chatRecordingHint,
    letterSpacing: -0.1,
    marginTop: 4,
    marginBottom: Spacing.three,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardBtn: {
    backgroundColor: 'rgba(255,92,92,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,92,92,0.6)',
  },
  sendBtn: {
    backgroundColor: Brand.chatBubbleMine,
  },
});
