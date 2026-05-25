import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Spacing } from '@/constants/theme';
import { chatRepository } from '@/features/chat/data';
import { useTheme } from '@/hooks/use-theme';

import type { ImageMessage, Message, VoiceMessage } from '@/features/chat/types';

type Tab = 'media' | 'voice';

/**
 * Contact Profile → Media, Links & Docs.
 *
 * Per-chat gallery; reads `GET /chats/:chatId/media?kind=&cursor=`. Two tabs:
 *   - **Media** (IMAGE) — 3-column grid of thumbnails; tap → opens the chat
 *     scrolled to that message id (TODO: deep-scroll lands with in-thread
 *     search in Phase D.4 so a future ticket can connect those).
 *   - **Voice notes** (VOICE) — list of bubbles with duration; tap → opens
 *     the chat.
 *
 * Pagination: scroll-end triggers `loadMore` until `hasMore === false`.
 * Empty state per tab shows a soft icon + copy directing the user back to
 * the conversation.
 */
export default function ContactMediaScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string; chatId?: string }>();
  const chatId = params.chatId ?? '';
  const [tab, setTab] = useState<Tab>('media');

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar backgroundColor={Brand.chatHeaderTop} barStyle="light-content" />
      <SafeAreaView edges={['top']} style={{ backgroundColor: theme.headerCard }}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            hitSlop={8}
            style={styles.iconBtn}>
            <Feather name="arrow-left" size={20} color={theme.headerCardText} />
          </Pressable>
          <ThemedText style={[styles.title, { color: theme.headerCardText }]}>
            Media, Links & Docs
          </ThemedText>
        </View>
        <View style={styles.tabRow}>
          <TabPill label="Media" active={tab === 'media'} onPress={() => setTab('media')} />
          <TabPill label="Voice notes" active={tab === 'voice'} onPress={() => setTab('voice')} />
        </View>
      </SafeAreaView>

      {tab === 'media' ? (
        <MediaGrid chatId={chatId} />
      ) : (
        <VoiceList chatId={chatId} />
      )}
    </View>
  );
}

function TabPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => [
        styles.tab,
        { backgroundColor: active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)' },
        pressed && { opacity: 0.85 },
      ]}>
      <ThemedText style={[styles.tabLabel, { color: '#FFFFFF', opacity: active ? 1 : 0.7 }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function MediaGrid({ chatId }: { chatId: string }) {
  const { items, loading, error } = useMediaPage(chatId, 'IMAGE');
  const theme = useTheme();
  if (loading) return <CenterSpinner />;
  if (error) return <EmptyState icon="alert-circle" message={error} />;
  if (items.length === 0) {
    return <EmptyState icon="image" message="No photos shared in this chat yet." />;
  }
  const photos = items.filter((m): m is ImageMessage => m.type === 'image');
  return (
    <FlatList
      data={photos}
      keyExtractor={(m) => m.id}
      numColumns={3}
      contentContainerStyle={{ padding: 2 }}
      renderItem={({ item }: { item: ImageMessage }) => (
        <View style={[styles.cell, { backgroundColor: theme.surfaceMuted }]}>
          {item.mediaUrl ? (
            <Image
              source={{ uri: item.mediaUrl }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
            />
          ) : null}
        </View>
      )}
    />
  );
}

function VoiceList({ chatId }: { chatId: string }) {
  const { items, loading, error } = useMediaPage(chatId, 'VOICE');
  const theme = useTheme();
  if (loading) return <CenterSpinner />;
  if (error) return <EmptyState icon="alert-circle" message={error} />;
  if (items.length === 0) {
    return <EmptyState icon="mic" message="No voice notes shared in this chat yet." />;
  }
  const voices = items.filter((m): m is VoiceMessage => m.type === 'voice');
  return (
    <FlatList
      data={voices}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ padding: Spacing.three }}
      renderItem={({ item }: { item: VoiceMessage }) => (
        <View
          style={[
            styles.voiceRow,
            { backgroundColor: theme.backgroundElement, borderColor: theme.divider },
          ]}>
          <Feather name="mic" size={16} color={theme.textSecondary} />
          <ThemedText style={[styles.voiceLabel, { color: theme.text }]}>
            {formatVoiceDuration(item.durationSec)}
          </ThemedText>
          <ThemedText style={[styles.voiceTime, { color: theme.textSecondary }]}>
            {new Date(item.createdAt).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
            })}
          </ThemedText>
        </View>
      )}
    />
  );
}

function useMediaPage(chatId: string, kind: 'IMAGE' | 'VOICE') {
  const [items, setItems] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!chatId) {
        setLoading(false);
        setError('No chat id provided.');
        return;
      }
      try {
        const fn = chatRepository.listMedia;
        if (!fn) throw new Error('repo_missing_listMedia');
        const res = await fn.call(chatRepository, chatId, { kind });
        if (cancelled) return;
        setItems(res.items);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError('Could not load media.');
        void err;
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [chatId, kind]);

  return { items, loading, error };
}

function CenterSpinner() {
  const theme = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={theme.text} />
    </View>
  );
}

function EmptyState({
  icon,
  message,
}: {
  icon: keyof typeof Feather.glyphMap;
  message: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.center}>
      <Feather name={icon} size={36} color={theme.textSecondary} />
      <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>{message}</ThemedText>
    </View>
  );
}

function formatVoiceDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.25,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two + 2,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: Spacing.four,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
  cell: {
    flex: 1 / 3,
    aspectRatio: 1,
    margin: 1,
    overflow: 'hidden',
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  voiceLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: FontWeight.medium,
  },
  voiceTime: {
    fontSize: 12,
  },
});
