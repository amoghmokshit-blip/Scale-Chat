import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight } from '@/constants/theme';
import { formatBubbleTime, formatDuration } from '@/lib/format-time';

import type { VideoMessage } from '../types';
import { VideoViewer } from './video-viewer';

type Props = {
  message: VideoMessage;
  isMine: boolean;
  onLongPress?: (m: VideoMessage) => void;
};

const MAX_W = 240;
const MAX_H = 320;

/**
 * Video message bubble (Tranche 2.C). A polished video TILE — a dark box sized
 * to the video's aspect ratio with a centered play button + duration pill —
 * NOT a live player (the bubble mounts no `expo-video` player, so a thread with
 * many videos doesn't spin up N players; that also sidesteps the player
 * teardown trap). Tap → full-screen `VideoViewer`, which is the only thing that
 * mounts a player, and only while open. Received videos have no poster frame
 * until backend thumbnails ship (deferred); the tile reads as a deliberate
 * video card regardless.
 */
export function VideoBubble({ message, isMine, onLongPress }: Props) {
  const [open, setOpen] = useState(false);
  const { width, height } = boxFor(message.width, message.height);
  const uploading = message.status === 'uploading';
  const failed = message.status === 'failed';
  const canPlay = !uploading && !failed && !!message.mediaUrl && message.mediaUrl.length > 0;

  return (
    <>
      <Pressable
        onPress={() => {
          if (canPlay) setOpen(true);
        }}
        onLongPress={() => onLongPress?.(message)}
        delayLongPress={250}
        accessibilityRole="imagebutton"
        accessibilityLabel="Video message">
        <View style={[styles.bubble, { width, height }]}>
          {uploading ? (
            <View style={styles.overlay}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : failed ? (
            <View style={styles.overlay}>
              <Feather name="alert-circle" size={28} color="#FF5C5C" />
              <ThemedText style={styles.failedLabel}>Failed</ThemedText>
            </View>
          ) : (
            <View style={styles.playWrap}>
              <View style={styles.playBtn}>
                <Feather name="play" size={26} color="#FFFFFF" style={{ marginLeft: 3 }} />
              </View>
            </View>
          )}

          {message.durationSec > 0 ? (
            <View style={styles.durationPill}>
              <Feather name="video" size={10} color="#EDEDED" />
              <ThemedText style={styles.durationText}>{formatDuration(message.durationSec)}</ThemedText>
            </View>
          ) : null}

          <View style={[styles.metaPill, isMine ? styles.metaPillMine : styles.metaPillTheirs]}>
            <ThemedText style={styles.metaText}>{formatBubbleTime(message.createdAt)}</ThemedText>
          </View>
        </View>
      </Pressable>

      {open ? <VideoViewer uri={message.mediaUrl} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Fit within MAX_W × MAX_H preserving aspect (mirrors ImageBubble). */
function boxFor(w: number, h: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: MAX_W, height: Math.round(MAX_W * (9 / 16)) };
  const ratio = w / h;
  const widthFit = { width: MAX_W, height: Math.round(MAX_W / ratio) };
  if (widthFit.height <= MAX_H) return widthFit;
  return { width: Math.round(MAX_H * ratio), height: MAX_H };
}

const styles = StyleSheet.create({
  bubble: {
    backgroundColor: Brand.chatImagePlaceholder,
    borderRadius: 14,
    overflow: 'hidden',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  failedLabel: {
    color: '#FF5C5C',
    fontWeight: FontWeight.semibold,
    fontSize: 13,
    marginTop: 4,
  },
  playWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  durationPill: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  durationText: {
    fontSize: 10,
    fontWeight: FontWeight.medium,
    color: '#EDEDED',
    letterSpacing: -0.1,
  },
  metaPill: {
    position: 'absolute',
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  metaPillMine: { right: 8 },
  metaPillTheirs: { left: 8 },
  metaText: {
    fontSize: 10,
    fontWeight: FontWeight.medium,
    color: '#EDEDED',
    letterSpacing: -0.1,
  },
});
