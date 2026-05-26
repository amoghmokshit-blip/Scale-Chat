import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight } from '@/constants/theme';

/** Per-side icon accent for the card bubbles — centralized here so DocumentBubble
 *  + ContactCard share one source (was hard-coded per component in 2.C). */
export function cardAccent(isMine: boolean): string {
  return isMine ? 'rgba(255,255,255,0.92)' : Brand.chatHeaderTop;
}

type Props = {
  isMine: boolean;
  /** Leading glyph/spinner node — caller colors it (typically `cardAccent`). */
  leading: ReactNode;
  title: string;
  subtitle: string;
  /** Override the subtitle color (e.g. red for a failed upload). */
  subtitleColor?: string;
  onPress?: () => void;
  disabled?: boolean;
};

/**
 * Shared row-card body for the non-image attachment bubbles that render INSIDE
 * the standard chat bubble (Document, Contact). Icon square + title + subtitle.
 * Location uses its own tile (faux-map gradient) instead — it isn't a row.
 */
export function InfoCardBubble({ isMine, leading, title, subtitle, subtitleColor, onPress, disabled }: Props) {
  const nameColor = isMine ? Brand.chatBubbleMineText : Brand.chatBubbleTheirsText;
  const subColor = subtitleColor ?? (isMine ? 'rgba(255,255,255,0.7)' : '#5C6068');
  const iconBg = isMine ? 'rgba(255,255,255,0.15)' : 'rgba(69,82,228,0.1)';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      style={styles.row}
      accessibilityRole="button">
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>{leading}</View>
      <View style={styles.meta}>
        <ThemedText style={[styles.title, { color: nameColor }]} numberOfLines={2}>
          {title}
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: subColor }]} numberOfLines={1}>
          {subtitle}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 180,
    maxWidth: 260,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 14, fontWeight: FontWeight.semibold, letterSpacing: -0.14 },
  subtitle: { fontSize: 11, fontWeight: FontWeight.regular },
});
