import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Spacing } from '@/constants/theme';
import { ChatCopy } from '@/features/chat/copy';

import type { Message } from '../types';
import { formatDuration } from '@/lib/format-time';

type Props = {
  onSend: (text: string) => void | Promise<void>;
  onAttach?: () => void;
  onScan?: () => void;
  onVoice?: () => void;
  /** Called on every keystroke for typing indicator emission (the hook rate-limits). */
  onTyping?: () => void;
  /** Optional message we're replying to — shows a dismissable preview banner. */
  replyingTo?: Message | null;
  /** Counterpart label for the "Replying to ..." byline. */
  counterpartName?: string;
  /** Clear the reply context. */
  onCancelReply?: () => void;
};

/**
 * Bottom composer — Figma 1:3087 + WhatsApp-style enhancements.
 *
 * Layout:
 *   - When `replyingTo` is set, a small dark banner appears above the input
 *     pill: "Replying to {name}" + a one-line preview + an `×` dismiss button.
 *   - Dark slab (`#272727`) holds the rounded grey input pill (`#474545`).
 *   - Right side toggles between scan/mic outlines (empty input) and a
 *     purple circular send button (text typed).
 *
 * Side effects:
 *   - On every keystroke we call `onTyping` so the hook can decide whether to
 *     emit a `typing:ping` to the gateway (rate-limited to every ~2.5s).
 *   - `submit` clears the input synchronously before awaiting the network so
 *     the field feels instant.
 */
export function Composer({
  onSend,
  onAttach,
  onScan,
  onVoice,
  onTyping,
  replyingTo,
  counterpartName,
  onCancelReply,
}: Props) {
  const [value, setValue] = useState('');

  async function submit() {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    setValue('');
    await onSend(trimmed);
  }

  const hasText = value.trim().length > 0;

  return (
    <View style={styles.bar}>
      <SafeAreaView edges={['bottom']} style={styles.safe}>
        {replyingTo ? (
          <View style={styles.replyBanner}>
            <View style={styles.replyAccent} />
            <View style={styles.replyBody}>
              <ThemedText style={styles.replyAuthor} numberOfLines={1}>
                Replying to {replyingTo.senderId === 'me' ? 'yourself' : counterpartName ?? 'them'}
              </ThemedText>
              <ThemedText style={styles.replyPreview} numberOfLines={1}>
                {replyingTo.deletedAt
                  ? 'This message was deleted'
                  : replyingTo.type === 'text'
                    ? replyingTo.text
                    : replyingTo.type === 'voice'
                      ? `Voice note · ${formatDuration(replyingTo.durationSec)}`
                      : 'Photo'}
              </ThemedText>
            </View>
            <Pressable onPress={onCancelReply} hitSlop={10} style={styles.replyClose}>
              <Feather name="x" size={16} color={Brand.chatComposerIcon} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.row}>
          <View style={styles.inputPill}>
            <Pressable hitSlop={8} style={styles.iconBtn} onPress={onAttach}>
              <Feather name="paperclip" size={18} color={Brand.chatComposerIcon} />
            </Pressable>
            <TextInput
              value={value}
              onChangeText={(t) => {
                setValue(t);
                if (t.length > 0) onTyping?.();
              }}
              placeholder={ChatCopy.thread.typePlaceholder}
              placeholderTextColor={Brand.chatComposerPlaceholder}
              style={styles.input}
              multiline
              maxLength={4000}
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={submit}
            />
          </View>

          {hasText ? (
            <Pressable
              onPress={submit}
              style={({ pressed }: { pressed: boolean }) => [
                styles.sendBtn,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send message">
              <Feather name="send" size={18} color="#FFFFFF" />
            </Pressable>
          ) : (
            <View style={styles.endActions}>
              <Pressable hitSlop={8} style={styles.outlineBtn} onPress={onScan}>
                <MaterialCommunityIcons name="scan-helper" size={20} color={Brand.chatComposerIcon} />
              </Pressable>
              <Pressable hitSlop={8} style={styles.outlineBtn} onPress={onVoice}>
                <Feather name="mic" size={18} color={Brand.chatComposerIcon} />
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: Brand.chatComposerBg,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 10.9,
    elevation: 12,
  },
  safe: {
    backgroundColor: Brand.chatComposerBg,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: 10,
    gap: 10,
  },
  replyAccent: {
    width: 3,
    height: 36,
    backgroundColor: Brand.chatActionLime,
    borderRadius: 1.5,
  },
  replyBody: {
    flex: 1,
    minWidth: 0,
  },
  replyAuthor: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: FontWeight.semibold,
    color: Brand.chatActionLime,
    letterSpacing: -0.1,
  },
  replyPreview: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: FontWeight.regular,
    color: '#979797',
    letterSpacing: -0.1,
  },
  replyClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two + 2,
    paddingBottom: Spacing.two + 2,
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 28,
    gap: Spacing.two,
    backgroundColor: Brand.chatComposerInputBg,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: FontWeight.medium,
    paddingVertical: 8,
    maxHeight: 110,
    color: '#EDEDED',
    letterSpacing: -0.15,
  },
  iconBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  outlineBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
    borderColor: Brand.chatComposerIcon,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.chatBubbleMine,
  },
});
