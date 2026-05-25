import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Spacing } from '@/constants/theme';
import { formatBubbleTime, formatDuration } from '@/lib/format-time';

import type { Message } from '../types';
import { ImageBubble } from './image-bubble';
import { ReactionsPillRow } from './reactions-pill-row';
import { VoicePlayer } from './voice-player';

type Props = {
  message: Message;
  isMine: boolean;
  /** When true, draw a tail at the bottom corner (last in a streak). */
  hasTail?: boolean;
  /** Optional source message this bubble replies to (for the inline quote). */
  replyTarget?: Message | null;
  /** Counterpart display name — used as the "From: ..." label in reply quotes. */
  counterpartName?: string;
  /** Long-press tap → open action sheet. */
  onLongPress?: (m: Message) => void;
  /**
   * Tap a reaction pill — toggles the viewer's own reaction (adds if not
   * already reacted with that emoji, removes if `reactedByMe`). Tranche 2.A.
   */
  onToggleReaction?: (emoji: string) => void;
};

/**
 * Message bubble — Figma 1:2972.
 *
 * Variants handled here:
 *   - **Text** — plain text content with timestamp + delivery ticks.
 *   - **Voice** — play disc + waveform + duration.
 *   - **Reply** — when `replyTarget` is provided, a quoted preview renders
 *     above the body. Tapping the quote could scroll to the source (left as
 *     a future enhancement; we'd need the FlatList ref + an id→index map).
 *   - **Deleted** — when `message.deletedAt` is set, the bubble shrinks to
 *     a single italic "This message was deleted" line (the server zeroes
 *     content so there's nothing else to render).
 *
 * Long-press on any non-tombstone bubble opens the action sheet wired
 * from the parent screen.
 */
export function MessageBubble({
  message,
  isMine,
  hasTail,
  replyTarget,
  counterpartName,
  onLongPress,
  onToggleReaction,
}: Props) {
  const bg = isMine ? Brand.chatBubbleMine : Brand.chatBubbleTheirs;
  const color = isMine ? Brand.chatBubbleMineText : Brand.chatBubbleTheirsText;
  const isTombstone = message.deletedAt != null;

  // Image bubbles render the image as the entire bubble surface — no rounded
  // chat-bubble background underneath, no reply quote inside (we render the
  // quote inline above the image for IMAGE messages to keep the layout clean).
  if (message.type === 'image' && !isTombstone) {
    return (
      <View style={[styles.outer, { alignItems: isMine ? 'flex-end' : 'flex-start' }]}>
        {replyTarget ? (
          <View
            style={[
              styles.imageReplyQuote,
              { borderLeftColor: isMine ? Brand.chatBubbleMine : Brand.chatHeaderTop },
            ]}>
            <ThemedText style={styles.imageReplyAuthor} numberOfLines={1}>
              {replyTarget.senderId === 'me' ? 'You' : counterpartName ?? 'Them'}
            </ThemedText>
            <ThemedText style={styles.imageReplyBody} numberOfLines={1}>
              {replyPreview(replyTarget)}
            </ThemedText>
          </View>
        ) : null}
        <ImageBubble message={message} isMine={isMine} onLongPress={onLongPress as never} />
        <View
          style={[
            styles.metaRow,
            isMine ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' },
          ]}>
          {isMine ? <DeliveryTicks status={message.status} /> : null}
          <ThemedText style={styles.meta}>{formatBubbleTime(message.createdAt)}</ThemedText>
        </View>
        <ReactionsPillRow
          reactions={message.reactions}
          isMine={isMine}
          onToggle={(e) => onToggleReaction?.(e)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.outer, { alignItems: isMine ? 'flex-end' : 'flex-start' }]}>
      <Pressable
        onLongPress={() => {
          if (isTombstone) return;
          onLongPress?.(message);
        }}
        delayLongPress={250}
        accessibilityRole="button"
        accessibilityHint="Long press for message actions"
        style={({ pressed }: { pressed: boolean }) => [
          styles.bubble,
          isMine ? styles.bubbleMine : styles.bubbleTheirs,
          {
            backgroundColor: bg,
            borderBottomRightRadius: isMine && hasTail ? 4 : 22,
            borderBottomLeftRadius: !isMine && hasTail ? 4 : 22,
          },
          isTombstone && styles.bubbleTombstone,
          pressed && { opacity: 0.92 },
        ]}>
        {/* Reply quote — appears above the body when this message replies to another. */}
        {replyTarget && !isTombstone ? (
          <View
            style={[
              styles.replyQuote,
              { borderLeftColor: isMine ? 'rgba(255,255,255,0.55)' : Brand.chatHeaderTop },
            ]}>
            <ThemedText
              style={[
                styles.replyAuthor,
                { color: isMine ? 'rgba(255,255,255,0.85)' : Brand.chatHeaderTop },
              ]}
              numberOfLines={1}>
              {replyTarget.senderId === 'me' ? 'You' : counterpartName ?? 'Them'}
            </ThemedText>
            <ThemedText
              style={[
                styles.replyBody,
                { color: isMine ? 'rgba(255,255,255,0.75)' : '#5C6068' },
              ]}
              numberOfLines={2}>
              {replyPreview(replyTarget)}
            </ThemedText>
          </View>
        ) : null}

        {isTombstone ? (
          <View style={styles.tombstoneRow}>
            <Feather
              name="slash"
              size={12}
              color={isMine ? 'rgba(255,255,255,0.7)' : '#7A7E86'}
            />
            <ThemedText
              style={[
                styles.tombstoneText,
                { color: isMine ? 'rgba(255,255,255,0.75)' : '#7A7E86' },
              ]}>
              This message was deleted
            </ThemedText>
          </View>
        ) : message.type === 'text' ? (
          <ThemedText style={[styles.text, { color }]}>{message.text}</ThemedText>
        ) : message.type === 'voice' ? (
          <VoicePlayer message={message} isMine={isMine} />
        ) : null}
      </Pressable>
      <View
        style={[
          styles.metaRow,
          isMine ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' },
        ]}>
        {isMine && !isTombstone ? <DeliveryTicks status={message.status} /> : null}
        <ThemedText style={styles.meta}>{formatBubbleTime(message.createdAt)}</ThemedText>
      </View>
      {!isTombstone ? (
        <ReactionsPillRow
          reactions={message.reactions}
          isMine={isMine}
          onToggle={(e) => onToggleReaction?.(e)}
        />
      ) : null}
    </View>
  );
}

