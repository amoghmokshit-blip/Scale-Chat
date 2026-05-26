import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator } from 'react-native';

import { formatFileSize } from '@/lib/format-size';

import { ChatCopy } from '../copy';
import type { DocumentMessage } from '../types';
import { cardAccent, InfoCardBubble } from './info-card-bubble';

type Props = {
  message: DocumentMessage;
  isMine: boolean;
};

/**
 * Document message — a row card (icon + filename + size) rendered INSIDE the
 * standard chat bubble, so it inherits the reply/forward/pin/reaction chrome.
 * Tap opens the file in an in-app browser (`expo-web-browser`), gated on a
 * durable status so we never open a local `file://` mid-upload.
 */
export function DocumentBubble({ message, isMine }: Props) {
  const uploading = message.status === 'uploading';
  const failed = message.status === 'failed';
  const canOpen =
    !uploading && !failed && message.mediaUrl.length > 0 && message.mediaUrl.startsWith('http');
  const accent = cardAccent(isMine);

  const leading = uploading ? (
    <ActivityIndicator color={accent} />
  ) : (
    <Feather name={failed ? 'alert-circle' : 'file-text'} size={22} color={failed ? '#FF5C5C' : accent} />
  );

  return (
    <InfoCardBubble
      isMine={isMine}
      leading={leading}
      title={message.fileName || ChatCopy.media.documentFallbackName}
      subtitle={failed ? 'Upload failed' : formatFileSize(message.sizeBytes)}
      subtitleColor={failed ? '#FF5C5C' : undefined}
      onPress={canOpen ? () => void WebBrowser.openBrowserAsync(message.mediaUrl) : undefined}
    />
  );
}
