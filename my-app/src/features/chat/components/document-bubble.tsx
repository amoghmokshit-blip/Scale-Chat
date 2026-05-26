import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight } from '@/constants/theme';
import { formatFileSize } from '@/lib/format-size';

import { ChatCopy } from '../copy';
import type { DocumentMessage } from '../types';

type Props = {
  message: DocumentMessage;
  isMine: boolean;
};

/**
 * Document message — a row (icon + filename + size) rendered INSIDE the
 * standard chat bubble (the parent `MessageBubble` wraps it), so it inherits
 * the reply-quote / forwarded-label / pin-pip / ticks / reactions chrome.
 * Tap opens the file in an in-app browser (`expo-web-browser`, already a dep)
 * — gated on a durable status so we never try to open a local `file://` URI
 * mid-upload.
 */
export function DocumentBubble({ message, isMine }: Props) {
  const uploading = message.status === 'uploading';
  const failed = message.status === 'failed';
  const canOpen =
    !uploading && !failed && message.mediaUrl.length > 0 && message.mediaUrl.startsWith('http');

  const accent = isMine ? 'rgba(255,255,255,0.92)' : Brand.chatHeaderTop;
  const nameColor = isMine ? Brand.chatBubbleMineText : Brand.chatBubbleTheirsText;
  const subColor = isMine ? 'rgba(255,255,255,0.7)' : '#5C6068';

  return (
    <Pressable
      onPress={() => {
        if (canOpen) void WebBrowser.openBrowserAsync(message.mediaUrl);
      }}
      disabled={!canOpen}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`Document ${message.fileName}`}>
      <View style={[styles.iconWrap, { backgroundColor: isMine ? 'rgba(255,255,255,0.15)' : 'rgba(69,82,228,0.1)' }]}>
        {uploading ? (
          <ActivityIndicator color={accent} />
        ) : (
          <Feather name={failed ? 'alert-circle' : 'file-text'} size={22} color={failed ? '#FF5C5C' : accent} />
        )}
      </View>
      <View style={styles.meta}>
        <ThemedText style={[styles.name, { color: nameColor }]} numberOfLines={2}>
          {message.fileName || ChatCopy.media.documentFallbackName}
        </ThemedText>
        <ThemedText style={[styles.size, { color: subColor }]}>
          {failed ? 'Upload failed' : formatFileSize(message.sizeBytes)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 180,
    maxWidth: 260,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.14,
  },
  size: {
    fontSize: 11,
    fontWeight: FontWeight.regular,
  },
});
