import type { ReactionAggregate } from '@scalechat/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FontWeight } from '@/constants/theme';

type Props = {
  reactions: ReactionAggregate[] | undefined;
  /** Mine vs theirs — pills float on the bubble's outer edge. */
  isMine: boolean;
  /** Tap toggles: removes if `reactedByMe`, adds otherwise. */
  onToggle: (emoji: string) => void;
};

/**
 * Compact pill row that renders BELOW the bubble's meta row when the message
 * has at least one reaction. Each pill shows `{emoji} {count}`. Tapping the
 * viewer's own pill removes their reaction (lighter bg); tapping someone
 * else's pill adds the viewer to that emoji's count.
 *
 * Caller passes `message.reactions` straight in — we return null when empty.
 */
export function ReactionsPillRow({ reactions, isMine, onToggle }: Props) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <View
      style={[
        styles.row,
        isMine ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' },
      ]}>
      {reactions.map((r) => (
        <Pressable
          key={r.emoji}
          onPress={() => onToggle(r.emoji)}
          accessibilityRole="button"
          accessibilityLabel={`${r.emoji} reacted by ${r.count}; tap to ${r.reactedByMe ? 'remove' : 'add'} your reaction`}
          style={({ pressed }: { pressed: boolean }) => [
            styles.pill,
            r.reactedByMe ? styles.pillMine : styles.pillTheirs,
            pressed && { opacity: 0.8 },
          ]}>
          <ThemedText style={styles.emoji}>{r.emoji}</ThemedText>
          <ThemedText style={[styles.count, r.reactedByMe && styles.countMine]}>
            {r.count}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    paddingHorizontal: 12,
    marginTop: 2,
    marginBottom: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
    minHeight: 22,
  },
  pillTheirs: {
    backgroundColor: '#2A2A2A',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  pillMine: {
    backgroundColor: 'rgba(108,124,253,0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(108,124,253,0.45)',
  },
  emoji: {
    fontSize: 13,
    lineHeight: 16,
  },
  count: {
    fontSize: 11,
    fontWeight: FontWeight.medium,
    color: '#979797',
    letterSpacing: -0.1,
  },
  countMine: {
    color: '#C2C9FF',
  },
});
