import { CHAT_THEMES } from '@scalechat/shared';
import type { ChatTheme } from '@scalechat/shared';
import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';
import { ChatCopy } from '../copy';

type Props = {
  visible: boolean;
  /** Currently active theme; null/undefined = 'default'. */
  currentTheme?: string | null;
  onSelect: (theme: ChatTheme | null) => void;
  onClose: () => void;
};

const THEME_LABELS: Record<ChatTheme, string> = {
  default: ChatCopy.theme.nameDefault,
  midnight: ChatCopy.theme.nameMidnight,
  forest: ChatCopy.theme.nameForest,
  sunset: ChatCopy.theme.nameSunset,
};

/**
 * Chat-theme picker sheet (P2-Theme) — mirrors the MutePickerSheet modal pattern.
 *
 * Shows four swatches (Default + 3 themes), each previewing the body background
 * color with two mini bubble dots (mine / theirs). The currently active theme
 * gets a lime check-mark badge.
 *
 * Selecting a theme calls `onSelect` with the `ChatTheme` value (or `null` when
 * the user picks Default — `null` tells the API to reset to the server default).
 */
export function ChatThemePicker({ visible, currentTheme, onSelect, onClose }: Props) {
  const active = (currentTheme ?? 'default') as ChatTheme;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <ThemedText style={styles.title}>{ChatCopy.theme.pickerTitle}</ThemedText>

          <View style={styles.swatchRow}>
            {CHAT_THEMES.map((key) => {
              const token = Brand.chatThemes[key];
              const isSelected = key === active;
              const sendValue = key === 'default' ? null : key;
              return (
                <Pressable
                  key={key}
                  onPress={() => {
                    onSelect(sendValue as ChatTheme | null);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={THEME_LABELS[key]}
                  accessibilityState={{ selected: isSelected }}
                  style={({ pressed }) => [
                    styles.swatch,
                    { backgroundColor: token.body },
                    isSelected && styles.swatchSelected,
                    pressed && { opacity: 0.82 },
                  ]}>
                  {/* Mini mine + theirs bubble dots as a color preview */}
                  <View style={styles.dotRow}>
                    <View style={[styles.dot, { backgroundColor: token.mine }]} />
                    <View style={[styles.dot, { backgroundColor: token.theirs }]} />
                  </View>
                  <ThemedText style={styles.swatchLabel} numberOfLines={1}>
                    {THEME_LABELS[key]}
                  </ThemedText>
                  {isSelected ? (
                    <View style={styles.checkBadge}>
                      <Feather name="check" size={10} color="#1B1B1B" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={onClose} style={styles.cancel}>
            <ThemedText style={styles.cancelLabel}>Cancel</ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#272727',
    borderRadius: Radius.card,
    paddingTop: Spacing.three + 4,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.three + 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: FontWeight.semibold,
    color: '#EDEDED',
    letterSpacing: -0.25,
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  swatchRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  swatch: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    // min height so label + dots are always visible
    minHeight: 90,
    justifyContent: 'center',
  },
  swatchSelected: {
    borderColor: Brand.accent,
  },
  dotRow: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  swatchLabel: {
    fontSize: 11,
    fontWeight: FontWeight.medium,
    color: '#EDEDED',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    marginTop: Spacing.two,
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelLabel: {
    fontSize: 14,
    fontWeight: FontWeight.medium,
    color: 'rgba(237,237,237,0.6)',
  },
});