/** Single-line preview shown inside a reply quote — depends on source kind. */
function replyPreview(replyTarget: Message): string {
  if (replyTarget.deletedAt) return 'This message was deleted';
  if (replyTarget.type === 'text') return replyTarget.text;
  if (replyTarget.type === 'voice') {
    return `🎤 Voice note · ${formatDuration(replyTarget.durationSec)}`;
  }
  return '📷 Photo';
}

function DeliveryTicks({ status }: { status: Message['status'] }) {
  if (status === 'uploading' || status === 'sending') {
    return (
      <Feather name="clock" size={11} color={Brand.chatTimestamp} style={styles.tickIcon} />
    );
  }
  if (status === 'failed') {
    return (
      <Feather name="alert-circle" size={11} color="#FF5C5C" style={styles.tickIcon} />
    );
  }
  const color = status === 'read' ? Brand.chatReadTick : Brand.chatTimestamp;
  if (status === 'sent') {
    return <Feather name="check" size={11} color={color} style={styles.tickIcon} />;
  }
  return (
    <View style={styles.doubleTick}>
      <Feather name="check" size={11} color={color} style={{ marginRight: -5 }} />
      <Feather name="check" size={11} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: Spacing.three + 2,
    marginBottom: 6,
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bubbleMine: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  bubbleTheirs: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  bubbleTombstone: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  text: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.14,
  },
  tombstoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tombstoneText: {
    fontSize: 13,
    fontStyle: 'italic',
    fontWeight: FontWeight.regular,
  },
  replyQuote: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 2,
    marginBottom: 6,
    maxWidth: '100%',
  },
  replyAuthor: {
    fontSize: 12,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.1,
  },
  replyBody: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: FontWeight.regular,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 6,
  },
  meta: {
    fontSize: 10,
    fontWeight: FontWeight.regular,
    color: Brand.chatTimestamp,
    letterSpacing: -0.1,
  },
  tickIcon: {
    marginRight: 4,
  },
  doubleTick: {
    flexDirection: 'row',
    marginRight: 4,
  },
  // Image-bubble reply quote — sits above the image since the image itself
  // fills the whole bubble surface.
  imageReplyQuote: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 2,
    marginBottom: 4,
    maxWidth: 240,
  },
  imageReplyAuthor: {
    fontSize: 12,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.1,
    color: '#979797',
  },
  imageReplyBody: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: FontWeight.regular,
    color: '#979797',
  },
});
