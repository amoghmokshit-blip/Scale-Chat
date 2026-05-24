import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';
import { AttachmentSheet } from '@/features/chat/components/attachment-sheet';
import { ChatHeader } from '@/features/chat/components/chat-header';
import { Composer } from '@/features/chat/components/composer';
import { DayDivider } from '@/features/chat/components/day-divider';
import {
  MessageActionSheet,
  copyMessageText,
} from '@/features/chat/components/message-action-sheet';
import { MessageBubble } from '@/features/chat/components/message-bubble';
import { VoiceRecorderOverlay } from '@/features/chat/components/voice-recorder-overlay';
import { useThread } from '@/features/chat/hooks/use-thread';
import { chatRepository } from '@/features/chat/data';
import { formatDayLabel } from '@/lib/format-time';

import type { Message } from '@/features/chat/types';

type ListItem =
  | { kind: 'divider'; id: string; label: string }
  | {
      kind: 'message';
      id: string;
      message: Message;
      isMine: boolean;
      hasTail: boolean;
      replyTarget: Message | null;
    };

/**
 * 1-on-1 chat thread screen — Figma "Chat Page" (1:2972) + WhatsApp-style
 * features:
 *   - Live presence + typing indicator in the header
 *   - Long-press bubble → action sheet (Reply / Copy / Delete for everyone)
 *   - Reply preview banner above the composer
 *   - Quoted-reply preview inside the bubble that's a reply
 *   - Soft-deleted messages render as "This message was deleted" tombstones
 *
 * All cache state lives in the api repo; this screen just reads it and
 * dispatches user intents back through the `useThread` hook.
 */
export default function ChatThreadScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const {
    thread,
    messages,
    send,
    sendImage,
    sendVoice,
    loading,
    loadOlder,
    loadingOlder,
    hasMoreOlder,
    replyTo,
    replyingTo,
    deleteMessage,
    notifyTyping,
    peerTyping,
    peerPresence,
  } = useThread(id);
  const listRef = useRef<FlatList<ListItem>>(null);

  const [sheetMessage, setSheetMessage] = useState<Message | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);

  // Index id → message so each reply bubble can look up its source O(1).
  const byId = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const items = useMemo<ListItem[]>(() => groupForRender(messages, byId), [messages, byId]);

  useFocusEffect(
    useCallback(() => {
      if (id) chatRepository.markThreadRead(id);
    }, [id])
  );

  const renderItem: ListRenderItem<ListItem> = ({ item }) => {
    if (item.kind === 'divider') return <DayDivider label={item.label} />;
    return (
      <MessageBubble
        message={item.message}
        isMine={item.isMine}
        hasTail={item.hasTail}
        replyTarget={item.replyTarget}
        counterpartName={thread?.counterpart.displayName}
        onLongPress={setSheetMessage}
      />
    );
  };

  async function handleDelete() {
    if (!sheetMessage) return;
    try {
      await deleteMessage(sheetMessage.id);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const code = (err as { code?: string })?.code;
      const message =
        code === 'edit_window_passed'
          ? 'You can only delete a message within 60 minutes of sending.'
          : code === 'not_sender'
            ? 'Only the sender can delete a message.'
            : 'Could not delete the message. Try again.';
      Alert.alert('Delete failed', message);
      void status;
    }
  }

  async function handlePickImage(source: 'camera' | 'gallery') {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        source === 'camera' ? 'Camera permission required' : 'Photos permission required',
        'You can enable it in Settings to share photos in chats.',
      );
      return;
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 0.85,
            exif: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.85,
            exif: false,
          });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset || !asset.uri) return;
    await sendImage({
      uri: asset.uri,
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      contentType: asset.mimeType,
      sizeBytes: asset.fileSize,
    });
  }

  if (loading || !thread) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={Brand.chatHeaderTop} />
        <View style={styles.loading}>
          <ThemedText style={styles.loadingText}>Loading conversation…</ThemedText>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Brand.chatHeaderTop} />
      <ChatHeader
        counterpart={thread.counterpart}
        isOnline={peerPresence.isOnline}
        lastSeenAt={peerPresence.lastSeenAt}
        isPeerTyping={peerTyping}
      />
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}>
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          onScroll={(e) => {
            if (e.nativeEvent.contentOffset.y < 80 && hasMoreOlder && !loadingOlder) {
              void loadOlder();
            }
          }}
          scrollEventThrottle={64}
        />
        <Composer
          onSend={send}
          onTyping={notifyTyping}
          onAttach={() => setAttachOpen(true)}
          onVoice={() => setRecorderOpen(true)}
          replyingTo={replyingTo}
          counterpartName={thread.counterpart.displayName}
          onCancelReply={() => replyTo(null)}
        />
      </KeyboardAvoidingView>

      <MessageActionSheet
        visible={sheetMessage !== null}
        message={sheetMessage}
        isMine={sheetMessage?.senderId === 'me'}
        onClose={() => setSheetMessage(null)}
        onReply={() => {
          if (sheetMessage) replyTo(sheetMessage);
        }}
        onCopy={() => {
          if (sheetMessage) void copyMessageText(sheetMessage);
        }}
        onDelete={handleDelete}
      />

      <AttachmentSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPickCamera={() => void handlePickImage('camera')}
        onPickGallery={() => void handlePickImage('gallery')}
      />

      <VoiceRecorderOverlay
        visible={recorderOpen}
        onClose={() => setRecorderOpen(false)}
        onSend={(rec) =>
          sendVoice({ uri: rec.uri, durationSec: rec.durationSec, waveform: rec.waveform })
        }
      />
    </View>
  );
}

function groupForRender(messages: Message[], byId: Map<string, Message>): ListItem[] {
  const out: ListItem[] = [];
  let lastDay = '';
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]!;
    const label = formatDayLabel(m.createdAt);
    if (label !== lastDay) {
      out.push({ kind: 'divider', id: `d-${label}-${i}`, label });
      lastDay = label;
    }
    const next = messages[i + 1];
    const hasTail = !next || next.senderId !== m.senderId;
    out.push({
      kind: 'message',
      id: m.id,
      message: m,
      isMine: m.senderId === 'me',
      hasTail,
      replyTarget: m.replyToMessageId ? byId.get(m.replyToMessageId) ?? null : null,
    });
  }
  return out;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Brand.chatBody,
  },
  body: {
    flex: 1,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#979797',
  },
});
