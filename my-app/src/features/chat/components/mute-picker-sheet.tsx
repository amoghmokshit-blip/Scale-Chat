import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';

type Preset = '8h' | '1w' | 'always';

type Props = {
  visible: boolean;
  counterpartName: string;
  onClose: () => void;
  onPick: (until: Date | null) => void;
};

const PRESETS: Array<{ key: Preset; label: string; ms: number | null }> = [
  { key: '8h', label: 'For 8 hours', ms: 8 * 60 * 60 * 1000 },
  { key: '1w', label: 'For 1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  // "Always" = mute until a far-future date. We don't store "true infinity"
  // because all our scaling assumes Postgres timestamps stay bounded; a date
  // ~100 years out is the standard WhatsApp / Signal approach.
  { key: 'always', label: 'Always', ms: null },
];

const FAR_FUTURE = new Date('2125-01-01T00:00:00.000Z');

/**
 * Mute-duration picker shown after the user taps "Mute notifications" in
 * the per-chat options sheet. Three WhatsApp-equivalent presets.
 *
 * On pick we hand the absolute `Date` to the parent so the server doesn't
 * need to know about presets — `PATCH /chats/:id/mute { until: ISO }`.
 */
export function MutePickerSheet({ visible, counterpartName, onClose, onPick }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <ThemedText style={styles.title}>Mute notifications</ThemedText>
          <ThemedText style={styles.body}>
            You'll still see messages from {counterpartName}, but you won't be notified.
          </ThemedText>
          <View style={styles.options}>
            {PRESETS.map((p, i) => (
              <Pressable
                key={p.key}
                onPress={() => {
                  onPick(p.ms === null ? FAR_FUTURE : new Date(Date.now() + p.ms));
                  onClose();
                }}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.row,
                  i < PRESETS.length - 1 && styles.rowDivider,
                  pressed && { backgroundColor: 'rgba(255,255,255,0.06)' },
                ]}>
                <ThemedText style={styles.rowLabel}>{p.label}</ThemedText>
              </Pressable>
            ))}
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
    paddingHorizontal: 32,
  },
  sheet: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#272727',
    borderRadius: 22,
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
    marginBottom: 8,
  },
  body: {
    fontSize: 13,
    fontWeight: FontWeight.regular,
    color: 'rgba(237,237,237,0.72)',
    lineHeight: 19,
    textAlign: 'center',
  },
  options: {
    marginTop: Spacing.three,
    backgroundColor: '#1F1F1F',
    borderRadius: 14,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: FontWeight.medium,
    color: '#EDEDED',
    letterSpacing: -0.15,
    textAlign: 'center',
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
