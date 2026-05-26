import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Spacing } from '@/constants/theme';
import { ChatCopy } from '@/features/chat/copy';

type IconName =
  | { lib: 'feather'; name: keyof typeof Feather.glyphMap }
  | { lib: 'mci'; name: keyof typeof MaterialCommunityIcons.glyphMap };

type Tile = {
  key: string;
  label: string;
  tint: string;
  icon: IconName;
  onPress?: () => void;
  /** Disabled tiles still render at full opacity per the Figma but no-op on tap. */
  disabled?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onPickCamera: () => void;
  /** Gallery covers both photos AND videos (Tranche 2.C); the handler branches on the picked asset type. */
  onPickGallery: () => void;
  /** Document picker (Tranche 2.C). */
  onPickDocument: () => void;
  /** Contact + Location pickers (Tranche 2.D). */
  onPickContact: () => void;
  onPickLocation: () => void;
  /** Poll composer (Tranche 2.F). */
  onPickPoll: () => void;
};

/**
 * Attachment panel — Figma 1:3098.
 *
 * Slides up from the bottom over a dimmed backdrop. 3-column grid: Camera,
 * Gallery (photos + videos), Document, Contact, Location — all wired
 * (Tranche 2.D un-disabled Contact + Location).
 */
export function AttachmentSheet({
  visible,
  onClose,
  onPickCamera,
  onPickGallery,
  onPickDocument,
  onPickContact,
  onPickLocation,
  onPickPoll,
}: Props) {
  const tiles: Tile[] = [
    {
      key: 'camera',
      label: ChatCopy.attachments.camera,
      tint: '#FF5A8A',
      icon: { lib: 'feather', name: 'camera' },
      onPress: () => {
        onPickCamera();
        onClose();
      },
    },
    {
      key: 'gallery',
      label: ChatCopy.attachments.gallery,
      tint: '#9F7BFF',
      icon: { lib: 'feather', name: 'image' },
      onPress: () => {
        onPickGallery();
        onClose();
      },
    },
    {
      key: 'document',
      label: ChatCopy.attachments.document,
      tint: '#5BA3FF',
      icon: { lib: 'feather', name: 'file-text' },
      onPress: () => {
        onPickDocument();
        onClose();
      },
    },
    {
      key: 'contact',
      label: ChatCopy.attachments.contact,
      tint: '#34C77A',
      icon: { lib: 'mci', name: 'account' },
      onPress: () => {
        onPickContact();
        onClose();
      },
    },
    {
      key: 'location',
      label: ChatCopy.attachments.location,
      tint: '#FF9A55',
      icon: { lib: 'feather', name: 'map-pin' },
      onPress: () => {
        onPickLocation();
        onClose();
      },
    },
    {
      key: 'poll',
      label: ChatCopy.attachments.poll,
      tint: '#FFC857',
      icon: { lib: 'feather', name: 'bar-chart-2' },
      onPress: () => {
        onPickPoll();
        onClose();
      },
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          // Stop tap-through onto the backdrop.
          onPress={() => undefined}
          style={styles.sheet}>
          <SafeAreaView edges={['bottom']}>
            <View style={styles.handle} />
            <ThemedText style={styles.title}>{ChatCopy.attachments.title}</ThemedText>
            <View style={styles.grid}>
              {tiles.map((t) => (
                <TileButton key={t.key} tile={t} />
              ))}
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TileButton({ tile }: { tile: Tile }) {
  return (
    <Pressable
      onPress={tile.onPress}
      disabled={tile.disabled || !tile.onPress}
      style={({ pressed }: { pressed: boolean }) => [
        styles.tile,
        pressed && !tile.disabled && { opacity: 0.7 },
      ]}>
      <View style={[styles.tileIcon, { backgroundColor: tile.tint }]}>
        {tile.icon.lib === 'feather' ? (
          <Feather name={tile.icon.name} size={22} color="#FFFFFF" />
        ) : (
          <MaterialCommunityIcons name={tile.icon.name} size={22} color="#FFFFFF" />
        )}
      </View>
      <ThemedText style={[styles.tileLabel, tile.disabled && { opacity: 0.45 }]}>
        {tile.label}
      </ThemedText>
    </Pressable>
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
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 12,
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
    fontSize: 13,
    fontWeight: FontWeight.medium,
    color: '#979797',
    letterSpacing: -0.12,
    paddingHorizontal: Spacing.three + 4,
    paddingBottom: Spacing.two + 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  tile: {
    width: '33.333%',
    alignItems: 'center',
    paddingVertical: Spacing.two + 6,
  },
  tileIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  tileLabel: {
    fontSize: 12,
    fontWeight: FontWeight.medium,
    color: Brand.chatAttachmentTileLabel,
    letterSpacing: -0.1,
  },
});
