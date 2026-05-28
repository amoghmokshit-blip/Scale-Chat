import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Spacing } from '@/constants/theme';

type Props = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  /** When true the tile renders at 0.4 opacity and ignores taps. */
  disabled?: boolean;
};

/** Profile v2 action tile (Figma 1:3877 — row of 4 below the avatar). bg #272727 (Brand.chatComposerBg), radius 19, ~82×93. */
export function ProfileActionTile({ icon, label, onPress, disabled = false }: Props) {
  return (
    <Pressable
      onPress={() => { if (!disabled) onPress(); }}
      style={({ pressed }: { pressed: boolean }) => [
        styles.tile,
        disabled && styles.tileDisabled,
        pressed && !disabled && { opacity: 0.65 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}>
      <View style={styles.iconWrap}><Feather name={icon} size={24} color="#FFFFFF" /></View>
      <ThemedText style={styles.label}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, backgroundColor: Brand.chatComposerBg, borderRadius: 19, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.two + 4, paddingHorizontal: Spacing.two, gap: Spacing.one + 2, minHeight: 86 },
  tileDisabled: { opacity: 0.4 },
  iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, fontWeight: FontWeight.medium, color: '#FFFFFF', letterSpacing: -0.1, textAlign: 'center' },
});
