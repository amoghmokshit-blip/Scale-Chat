import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Spacing } from '@/constants/theme';
import { formatBubbleTime, formatDuration } from '@/lib/format-time';

import { ChatCopy } from '../copy';
import type { Message } from '../types';
import { ContactCard } from './contact-card';
import { DocumentBubble } from './document-bubble';
import { ImageBubble } from './image-bubble';
import { LocationCard } from './location-card';
import { PollBubble } from './poll-bubble';
import { ReactionsPillRow } from './reactions-pill-row';
import { VideoBubble } from './video-bubble';
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
  /**
   * Tap a poll option — fires with the FULL post-tap selection set so the
   * caller can authoritative-diff (Tranche 2.F). Caller passes the message id
   * up so the screen can route to `votePoll(messageId, optionIds)`.
   */
  onVotePoll?: (messageId: string, optionIds: string[]) => void;
  /**
   * Optional per-chat theme overrides (P2-Theme). When omitted, the bubble
   * falls back to `Brand.chatBubbleMine` / `Brand.chatBubbleTheirs` so
   * non-themed usage is unchanged.
   */
  bubbleColorMine?: string;
  bubbleColorTheirs?: string;
  textColorMine?: string;
  textColorTheirs?: string;
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
  onVotePoll,
  bubbleColorMine,
  bubbleColorTheirs,
  textColorMine,
  textColorTheirs,
}: Props) {
  const bg = isMine
    ? (bubbleColorMine ?? Brand.chatBubbleMine)
    : (bubbleColorTheirs ?? Brand.chatBubbleTheirs);
  const color = isMine
    ? (textColorMine ?? Brand.chatBubbleMineText)
    : (textColorTheirs ?? Brand.chatBubbleTheirsText);
  const isTombstone = message.deletedAt != null;
  // Pin pip shows only on a live, pinned message — never on a tombstone
  // (pin-then-delete leaves `pinnedAt` set, but a deleted message shouldn't
  // advertise a pin).
  const isPinned = message.pinnedAt != null && !isTombstone;

  // Call log (Tranche 2.I) — a centered system pill, not a left/right bubble.
  if (message.type === 'call_event') {
    const lower = message.text.toLowerCase();
    const missed = lower.includes('missed') || lower.includes('declined');
    return (
      <View style={styles.callEventRow}>
        <View style={styles.callEventPill}>
          <Feather
            name={message.callKind === 'VIDEO' ? 'video' : missed ? 'phone-missed' : 'phone'}
            size={13}
            color={missed ? '#E5677B' : Brand.chatActionLime}
          />
          <ThemedText style={styles.callEventText}>{message.text}</ThemedText>
          <ThemedText style={styles.callEventTime}>{formatBubbleTime(message.createdAt)}</ThemedText>
        </View>
      </View>
    );
  }

  // Image + video bubbles render the media as the entire bubble surface — no
  // rounded chat-bubble background underneath; the reply quote renders inline
  // above the media to keep the layout clean. (Video reuses this branch's
  // chrome; the tile itself is `VideoBubble`.)
  if ((message.type === 'image' || message.type === 'video') && !isTombstone) {
    return (
      <View style={[styles.outer, { alignItems: isMine ? 'flex-end' : 'flex-start' }]}>
        {message.forwardedFromMessageId ? <ForwardedLabel color="#979797" /> : null}
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
        {message.type === 'video' ? (
          <VideoBubble message={message} isMine={isMine} onLongPress={onLongPress as never} />
        ) : (
          <ImageBubble message={message} isMine={isMine} onLongPress={onLongPress as never} />
        )}
        <View
          style={[
            styles.metaRow,
            isMine ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' },
          ]}>
          {!isMine && isPinned ? <PinPip /> : null}
          {isMine ? <DeliveryTicks status={message.status} /> : null}
          <ThemedText style={styles.meta}>{formatBubbleTime(message.createdAt)}</ThemedText>
          {isMine && isPinned ? <PinPip /> : null}
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
        {/* Forwarded label — appears above the body (and any reply quote) when
            this message is a forwarded copy. Colour forks per bubble side for
            contrast against the purple (mine) / cream (theirs) surfaces. */}
        {message.forwardedFromMessageId && !isTombstone ? (
          <ForwardedLabel color={isMine ? 'rgba(255,255,255,0.7)' : Brand.chatHeaderTop} />
        ) : null}
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
        ) : message.type === 'document' ? (
          <DocumentBubble message={message} isMine={isMine} />
        ) : message.type === 'location' ? (
          <LocationCard message={message} isMine={isMine} />
        ) : message.type === 'contact' ? (
          <ContactCard message={message} isMine={isMine} />
        ) : message.type === 'poll' ? (
          <PollBubble
            message={message}
            isMine={isMine}
            onVote={(optionIds) => onVotePoll?.(message.id, optionIds)}
          />
        ) : null}
      </Pressable>
      <View
        style={[
          styles.metaRow,
          isMine ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' },
        ]}>
        {!isMine && isPinned ? <PinPip /> : null}
        {isMine && !isTombstone ? <DeliveryTicks status={message.status} /> : null}
        <ThemedText style={styles.meta}>{formatBubbleTime(message.createdAt)}</ThemedText>
        {isMine && isPinned ? <PinPip /> : null}
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

/** "↪ Forwarded" label rendered above a forwarded message's body. The colour
 *  is supplied by the caller so it can fork per bubble side / per branch. */
function ForwardedLabel({ color }: { color: string }) {
  return (
    <View style={styles.forwardedRow}>
      <Feather name="corner-up-right" size={11} color={color} />
      <ThemedText style={[styles.forwardedText, { color }]}>
        {ChatCopy.forward.label}
      </ThemedText>
    </View>
  );
}

/** Small pin marker in the meta row when a message is pinned. Grey (NOT lime —
 *  lime would collide with the lime read double-tick sitting in the same row).
 *  Placed away from the ticks (leading on theirs, trailing on mine). */
function PinPip() {
  return <Feather name="bookmark" size={11} color={Brand.chatTimestamp} style={styles.pinPip} />;
}

/** Single-line preview shown inside a reply quote — depends on source kind. */
function replyPreview(replyTarget: Message): string {
  if (replyTarget.deletedAt) return 'This message was deleted';
  if (replyTarget.type === 'text') return replyTarget.text;
  if (replyTarget.type === 'voice') {
    return `🎤 Voice note · ${formatDuration(replyTarget.durationSec)}`;
  }
  if (replyTarget.type === 'document') {
    return `📄 ${replyTarget.fileName || ChatCopy.media.documentLabel}`;
  }
  if (replyTarget.type === 'video') {
    return `📹 ${ChatCopy.media.videoLabel}`;
  }
  if (replyTarget.type === 'location') {
    return `📍 ${replyTarget.locationName || ChatCopy.location.bubbleFallback}`;
  }
  if (replyTarget.type === 'contact') {
    return `👤 ${replyTarget.contactName || ChatCopy.contact.bubbleFallback}`;
  }
  if (replyTarget.type === 'poll') {
    return `📊 ${replyTarget.question || ChatCopy.poll.composerTitle}`;
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
  callEventRow: {
    alignItems: 'center',
    marginVertical: 6,
    paddingHorizontal: Spacing.three,
  },
  callEventPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Brand.chatDayPill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  callEventText: {
    fontSize: 12.5,
    color: '#D8D8D8',
    fontWeight: FontWeight.medium,
  },
  callEventTime: {
    fontSize: 11,
    color: '#8C8C8C',
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
  forwardedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  forwardedText: {
    fontSize: 11,
    fontStyle: 'italic',
    fontWeight: FontWeight.regular,
    letterSpacing: -0.1,
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
  pinPip: {
    marginHorizontal: 3,
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
