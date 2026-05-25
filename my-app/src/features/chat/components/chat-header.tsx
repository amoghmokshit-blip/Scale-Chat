import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

// React-Native ships with class-based Animated components whose types don't
// satisfy React 19's stricter JSX namespace. Cast to `any` here so JSX
// accepts it; runtime behaviour is unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnimatedView = Animated.View as unknown as (props: any) => React.ReactElement;
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';

import type { Contact } from '../types';
import { Avatar } from './avatar';

type Props = {
  counterpart: Contact;
  /** Live presence — drives the subline ("Online" / "last seen 5m ago"). */
  isOnline?: boolean;
  lastSeenAt?: string | null;
  /** True while the peer is actively typing. Overrides the presence subline. */
  isPeerTyping?: boolean;
  /** True when the user has muted this chat — adds a bell-off pip on the avatar. */
  isMuted?: boolean;
  onOpenProfile?: () => void;
  onVoiceCall?: () => void;
  onVideoCall?: () => void;
  /** Opens the per-chat options sheet (BRD §3.6). */
  onOpenOverflow?: () => void;
};

/**
 * Top bar of the 1-on-1 chat — Figma 1:2972 "Chat Page".
 *
 * Purple diagonal gradient (`#4552E4 → #707CFD`), white circular back button,
 * 52px avatar with the counterpart photo, lime-accent call buttons.
 *
 * Subline beneath the name shows live status:
 *   - "typing…" (highest priority — beats presence)
 *   - "Online" when the peer has at least one active socket
 *   - "last seen {relative}" when offline and we know `lastSeenAt`
 *   - nothing when we have no signal yet
 */
export function ChatHeader({
  counterpart,
  isOnline,
  lastSeenAt,
  isPeerTyping,
  isMuted,
  onOpenProfile,
  onVoiceCall,
  onVideoCall,
  onOpenOverflow,
}: Props) {
  const router = useRouter();
  const handleBack = () => {
    // On web (hard reload) and deep links there's no nav history — fall back
    // to the chat list so we don't fire the "GO_BACK was not handled" warning.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };
  return (
    <LinearGradient
      colors={[Brand.chatHeaderTop, Brand.chatHeaderBottom]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.bg}>
      <SafeAreaView edges={['top']}>
        <View style={styles.row}>
          <Pressable
            onPress={handleBack}
            style={({ pressed }: { pressed: boolean }) => [
              styles.backBtn,
              pressed && styles.pressed,
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back">
            <Feather name="arrow-left" size={18} color="#1B1B1B" />
          </Pressable>

          <Pressable onPress={onOpenProfile} style={styles.identity} hitSlop={6}>
            <View>
              <Avatar contact={counterpart} size={52} />
              {isMuted ? (
                <View style={styles.mutedBadge}>
                  <Feather name="bell-off" size={10} color="#1B1B1B" />
                </View>
              ) : null}
            </View>
            <View style={styles.identityText}>
              <ThemedText style={styles.name} numberOfLines={1}>
                {counterpart.displayName}
              </ThemedText>
              <PresenceLine
                isPeerTyping={isPeerTyping ?? false}
                isOnline={isOnline ?? false}
                lastSeenAt={lastSeenAt ?? null}
              />
            </View>
          </Pressable>

          <View style={styles.actions}>
            <Pressable
              onPress={onVideoCall}
              style={({ pressed }: { pressed: boolean }) => [
                styles.actionBtn,
                pressed && styles.pressed,
              ]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Video call">
              <Feather name="video" size={16} color={Brand.chatActionLimeText} />
            </Pressable>
            <Pressable
              onPress={onVoiceCall}
              style={({ pressed }: { pressed: boolean }) => [
                styles.actionBtn,
                pressed && styles.pressed,
              ]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Voice call">
              <Feather name="phone" size={14} color={Brand.chatActionLimeText} />
            </Pressable>
            {onOpenOverflow ? (
              <Pressable
                onPress={onOpenOverflow}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.overflowBtn,
                  pressed && styles.pressed,
                ]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="More options">
                <Feather name="more-vertical" size={18} color="#EDEDED" />
              </Pressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

function PresenceLine({
  isPeerTyping,
  isOnline,
  lastSeenAt,
}: {
  isPeerTyping: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
}) {
  if (isPeerTyping) {
    return (
      <View style={styles.typingRow}>
        <ThemedText style={styles.presence}>typing</ThemedText>
        <TypingDots />
      </View>
    );
  }
  if (isOnline) {
    return (
      <ThemedText style={[styles.presence, { color: Brand.chatActionLime }]} numberOfLines={1}>
        Online
      </ThemedText>
    );
  }
  if (lastSeenAt) {
    return (
      <ThemedText style={styles.presence} numberOfLines={1}>
        last seen {formatLastSeen(lastSeenAt)}
      </ThemedText>
    );
  }
  // F4 (2026-05-25 verify): reserve the subline height so the header doesn't
  // shift when the first presence event lands. Single-line placeholder, same
  // height as the populated states above.
  return <View style={styles.presencePlaceholder} />;
}

/** Three pulsing dots — the WhatsApp / iMessage typing indicator. */
function TypingDots() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);

  const dot = (offset: number) => ({
    opacity: v.interpolate({
      inputRange: [0, offset, 1],
      outputRange: [0.3, 1, 0.3],
      extrapolate: 'clamp' as const,
    }),
  });

  return (
    <View style={styles.dotsRow}>
      <AnimatedView style={[styles.dot, dot(0.2)]} />
      <AnimatedView style={[styles.dot, dot(0.5)]} />
      <AnimatedView style={[styles.dot, dot(0.8)]} />
    </View>
  );
}

/** "5m ago" / "1h ago" / "yesterday" / "12/03/24" — relative to now, locale en-IN. */
function formatLastSeen(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const styles = StyleSheet.create({
  bg: {
    paddingBottom: Spacing.three,
    borderBottomLeftRadius: Radius.cardLg,
    borderBottomRightRadius: Radius.cardLg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EDEDED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    minWidth: 0,
  },
  identityText: {
    flexShrink: 1,
    minWidth: 0,
  },
  name: {
    color: '#EDEDED',
    fontSize: 17,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.68,
    flexShrink: 1,
  },
  presence: {
    color: 'rgba(237,237,237,0.78)',
    fontSize: 11,
    fontWeight: FontWeight.regular,
    marginTop: 1,
  },
  presencePlaceholder: {
    // Matches the fontSize:11 line-height + marginTop:1 of the populated
    // PresenceLine states so the header preserves the same vertical footprint
    // even before a presence event has landed.
    height: 14,
    marginTop: 1,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(237,237,237,0.85)',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Brand.chatActionLime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -2,
  },
  mutedBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Brand.chatActionLime,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
});
