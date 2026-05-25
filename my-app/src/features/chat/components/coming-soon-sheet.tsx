import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';

type Props = {
  visible: boolean;
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  /** Optional footnote rendered below the body in a quieter tone. */
  footnote?: string;
  /** Label on the dismiss button. Defaults to "Got it". */
  dismissLabel?: string;
  onClose: () => void;
};

/**
 * Reusable "Coming soon" modal — Figma-aligned with the rest of the chat
 * sheets (dark slab, lime CTA). Used by surfaces that exist visually in the
 * Figma but ship in later BRDs (voice/video calls, chat theme, export chat).
 *
 * Centered card over a translucent backdrop; mirrors `message-action-sheet`
 * so the action lift / typography feel consistent across the thread.
 */
export function ComingSoonSheet({
  visible,
  icon = 'clock',
  title,
  body,
  footnote,
  dismissLabel = 'Got it',
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <View style={styles.iconWrap}>
            <Feather name={icon} size={24} color={Brand.accentText} />
          </View>
          <ThemedText style={styles.title}>{title}</ThemedText>
          <ThemedText style={styles.body}>{body}</ThemedText>
          {footnote ? <ThemedText style={styles.footnote}>{footnote}</ThemedText> : null}
          <Pressable
            onPress={onClose}
            style={({ pressed }: { pressed: boolean }) => [
              styles.cta,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button">
            <ThemedText style={styles.ctaLabel}>{dismissLabel}</ThemedText>
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
    paddingHorizontal: 32,
  },
  sheet: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#272727',
    borderRadius: 22,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three - 2,
  },
  title: {
    fontSize: 18,
    fontWeight: FontWeight.semibold,
    color: '#EDEDED',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    fontWeight: FontWeight.regular,
    color: 'rgba(237,237,237,0.78)',
    lineHeight: 20,
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  footnote: {
    marginTop: Spacing.two,
    fontSize: 12,
    fontWeight: FontWeight.regular,
    color: 'rgba(237,237,237,0.5)',
    lineHeight: 17,
    textAlign: 'center',
  },
  cta: {
    marginTop: Spacing.four,
    alignSelf: 'stretch',
    backgroundColor: Brand.accent,
    borderRadius: Radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ctaLabel: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
    color: Brand.accentText,
    letterSpacing: -0.15,
  },
});
