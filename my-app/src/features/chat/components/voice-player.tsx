import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight } from '@/constants/theme';
import { formatDuration } from '@/lib/format-time';

import type { VoiceMessage } from '../types';

type Props = {
  message: VoiceMessage;
  isMine: boolean;
};

/**
 * Voice note player — replaces the static visual `VoiceBlock` with real
 * playback via `expo-audio.useAudioPlayer`.
 *
 * Layout (Figma 1:2972 voice bubble):
 *   - 32px circular play/pause button on the left
 *   - Waveform bars in the middle that progressively color-fill (lime for the
 *     played portion, muted for the unplayed portion)
 *   - `MM:SS` duration on the right; flips to `current / total` while playing
 *
 * Falls back to a static rendering when `mediaUrl` is missing (e.g. uploading
 * optimistic row) — playback is disabled until the durable mediaUrl arrives.
 */
export function VoicePlayer({ message, isMine }: Props) {
  // Optimistic rows may not have a remote URL yet — `useAudioPlayer` handles
  // a null source by sitting idle, which is the behaviour we want.
  const player = useAudioPlayer(message.mediaUrl ?? null);
  const status = useAudioPlayerStatus(player);

  // Pause when the bubble unmounts so we don't leak background audio.
  useEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        // player may already be releasing — ignore.
      }
    },
    [player]
  );

  const tint = isMine ? '#EDEDED' : Brand.chatHeaderTop;
  const playedTint = Brand.chatVoicePlayed;
  const unplayedTint = isMine ? Brand.chatVoiceUnplayed : 'rgba(67,82,228,0.35)';

  const total = message.durationSec;
  const current = Math.min(total, Math.max(0, status.currentTime ?? 0));
  const progress = total > 0 ? current / total : 0;
  const playing = status.playing && !!message.mediaUrl;
  // `isLoaded` is false while the m4a is still streaming from R2 on first
  // open. Slow Indian connections can make that gap visible — show a spinner
  // in the play button so the bubble doesn't look unresponsive.
  const isLoading = !!message.mediaUrl && status.isLoaded === false;

  function toggle() {
    if (!message.mediaUrl) return;
    if (playing) {
      player.pause();
    } else {
      // Reset to 0 if the previous play finished, so a re-press restarts.
      if (status.didJustFinish || (status.currentTime ?? 0) >= total - 0.1) {
        void player.seekTo(0);
      }
      player.play();
    }
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={toggle}
        disabled={!message.mediaUrl}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
        style={[styles.playBtn, { borderColor: tint }, !message.mediaUrl && { opacity: 0.5 }]}>
        {isLoading ? (
          <ActivityIndicator size="small" color={tint} />
        ) : (
          <Feather
            name={playing ? 'pause' : 'play'}
            size={14}
            color={tint}
            style={!playing ? { marginLeft: 2 } : undefined}
          />
        )}
      </Pressable>
      <View style={styles.waveform}>
        {message.waveform.map((peak, i) => {
          const filled = message.waveform.length > 0 && i / message.waveform.length < progress;
          return (
            <View
              key={`peak-${i}`}
              style={[
                styles.bar,
                {
                  backgroundColor: filled ? playedTint : unplayedTint,
                  height: Math.max(4, peak * 26),
                },
              ]}
            />
          );
        })}
      </View>
      <ThemedText style={[styles.time, { color: tint }]}>
        {playing ? formatDuration(Math.floor(current)) : formatDuration(total)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 220,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveform: {
    flex: 1,
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  bar: {
    width: 2,
    borderRadius: 1,
  },
  time: {
    fontSize: 12,
    fontWeight: FontWeight.medium,
    letterSpacing: -0.12,
  },
});
