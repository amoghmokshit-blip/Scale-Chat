import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
import { ComingSoonSheet } from '@/features/chat/components/coming-soon-sheet';
import { Composer } from '@/features/chat/components/composer';
import { DayDivider } from '@/features/chat/components/day-divider';
import { EmojiPickerModal } from '@/features/chat/components/emoji-picker-modal';
import {
  MessageActionSheet,
  copyMessageText,
} from '@/features/chat/components/message-action-sheet';
import { MessageBubble } from '@/features/chat/components/message-bubble';
import { MessageReportSheet } from '@/features/chat/components/message-report-sheet';
import { MutePickerSheet } from '@/features/chat/components/mute-picker-sheet';
import { PerChatOptionsSheet } from '@/features/chat/components/per-chat-options-sheet';
import { VoiceRecorderOverlay } from '@/features/chat/components/voice-recorder-overlay';
import { ChatCopy } from '@/features/chat/copy';
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  MAX_PINNED_PER_CHAT,
  VIDEO_CONTENT_TYPES,
  VIDEO_MAX_BYTES,
} from '@scalechat/shared';

import { useThread } from '@/features/chat/hooks/use-thread';
import { chatRepository } from '@/features/chat/data';
import { ApiError } from '@/lib/api-client';
import { formatDayLabel } from '@/lib/format-time';
import { truncateFileName, validateMediaPick } from '@/lib/media-pick';

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
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const {
    thread,
    messages,
    send,
    sendImage,
    sendVoice,
    sendDocument,
    sendVideo,
    sendLocation,
    loading,
    loadOlder,
    loadingOlder,
    hasMoreOlder,
    replyTo,
    replyingTo,
    deleteMessage,
    reportMessage,
    notifyTyping,
    peerTyping,
    peerPresence,
  } = useThread(id);
  const listRef = useRef<FlatList<ListItem>>(null);

  const [sheetMessage, setSheetMessage] = useState<Message | null>(null);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  // Tranche 2.A — full emoji picker. `pickerTargetId` holds the message id the
  // picker reacts to once the user chooses an emoji. We keep this as id (not
  // a Message ref) so the picker survives a cache replay that swaps the row.
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [comingSoonKey, setComingSoonKey] = useState<
    'voiceCall' | 'videoCall' | 'chatTheme' | 'exportChat' | 'search' | 'starred' | null
  >(null);
  // Phase C state. Initial mute / block state isn't yet plumbed through
  // `ChatDetailDto`; the screen defaults to false and flips on user action.
  // Plumbing the initial state lands when Phase E (push) needs to read it.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [mutePickerOpen, setMutePickerOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

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
        onToggleReaction={(emoji) => void handleTogglePill(item.message, emoji)}
      />
    );
  };

  // ─── Tranche 2.A reactions handlers ───────────────────────────────────────
  // Quick-react from the strip in MessageActionSheet. Adds the emoji to the
  // message; the strip closes the action sheet on its own. If the viewer
  // already has another emoji on this message, the server replaces it via
  // the `(messageId, userId, emoji)` unique — but we don't surface the
  // pre-state in the optimistic path because reactions are idempotent + the
  // socket broadcast reconciles in <50ms anyway.
  async function handleQuickReact(emoji: string) {
    const target = sheetMessage;
    if (!target) return;
    const fn = chatRepository.addReaction;
    if (!fn) return;
    try {
      await fn.call(chatRepository, target.id, emoji);
    } catch {
      Alert.alert('Could not react', 'Please try again.');
    }
  }

  // Pill-row tap. If the viewer already reacted with this emoji → remove; else add.
  async function handleTogglePill(target: Message, emoji: string) {
    const reactedByMe = target.reactions?.some(
      (r) => r.emoji === emoji && r.reactedByMe,
    );
    const fn = reactedByMe ? chatRepository.removeReaction : chatRepository.addReaction;
    if (!fn) return;
    try {
      await fn.call(chatRepository, target.id, emoji);
    } catch {
      Alert.alert('Could not update reaction', 'Please try again.');
    }
  }

  // Picker → add the chosen emoji to whichever message had its strip open.
  async function handlePickerSelect(emoji: string) {
    const id = pickerTargetId;
    if (!id) return;
    const fn = chatRepository.addReaction;
    if (!fn) return;
    try {
      await fn.call(chatRepository, id, emoji);
    } catch {
      Alert.alert('Could not react', 'Please try again.');
    }
  }

  // ─── Phase C action handlers ──────────────────────────────────────────────
  async function handleMute(until: Date | null) {
    if (!id) return;
    const fn = chatRepository.muteChat;
    if (!fn) return;
    try {
      const res = await fn.call(chatRepository, id, until);
      setIsMuted(res.mutedUntil !== null);
    } catch {
      Alert.alert('Could not update notifications', 'Please try again.');
    }
  }

  async function handleClearChat() {
    if (!id) return;
    const fn = chatRepository.clearChat;
    if (!fn) return;
    try {
      await fn.call(chatRepository, id);
    } catch {
      Alert.alert('Could not clear chat', 'Please try again.');
    }
  }

  async function handleBlock() {
    if (!thread) return;
    const fn = chatRepository.blockUser;
    if (!fn) return;
    try {
      await fn.call(chatRepository, thread.counterpart.id);
      setIsBlocked(true);
    } catch {
      Alert.alert('Could not block', 'Please try again.');
    }
  }

  async function handleUnblock() {
    if (!thread) return;
    const fn = chatRepository.unblockUser;
    if (!fn) return;
    try {
      await fn.call(chatRepository, thread.counterpart.id);
      setIsBlocked(false);
    } catch {
      Alert.alert('Could not unblock', 'Please try again.');
    }
  }

  function handleForward() {
    // Close the action sheet BEFORE navigating — stacking the forward modal on
    // top of the still-open action-sheet Modal flickers on Android. Capture the
    // target first since closing the sheet nulls `sheetMessage`.
    const m = sheetMessage;
    setSheetMessage(null);
    if (m && id) {
      router.push({ pathname: '/chat/forward', params: { messageId: m.id, fromThreadId: id } });
    }
  }

  async function handlePin() {
    const m = sheetMessage;
    setSheetMessage(null);
    if (!m || !id) return;
    const fn = chatRepository.pinMessage;
    if (!fn) return;
    try {
      await fn.call(chatRepository, id, m.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'pin_cap_exceeded') {
        Alert.alert(ChatCopy.pin.capTitle, ChatCopy.pin.capBody(MAX_PINNED_PER_CHAT));
      } else {
        Alert.alert(ChatCopy.pin.failTitle, ChatCopy.pin.failBody);
      }
    }
  }

  async function handleUnpin() {
    const m = sheetMessage;
    setSheetMessage(null);
    if (!m || !id) return;
    const fn = chatRepository.unpinMessage;
    if (!fn) return;
    try {
      await fn.call(chatRepository, id, m.id);
    } catch {
      Alert.alert(ChatCopy.pin.failTitle, ChatCopy.pin.failBody);
    }
  }

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
            // Gallery covers photos AND videos (Tranche 2.C); branch on asset.type below.
            mediaTypes: ['images', 'videos'],
            quality: 0.85,
            exif: false,
          });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset || !asset.uri) return;

    if (asset.type === 'video') {
      const check = validateMediaPick(
        { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName, sizeBytes: asset.fileSize },
        { allowedMimes: VIDEO_CONTENT_TYPES, maxBytes: VIDEO_MAX_BYTES },
      );
      if (!check.ok) {
        Alert.alert(ChatCopy.media.cantSendTitle, mediaRejectBody(check.reason, VIDEO_MAX_BYTES));
        return;
      }
      await sendVideo({
        uri: asset.uri,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        // expo-image-picker reports duration in ms; clamp to ≥1s (server requires positive).
        durationSec: Math.max(1, Math.round((asset.duration ?? 0) / 1000)),
        mimeType: check.mimeType,
        sizeBytes: check.sizeBytes,
      });
      return;
    }

    await sendImage({
      uri: asset.uri,
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      contentType: asset.mimeType,
      sizeBytes: asset.fileSize,
    });
  }

  async function handlePickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...DOCUMENT_CONTENT_TYPES],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset || !asset.uri) return;
    const check = validateMediaPick(
      { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.name, sizeBytes: asset.size },
      { allowedMimes: DOCUMENT_CONTENT_TYPES, maxBytes: DOCUMENT_MAX_BYTES },
    );
    if (!check.ok) {
      Alert.alert(ChatCopy.media.cantSendTitle, mediaRejectBody(check.reason, DOCUMENT_MAX_BYTES));
      return;
    }
    await sendDocument({
      uri: asset.uri,
      // Server caps documentTitle at 255 — truncate (preserving extension) to avoid a 400.
      fileName: truncateFileName(asset.name ?? 'document'),
      sizeBytes: check.sizeBytes,
      mimeType: check.mimeType,
    });
  }

  async function handlePickLocation() {
    // Privacy: confirm before reading + sharing precise current GPS (one-tap share is a footgun).
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(ChatCopy.location.confirmTitle, ChatCopy.location.confirmBody, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: ChatCopy.location.confirmCta, onPress: () => resolve(true) },
      ]);
    });
    if (!confirmed) return;

    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Location', ChatCopy.location.permissionDenied);
      return;
    }
    // getCurrentPositionAsync can hang on an AVD with no set location → race a
    // timeout, then fall back to the last-known fix; never freeze the UI.
    let pos: Location.LocationObject | null = null;
    try {
      pos = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        8000,
      );
    } catch {
      pos = await Location.getLastKnownPositionAsync().catch(() => null);
    }
    if (!pos) {
      Alert.alert('Location', ChatCopy.location.unavailable);
      return;
    }
    const { latitude, longitude } = pos.coords;
    let locationName: string | undefined;
    try {
      const places = await Location.reverseGeocodeAsync({ latitude, longitude });
      const p = places[0];
      // Omit (undefined) when blank — the server rejects an empty locationName.
      locationName = (p?.city ?? p?.district ?? p?.name ?? p?.region) || undefined;
    } catch {
      // best-effort — a coords-only card is fine.
    }
    await sendLocation({ latitude, longitude, locationName });
  }

  function handlePickContact() {
    if (!id) return;
    router.push({ pathname: '/chat/pick-contact', params: { threadId: id } });
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
        isMuted={isMuted}
        onVoiceCall={() => setComingSoonKey('voiceCall')}
        onVideoCall={() => setComingSoonKey('videoCall')}
        onOpenProfile={() =>
          router.push({ pathname: '/contact/[id]', params: { id: thread.counterpart.id } })
        }
        onOpenOverflow={() => setOptionsOpen(true)}
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
        onForward={handleForward}
        onPin={handlePin}
        onUnpin={handleUnpin}
        onReport={() => {
          // Open the reason picker after the action sheet closes itself.
          const m = sheetMessage;
          if (m) setReportTarget(m);
        }}
        onReact={(emoji) => void handleQuickReact(emoji)}
        onOpenEmojiPicker={() => {
          // Close the action sheet first so the picker isn't stacked on top of
          // the menu's dim backdrop. Capture the target id since closing the
          // sheet nulls `sheetMessage`.
          const m = sheetMessage;
          if (m) {
            setPickerTargetId(m.id);
            setSheetMessage(null);
          }
        }}
      />

      <EmojiPickerModal
        visible={pickerTargetId !== null}
        onClose={() => setPickerTargetId(null)}
        onSelect={(e) => void handlePickerSelect(e)}
      />

      <MessageReportSheet
        visible={reportTarget !== null}
        counterpartName={thread.counterpart.displayName}
        onClose={() => setReportTarget(null)}
        onSubmit={async (reason) => {
          if (!reportTarget) return;
          await reportMessage(reportTarget.id, reason);
        }}
      />

      <AttachmentSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPickCamera={() => void handlePickImage('camera')}
        onPickGallery={() => void handlePickImage('gallery')}
        onPickDocument={() => void handlePickDocument()}
        onPickContact={handlePickContact}
        onPickLocation={() => void handlePickLocation()}
      />

      <VoiceRecorderOverlay
        visible={recorderOpen}
        onClose={() => setRecorderOpen(false)}
        onSend={(rec) =>
          sendVoice({ uri: rec.uri, durationSec: rec.durationSec, waveform: rec.waveform })
        }
      />

      <ComingSoonSheet
        visible={
          comingSoonKey === 'voiceCall' ||
          comingSoonKey === 'videoCall'
        }
        icon={comingSoonKey === 'videoCall' ? 'video' : 'phone'}
        title={
          comingSoonKey === 'voiceCall'
            ? ChatCopy.comingSoon.voiceCall.title
            : ChatCopy.comingSoon.videoCall.title
        }
        body={
          comingSoonKey === 'voiceCall'
            ? ChatCopy.comingSoon.voiceCall.body
            : ChatCopy.comingSoon.videoCall.body
        }
        footnote={
          comingSoonKey === 'voiceCall'
            ? ChatCopy.comingSoon.voiceCall.footnote
            : comingSoonKey === 'videoCall'
              ? ChatCopy.comingSoon.videoCall.footnote
              : undefined
        }
        onClose={() => setComingSoonKey(null)}
      />

      {/* Phase C — per-chat options + supporting modals */}
      <PerChatOptionsSheet
        visible={optionsOpen}
        counterpartName={thread.counterpart.displayName}
        isMuted={isMuted}
        isBlocked={isBlocked}
        onClose={() => setOptionsOpen(false)}
        onViewContact={() =>
          router.push({ pathname: '/contact/[id]', params: { id: thread.counterpart.id } })
        }
        onSearch={() => setComingSoonKey('search')}
        onMute={() => setMutePickerOpen(true)}
        onUnmute={() => void handleMute(null)}
        onStarred={() => setComingSoonKey('starred')}
        onWallpaper={() => setComingSoonKey('chatTheme')}
        onClearChat={() =>
          Alert.alert(
            'Clear this chat?',
            'Messages will be hidden from your view. The other person will still see them.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Clear chat',
                style: 'destructive',
                onPress: () => void handleClearChat(),
              },
            ],
          )
        }
        onExportChat={() => setComingSoonKey('exportChat')}
        onBlock={() =>
          Alert.alert(
            `Block ${thread.counterpart.displayName}?`,
            'They will no longer be able to message you in this chat, and you can\'t message them. Existing messages stay.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Block',
                style: 'destructive',
                onPress: () => void handleBlock(),
              },
            ],
          )
        }
        onUnblock={() => void handleUnblock()}
      />

      <MutePickerSheet
        visible={mutePickerOpen}
        counterpartName={thread.counterpart.displayName}
        onClose={() => setMutePickerOpen(false)}
        onPick={(until) => void handleMute(until)}
      />

      <ComingSoonSheet
        visible={comingSoonKey === 'chatTheme'}
        icon="droplet"
        title={ChatCopy.comingSoon.chatTheme.title}
        body={ChatCopy.comingSoon.chatTheme.body}
        onClose={() => setComingSoonKey(null)}
      />

      <ComingSoonSheet
        visible={comingSoonKey === 'exportChat'}
        icon="share"
        title={ChatCopy.comingSoon.exportChat.title}
        body={ChatCopy.comingSoon.exportChat.body}
        onClose={() => setComingSoonKey(null)}
      />

      <ComingSoonSheet
        visible={comingSoonKey === 'search'}
        icon="search"
        title="Search in chat coming soon"
        body="In-thread search lands with Phase D — you'll be able to jump to any message by keyword."
        onClose={() => setComingSoonKey(null)}
      />

      <ComingSoonSheet
        visible={comingSoonKey === 'starred'}
        icon="star"
        title="Starred messages coming soon"
        body="You'll soon be able to star any message and find it again here."
        onClose={() => setComingSoonKey(null)}
      />
    </View>
  );
}


/** Race a promise against a timeout (ms) — used so `getCurrentPositionAsync`
 *  can't hang the UI on an emulator with no location fix (Tranche 2.D). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** Friendly Alert body for a rejected media pick (Tranche 2.C guard). */
function mediaRejectBody(reason: 'unsupported_type' | 'empty' | 'too_large', maxBytes: number): string {
  if (reason === 'too_large') return ChatCopy.media.tooLarge(Math.round(maxBytes / (1024 * 1024)));
  if (reason === 'empty') return ChatCopy.media.empty;
  return ChatCopy.media.unsupportedType;
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
