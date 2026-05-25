import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/theme';

/**
 * Default emoji set surfaced above the action menu (Figma "Chat Select Option").
 * Order matches Figma left → right. The trailing `+` opens the full picker.
 */
const QUICK_EMOJIS = ['😅', '👍', '😆', '😍', '❤️', '💯', '🙏'] as const;

type Props = {
  /** Called with the tapped emoji. Caller is expected to close the action sheet. */
  onReact: (emoji: string) => void;
  /** Called when the trailing `+` chip is tapped — opens the full picker modal. */
  onOpenPicker: () => void;
  /**
   * When provided, the chip for this emoji renders in a "selected" state
   * (lighter background) so the viewer can see at a glance which quick-react
   * they've already used on this message. Caller passes the emoji from
   * `message.reactions.find(r => r.reactedByMe)?.emoji` if any.
   */
  myEmoji?: string | null;
};

/**
 * Horizontal emoji-quick-react row rendered ABOVE the MessageActionSheet rows.
 * One tap on any chip fires `onReact(emoji)` and closes the sheet; the trailing
 * `+` opens the full `EmojiPickerModal`. Pure presentational — the cache
 * mutation lives in `addReaction` / `removeReaction` on the chat repository.
 */
export function ReactionsStrip({ onReact, onOpenPicker, myEmoji }: Props) {
  return (
    <View style={styles.row}>
      {QUICK_EMOJIS.map((e) => {
        const selected = e === myEmoji;
        return (
          <Pressable
            key={e}
            onPress={() => onReact(e)}
            accessibilityRole="button"
            accessibilityLabel={`React with ${e}`}
            style={({ pressed }: { pressed: boolean }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && { opacity: 0.7 },
            ]}>
            <ThemedText style={styles.emoji}>{e}</ThemedText>
          </Pressable>
        );
      })}
      <Pressable
        onPress={onOpenPicker}
        accessibilityRole="button"
        accessibilityLabel="Open full emoji picker"
        style={({ pressed }: { pressed: boolean }) => [
          styles.chip,
          styles.plusChip,
          pressed && { opacity: 0.7 },
        ]}>
        <Feather name="plus" size={18} color={Brand.chatComposerIcon} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 4,
  },
  chip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: 'rgba(108,124,253,0.20)',
  },
  plusChip: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  emoji: {
    fontSize: 20,
    lineHeight: 24,
  },
});
