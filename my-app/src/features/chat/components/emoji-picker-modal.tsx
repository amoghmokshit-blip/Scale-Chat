import { Modal, StyleSheet, View } from 'react-native';
import EmojiPicker from 'rn-emoji-keyboard';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called with the chosen emoji (after which we close the modal). */
  onSelect: (emoji: string) => void;
};

/**
 * Full emoji picker triggered by the `+` chip in `ReactionsStrip`. Wraps
 * `rn-emoji-keyboard` (pure-JS package, no native deps — Expo Go compatible).
 * The library handles its own bottom-sheet UX via the `open` prop, so we mount
 * it inside a transparent `<Modal>` to inherit RN's hardware-back handling
 * (Android) + keep it above the action sheet's z-index.
 */
export function EmojiPickerModal({ visible, onClose, onSelect }: Props) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.host}>
        <EmojiPicker
          open={visible}
          onClose={onClose}
          onEmojiSelected={(e: { emoji: string }) => {
            onSelect(e.emoji);
            onClose();
          }}
          enableSearchBar
          theme={{
            backdrop: 'rgba(0,0,0,0.55)',
            knob: '#5360EC',
            container: '#272727',
            header: '#EDEDED',
            skinTonesContainer: '#3A3A3A',
            category: {
              icon: '#9A9CA8',
              iconActive: '#5360EC',
              container: '#1F1F1F',
              containerActive: '#272727',
            },
            search: {
              text: '#EDEDED',
              placeholder: '#7A7E86',
              icon: '#7A7E86',
              background: '#1F1F1F',
            },
          }}
          categoryPosition="bottom"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Transparent host — the picker library renders its own backdrop + sheet.
  host: { flex: 1 },
});
