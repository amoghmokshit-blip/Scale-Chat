import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Brand, FontWeight } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { formatBubbleTime } from '@/lib/format-time';

import type { ImageMessage } from '../types';
import { ImageViewer } from './image-viewer';

type Props = {
  message: ImageMessage;
  isMine: boolean;
  /** Long-press → action sheet, owned by the parent screen. */
  onLongPress?: (m: ImageMessage) => void;
};

/** Bubble width budget — keeps the image at a reasonable size on small phones. */
const MAX_W = 240;
/** Bubble height budget — prevents very tall portraits from dominating the screen. */
const MAX_H = 320;

/**
 * Image message bubble — renders an `expo-image` sized to the intrinsic aspect
 * ratio of the image (so the layout doesn't shift when the image finishes
 * downloading). Tap → full-screen `ImageViewer` with pinch-zoom. Long-press →
 * the parent's action sheet (Reply / Delete).
 *
 * Upload progress: when the message status is `uploading`, the bubble shows a
 * dim overlay with a spinner. We don't show a percentage because the upload
 * goes straight to R2 over a single HTTP PUT — no granular progress events
 * unless we wrap `FileSystem.createUploadTask` (deferred — typically images
 * upload in under a second on mobile networks).
 */
export function ImageBubble({ message, isMine, onLongPress }: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);

  const { width, height } = boxFor(message.width, message.height);
  const uploading = message.status === 'uploading';
  const failed = message.status === 'failed';

  return (
    <>
      <Pressable
        onPress={() => {
          if (uploading || failed || !message.mediaUrl) return;
          setViewerOpen(true);
        }}
        onLongPress={() => onLongPress?.(message)}
        delayLongPress={250}
        accessibilityRole="imagebutton"
        accessibilityLabel="Image message">
        <View style={[styles.bubble, { width, height }]}>
          <Image
            source={message.mediaUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={120}
          />
          {uploading ? (
            <View style={styles.overlay}>
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : null}
          {failed ? (
            <View style={styles.overlay}>
              <Feather name="alert-circle" size={28} color="#FF5C5C" />
              <ThemedText style={styles.failedLabel}>Failed</ThemedText>
            </View>
          ) : null}
          <View style={[styles.metaPill, isMine ? styles.metaPillMine : styles.metaPillTheirs]}>
            <ThemedText style={styles.metaText}>{formatBubbleTime(message.createdAt)}</ThemedText>
          </View>
        </View>
      </Pressable>

      <ImageViewer
        visible={viewerOpen}
        uri={message.mediaUrl}
        onClose={() => setViewerOpen(false)}
        timestamp={message.createdAt}
      />
    </>
  );
}

/** Compute the bubble box that fits within MAX_W × MAX_H preserving aspect. */
function boxFor(w: number, h: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: MAX_W, height: MAX_W };
  const ratio = w / h;
  // Try fitting to the max-width budget first; if the resulting height exceeds
  // the max-height budget, fall back to height-anchored sizing.
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
