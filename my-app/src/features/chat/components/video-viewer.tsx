import { Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Dimensions, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Props = {
  uri: string;
  onClose: () => void;
};

/**
 * Full-screen video player (Tranche 2.C). Rendered ONLY while open (the bubble
 * conditionally mounts it) so we never hold an `expo-video` player per row in
 * the FlatList. The player is created + autoplayed in the `useVideoPlayer`
 * setup callback; we `pause()` before `onClose` and let the hook release it on
 * unmount — the discipline that avoids expo-av/expo-video's
 * "use of a released shared object" teardown crash.
 */
export function VideoViewer({ uri, onClose }: Props) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });

  function handleClose() {
    // Pause before unmount so no deferred status callback touches a released player.
    try {
      player.pause();
    } catch {
      // player may already be releasing — ignore.
    }
    onClose();
  }

  const { width, height } = Dimensions.get('window');

  return (
    <Modal visible animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={styles.topBar}>
          <Pressable
            onPress={handleClose}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close video">
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
        </SafeAreaView>
        <VideoView
          player={player}
          style={{ width, height: height * 0.8 }}
          contentFit="contain"
          nativeControls
          allowsFullscreen
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});
