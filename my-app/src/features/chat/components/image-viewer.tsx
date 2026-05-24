import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { FontWeight } from '@/constants/theme';
import { formatBubbleTime, formatDayLabel } from '@/lib/format-time';

type Props = {
  visible: boolean;
  uri: string;
  onClose: () => void;
  /** ISO timestamp shown in the bottom meta strip. */
  timestamp: string;
};

/**
 * Full-screen image viewer — pinch to zoom, drag to pan while zoomed, single
 * tap on the backdrop closes. Built on `react-native-gesture-handler` v2 and
 * `react-native-reanimated` v4 (both already in deps).
 *
 * Why we built our own vs. installing `react-native-image-zoom-viewer`:
 * keeps the dep tree small and the gesture composition (pinch + pan + tap)
 * is the only behaviour we need. The Figma doesn't show carousel / swipe
 * between images, so no per-image pagination is needed here.
 */
export function ImageViewer({ visible, uri, onClose, timestamp }: Props) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Reset transform whenever the viewer is reopened.
  useEffect(() => {
    if (!visible) return;
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY, visible]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(5, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < 1.05) {
        // Snap-back to identity when the user un-pinches past 1×.
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (scale.value <= 1.02) return;
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Tap on the backdrop closes — but only when not zoomed (zoom uses the
  // backdrop area too, so we don't want stray taps to close mid-pan).
  const tap = Gesture.Tap()
    .maxDuration(180)
    .onEnd(() => {
      if (scale.value < 1.05) {
        runOnJS(onClose)();
      } else {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, tap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const { width, height } = Dimensions.get('window');

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaView edges={['top']} style={styles.topBar}>
          <View style={styles.topMeta}>
            <ThemedText style={styles.topTitle}>{formatDayLabel(timestamp)}</ThemedText>
            <ThemedText style={styles.topSub}>{formatBubbleTime(timestamp)}</ThemedText>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close image viewer">
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
        </SafeAreaView>
        <GestureDetector gesture={composed}>
          <Animated.View style={[styles.imageWrap, animatedStyle]}>
            <Image
              source={uri}
              style={{ width, height: height * 0.8 }}
              contentFit="contain"
              transition={150}
            />
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topMeta: {
    flexDirection: 'column',
  },
  topTitle: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
    color: '#FFFFFF',
    letterSpacing: -0.15,
  },
  topSub: {
    fontSize: 11,
    fontWeight: FontWeight.regular,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  imageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
