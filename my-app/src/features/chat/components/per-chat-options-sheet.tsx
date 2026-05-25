import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';

type Action = {
  key: string;
  label: string;
  hint?: string;
  icon: keyof typeof Feather.glyphMap;
  destructive?: boolean;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  counterpartName: string;
  isMuted: boolean;
  isBlocked: boolean;
  onClose: () => void;
  onViewContact: () => void;
  onSearch: () => void;
  onMute: () => void;
  onUnmute: () => void;
  onStarred: () => void;
  onWallpaper: () => void;
  onClearChat: () => void;
  onExportChat: () => void;
  onBlock: () => void;
  onUnblock: () => void;
};

/**
 * Header overflow sheet — BRD §3.6 (per-chat options).
 *
 * Slides up from the bottom over a dimmed backdrop. Mirrors WhatsApp's
 * conversation overflow: View contact / Search / Mute / Starred / Wallpaper /
 * Clear chat / Export chat / Block.
 *
 * Mute + Block flip label/icon based on the current state passed in. Wallpaper
 * + Export are Coming-Soon today and route through `ComingSoonSheet` upstream
 * (we just emit the intent here).
 */
export function PerChatOptionsSheet({
  visible,
  counterpartName,
  isMuted,
  isBlocked,
  onClose,
  onViewContact,
  onSearch,
  onMute,
  onUnmute,
  onStarred,
  onWallpaper,
  onClearChat,
  onExportChat,
  onBlock,
  onUnblock,
}: Props) {
  const actions: Action[] = [
    {
      key: 'viewContact',
      label: 'View contact',
      icon: 'user',
      onPress: onViewContact,
    },
    {
      key: 'search',
      label: 'Search in chat',
      icon: 'search',
      onPress: onSearch,
      hint: 'Coming in Phase D',
    },
    {
      key: 'mute',
      label: isMuted ? 'Unmute notifications' : 'Mute notifications',
      icon: isMuted ? 'bell' : 'bell-off',
      onPress: isMuted ? onUnmute : onMute,
    },
    {
      key: 'starred',
      label: 'Starred messages',
      icon: 'star',
      onPress: onStarred,
      hint: 'Coming in Phase D',
    },
    {
      key: 'wallpaper',
      label: 'Wallpaper & chat theme',
      icon: 'droplet',
      onPress: onWallpaper,
    },
    {
      key: 'clearChat',
      label: 'Clear chat',
      icon: 'trash-2',
      destructive: true,
      onPress: onClearChat,
    },
    {
      key: 'exportChat',
      label: 'Export chat',
      icon: 'share',
      onPress: onExportChat,
    },
    {
      key: 'block',
      label: isBlocked ? `Unblock ${counterpartName}` : `Block ${counterpartName}`,
      icon: 'slash',
      destructive: true,
      onPress: isBlocked ? onUnblock : onBlock,
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          <SafeAreaView edges={['bottom']}>
            <View style={styles.handle} />
            <ThemedText style={styles.title}>{counterpartName}</ThemedText>
            <ScrollView showsVerticalScrollIndicator={false}>
              {actions.map((a, i) => (
                <Pressable
                  key={a.key}
                  onPress={() => {
                    a.onPress();
                    onClose();
                  }}
                  style={({ pressed }: { pressed: boolean }) => [
                    styles.row,
                    i < actions.length - 1 && styles.rowDivider,
                    pressed && { backgroundColor: 'rgba(255,255,255,0.06)' },
                  ]}>
                  <Feather
                    name={a.icon}
                    size={18}
                    color={a.destructive ? '#FF5C5C' : Brand.chatComposerIcon}
                    style={styles.icon}
                  />
                  <View style={styles.labelCol}>
                    <ThemedText
                      style={[styles.label, a.destructive && { color: '#FF5C5C' }]}>
                      {a.label}
                    </ThemedText>
                    {a.hint ? (
                      <ThemedText style={styles.hint}>{a.hint}</ThemedText>
                    ) : null}
                  </View>
                  <Feather
                    name="chevron-right"
                    size={16}
                    color="rgba(237,237,237,0.45)"
                  />
                </Pressable>
              ))}
            </ScrollView>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Brand.chatAttachmentBackdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Brand.chatAttachmentSheetBg,
    borderTopLeftRadius: Radius.cardLg,
    borderTopRightRadius: Radius.cardLg,
    paddingTop: 12,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 14,
  },
  title: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
    color: '#EDEDED',
    letterSpacing: -0.2,
    paddingHorizontal: Spacing.three + 4,
    paddingBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three + 4,
    paddingVertical: 14,
    gap: 14,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  icon: {
    width: 22,
  },
  labelCol: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: FontWeight.medium,
    color: '#EDEDED',
    letterSpacing: -0.15,
  },
  hint: {
    fontSize: 11,
    fontWeight: FontWeight.regular,
    color: 'rgba(237,237,237,0.5)',
    marginTop: 2,
  },
});
