import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight } from '@/constants/theme';

import { ChatCopy } from '../copy';
import type { PollMessage } from '../types';

type Props = {
  message: PollMessage;
  isMine: boolean;
  /** Fires when the user picks (or unpicks) options. Caller persists via `votePoll`. */
  onVote?: (optionIds: string[]) => void;
};

/**
 * PollBubble — Tranche 2.F.
 *
 * Renders inside the standard chat bubble (caller wraps with the mine/cream
 * background). Layout:
 *   - Question header (bold).
 *   - One row per option: radio (single-select) or checkbox (multi) + label
 *     + count badge + horizontal fill bar proportional to the option's share
 *     of `totalVoters` (or `maxCount` for the legacy 0-voters bar).
 *   - Subline: "N voted" while open, "Poll closed" once `closedAt` is set.
 *
 * Tap an option row to toggle selection; we send the FULL post-tap selection
 * set to `onVote` (the repo / server uses authoritative diff).
 */
export function PollBubble({ message, isMine, onVote }: Props) {
  const isClosed = message.closedAt != null;
  const titleColor = isMine ? Brand.chatBubbleMineText : Brand.chatBubbleTheirsText;
  const subColor = isMine ? 'rgba(255,255,255,0.7)' : '#5C6068';
  const fillColor = isMine ? 'rgba(255,255,255,0.18)' : 'rgba(69,82,228,0.10)';
  const accent = isMine ? '#FFFFFF' : Brand.chatHeaderTop;

  // Track local selection so a tap on a CHECKED single-select option is a
  // no-op (single-select can't deselect — you can only swap). For multi, a
  // tap toggles the id in/out of the set.
  const initialSelected = useMemo(
    () => message.options.filter((o) => o.votedByMe).map((o) => o.id),
    [message.options],
  );
  const [selected, setSelected] = useState<string[]>(initialSelected);

  // Keep local state in sync when an authoritative aggregate arrives via the
  // socket subscriber (server reconcile). useMemo's dep ensures the effect-
  // free reset.
  if (
    initialSelected.length !== selected.length ||
    initialSelected.some((id) => !selected.includes(id))
  ) {
    // Soft sync — only when the array CONTENT differs.
    const same =
      initialSelected.length === selected.length &&
      initialSelected.every((id, i) => id === selected[i]);
    if (!same) setSelected(initialSelected);
  }

  const maxCount = Math.max(1, ...message.options.map((o) => o.count));

  function handleTap(optionId: string): void {
    if (isClosed || !onVote) return;
    if (message.multiSelect) {
      const next = selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId];
      // Empty set isn't a valid vote (server rejects min(1)) — bail silently;
      // the user has to leave at least one option.
      if (next.length === 0) return;
      setSelected(next);
      onVote(next);
      return;
    }
    // Single-select: tapping the already-selected row is a no-op.
    if (selected.length === 1 && selected[0] === optionId) return;
    setSelected([optionId]);
    onVote([optionId]);
  }

  return (
    <View style={styles.root}>
      <ThemedText style={[styles.question, { color: titleColor }]}>
        {message.question}
      </ThemedText>
      {message.options.map((opt) => {
        const isPicked = selected.includes(opt.id);
        const ratio = opt.count / maxCount;
        const Indicator = message.multiSelect ? (
          <Feather
            name={isPicked ? 'check-square' : 'square'}
            size={18}
            color={isPicked ? accent : subColor}
          />
        ) : (
          <Feather
            name={isPicked ? 'check-circle' : 'circle'}
            size={18}
            color={isPicked ? accent : subColor}
          />
        );
        return (
          <Pressable
            key={opt.id}
            onPress={() => handleTap(opt.id)}
            disabled={isClosed}
            style={({ pressed }: { pressed: boolean }) => [
              styles.option,
              pressed && !isClosed && { opacity: 0.85 },
              isClosed && { opacity: 0.65 },
            ]}>
            <View style={styles.optionTopRow}>
              {Indicator}
              <ThemedText
                style={[styles.optionLabel, { color: titleColor }]}
                numberOfLines={2}>
                {opt.label}
              </ThemedText>
              <ThemedText style={[styles.optionCount, { color: subColor }]}>
                {opt.count}
              </ThemedText>
            </View>
            <View style={[styles.fillTrack, { backgroundColor: fillColor }]}>
              <View
                style={[
                  styles.fillBar,
                  {
                    width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
                    backgroundColor: accent,
                    // Empty bar wouldn't render a visible 0-width segment;
                    // a 2px stub keeps the row visually grounded.
                    minWidth: opt.count > 0 ? 8 : 0,
                  },
                ]}
              />
            </View>
          </Pressable>
        );
      })}
      <ThemedText style={[styles.subline, { color: subColor }]}>
        {isClosed ? ChatCopy.poll.closed : ChatCopy.poll.votedCount(message.totalVoters)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minWidth: 220,
    maxWidth: 280,
    gap: 8,
  },
  question: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.14,
    lineHeight: 18,
  },
  option: {
    gap: 6,
    paddingVertical: 4,
  },
  optionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: FontWeight.regular,
    letterSpacing: -0.1,
  },
  optionCount: {
    fontSize: 12,
    fontWeight: FontWeight.medium,
    minWidth: 18,
    textAlign: 'right',
  },
  fillTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fillBar: {
    height: 6,
    borderRadius: 3,
  },
  subline: {
    fontSize: 11,
    fontWeight: FontWeight.regular,
    marginTop: 2,
    letterSpacing: -0.1,
  },
});
