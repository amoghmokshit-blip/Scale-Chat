import { Feather } from '@expo/vector-icons';
import type { ChatStorageSummary, MessageKind } from '@scalechat/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';
import { chatRepository } from '@/features/chat/data';
import { formatBytes } from '@/features/chat/format-bytes';
import { ChatCopy } from '@/features/chat/copy';
import { useTheme } from '@/hooks/use-theme';

/**
 * Manage Storage screen (P2-Storage) — Contact Profile → Manage Storage row.
 *
 * Fetches `GET /chats/:chatId/storage` and renders:
 *   1. Total-storage card (formatted total + disclaimer).
 *   2. Per-kind breakdown list (icon + label + count + size).
 *   3. "Free up space" button — confirms then shows a stub alert
 *      (SDK 56 has no per-chat cache-clear API; real file ops deferred).
 */
export default function ChatStorageScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string; chatId?: string }>();
  const chatId = params.chatId ?? '';

  const [summary, setSummary] = useState<ChatStorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!chatId) {
        setLoading(false);
        setError(ChatCopy.storage.noChatId);
        return;
      }
      try {
        const fn = chatRepository.getChatStorage;
        if (!fn) throw new Error('repo_missing_getChatStorage');
        const res = await fn.call(chatRepository, chatId);
        if (cancelled) return;
        setSummary(res);
        setError(null);
      } catch {
        if (cancelled) return;
        setError(ChatCopy.storage.error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  function handleFreeUp() {
    Alert.alert(
      ChatCopy.storage.freeUpAlert.title,
      ChatCopy.storage.freeUpAlert.body,
      [
        { text: ChatCopy.storage.freeUpAlert.cancel, style: 'cancel' },
        {
          text: ChatCopy.storage.freeUpAlert.clearCache,
          style: 'destructive',
          onPress: () => {
            // Stub — SDK 56 has no per-chat cache-clear API.
            // Real file-system ops (expo-file-system walk + delete) land in a
            // future ticket once the CDN URL → local-path mapping is tracked.
            Alert.alert(ChatCopy.storage.doneAlert.title, ChatCopy.storage.doneAlert.body);
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar backgroundColor={Brand.chatHeaderTop} barStyle="light-content" />

      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: theme.headerCard }}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            hitSlop={8}
            style={styles.iconBtn}>
            <Feather name="arrow-left" size={20} color={theme.headerCardText} />
          </Pressable>
          <ThemedText style={[styles.title, { color: theme.headerCardText }]}>
            {ChatCopy.storage.title}
          </ThemedText>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.text} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={36} color={theme.textSecondary} />
          <ThemedText style={[styles.errorText, { color: theme.textSecondary }]}>
            {error}
          </ThemedText>
        </View>
      ) : summary ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.six }]}
          showsVerticalScrollIndicator={false}>
          {/* Total card */}
          <View style={[styles.totalCard, { backgroundColor: theme.backgroundElement }]}>
            <View style={[styles.totalIconWrap, { backgroundColor: theme.background }]}>
              <Feather name="hard-drive" size={24} color={theme.text} />
            </View>
            <View style={styles.totalTextCol}>
              <ThemedText style={[styles.totalBytes, { color: theme.text }]}>
                {formatBytes(Number(summary.totalBytes))}
              </ThemedText>
              <ThemedText style={[styles.totalLabel, { color: theme.textSecondary }]}>
                {ChatCopy.storage.totalLabel}
              </ThemedText>
            </View>
          </View>

          <ThemedText style={[styles.disclaimer, { color: theme.textSecondary }]}>
            {ChatCopy.storage.disclaimer}
          </ThemedText>

          {/* Per-kind rows */}
          {summary.perKind.length > 0 ? (
            <View style={[styles.kindCard, { backgroundColor: theme.backgroundElement }]}>
              {summary.perKind.map((row, i) => (
                <View
                  key={row.kind}
                  style={[
                    styles.kindRow,
                    { borderBottomColor: theme.divider },
                    i === summary.perKind.length - 1 && styles.kindRowLast,
                  ]}>
                  <View style={[styles.kindIconWrap, { backgroundColor: theme.background }]}>
                    <Feather
                      name={kindIcon(row.kind)}
                      size={16}
                      color={theme.text}
                    />
                  </View>
                  <View style={styles.kindTextCol}>
                    <ThemedText style={[styles.kindLabel, { color: theme.text }]}>
                      {ChatCopy.storage.kindLabel[row.kind] ?? row.kind}
                    </ThemedText>
                    <ThemedText style={[styles.kindCount, { color: theme.textSecondary }]}>
                      {ChatCopy.storage.itemCount(row.count)}
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.kindBytes, { color: theme.textSecondary }]}>
                    {formatBytes(Number(row.totalBytes))}
                  </ThemedText>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <Feather name="inbox" size={32} color={theme.textSecondary} />
              <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                {ChatCopy.storage.empty}
              </ThemedText>
            </View>
          )}

          {/* Free up space */}
          <Pressable
            onPress={handleFreeUp}
            accessibilityRole="button"
            accessibilityLabel={ChatCopy.storage.freeUpSpace}
            style={({ pressed }) => [
              styles.freeBtn,
              { backgroundColor: Brand.destructiveRed },
              pressed && { opacity: 0.82 },
            ]}>
            <Feather name="trash-2" size={16} color="#FFFFFF" />
            <ThemedText style={styles.freeBtnLabel}>{ChatCopy.storage.freeUpSpace}</ThemedText>
          </Pressable>
        </ScrollView>
      ) : null}
    </View>
  );
}

// ─── Kind metadata helpers ─────────────────────────────────────────────────────

function kindIcon(kind: MessageKind): keyof typeof Feather.glyphMap {
  switch (kind) {
    case 'TEXT': return 'message-square';
    case 'IMAGE': return 'image';
    case 'VOICE': return 'mic';
    case 'VIDEO': return 'video';
    case 'DOCUMENT': return 'file-text';
    case 'LOCATION':
    case 'LOCATION_LIVE': return 'map-pin';
    case 'CONTACT_CARD': return 'user';
    case 'POLL': return 'bar-chart-2';
    case 'CALL_EVENT': return 'phone';
    case 'SYSTEM': return 'info';
    default: return 'file';
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: Spacing.four,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  scrollContent: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.three,
    marginBottom: Spacing.one,
  },
  totalIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalTextCol: {
    flex: 1,
    gap: 2,
  },
  totalBytes: {
    fontSize: 22,
    fontWeight: FontWeight.bold,
    letterSpacing: -0.5,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: FontWeight.regular,
  },
  disclaimer: {
    fontSize: 11,
    fontWeight: FontWeight.regular,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  kindCard: {
    borderRadius: Radius.card,
    overflow: 'hidden',
    marginBottom: Spacing.three,
  },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  kindRowLast: {
    borderBottomWidth: 0,
  },
  kindIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindTextCol: {
    flex: 1,
    gap: 1,
  },
  kindLabel: {
    fontSize: 14,
    fontWeight: FontWeight.medium,
    letterSpacing: -0.1,
  },
  kindCount: {
    fontSize: 12,
    fontWeight: FontWeight.regular,
  },
  kindBytes: {
    fontSize: 13,
    fontWeight: FontWeight.medium,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: Spacing.four,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: Radius.card,
    paddingVertical: 14,
    marginTop: Spacing.two,
  },
  freeBtnLabel: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
    color: '#FFFFFF',
    letterSpacing: -0.15,
  },
});
