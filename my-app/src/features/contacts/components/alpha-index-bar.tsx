import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

/**
 * WhatsApp-style A–Z fast-scroll index, overlaid on the right edge of a
 * `SectionList`. Letters present in the list are tappable + bright; absent
 * letters render dimmed (and are inert). Tap-to-jump only for now — drag-to-
 * scrub is a later enhancement.
 */
export function AlphaIndexBar({
  letters,
  onSelectLetter,
}: {
  /** Section titles currently in the list (the bright/active letters). */
  letters: string[];
  onSelectLetter: (letter: string) => void;
}) {
  const theme = useTheme();
  const present = useMemo(() => new Set(letters), [letters]);

  return (
    <View style={styles.bar} pointerEvents="box-none">
      {ALPHABET.map((letter) => {
        const active = present.has(letter);
        return (
          <Pressable
            key={letter}
            disabled={!active}
            hitSlop={4}
            onPressIn={() => onSelectLetter(letter)}
            style={styles.letterHit}>
            <ThemedText
              style={[
                styles.letter,
                { color: active ? Brand.accent : theme.textSecondary, opacity: active ? 1 : 0.35 },
              ]}>
              {letter}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    right: 2,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  letterHit: {
    paddingVertical: 1,
    paddingHorizontal: 2,
  },
  letter: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
});
