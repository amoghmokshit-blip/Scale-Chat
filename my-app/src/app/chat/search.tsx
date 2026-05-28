import type { MessageSearchHit } from '@scalechat/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useDeferredValue, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';
import { ChatCopy } from '@/features/chat/copy';
import { chatRepository } from '@/features/chat/data';
import { useTheme } from '@/hooks/use-theme';
import { formatThreadRowTime } from '@/lib/format-time';

/**
 * In-thread message search overlay (P2-Search).
 *
 * Opened as a modal sibling of `chat/[id]` (same pattern as `forward`, `pick-contact`,
 * `compose-poll`). Reads the `threadId` param. Auto-focused TextInput; debounced via
 * `useDeferredValue`; renders a FlatList of `MessageSearchHit` rows. Tapping a hit
 * calls `router.back()` then navigates to the thread with a `highlightSequence` param.
 */
export default function ChatSearchScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();
  const inputRef = useRef<TextInput>(null);

  const [rawQuery, setRawQuery] = useState('');
  const [hits, setHits] = useState<MessageSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Defer the query so we only search when the value has stabilised (matches
  // the intent: only search when length ≥ 1, clear results when empty).
  const deferredQuery = useDeferredValue(rawQuery);

  useEffect(() => {
    // Dismiss early rather than render an inert picker without a threadId.
    if (!threadId) {
      router.back();
    }
  }, [threadId, router]);

  useEffect(() => {
    const q = deferredQuery.trim();
    if (q.length < 1) {
      setHits([]);
      setError(false);
      return;
    }

    const fn = chatRepository.searchMessages;
    if (!fn) return;

    let cancelled = false;
    setLoading(true);
    setError(false);

    fn.call(chatRepository, threadId ?? '', q, { limit: 30 })
      .then((page) => {
        if (!cancelled) {
          setHits(page.items);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deferredQuery, threadId]);

  function handleHitPress(hit: MessageSearchHit) {
    // Navigate to the thread (below this modal in the stack) with the sequence to
    // highlight. A single `navigate` pops the modal AND applies the param atomically
    // — avoids the back()+setParams() race where setParams could fire mid-transition.
    if (!threadId) return;
    router.navigate({
      pathname: '/chat/[id]',
      params: { id: threadId, highlightSequence: hit.sequence },
    });
  }

  const showEmpty = !loading && !error && deferredQuery.trim().length >= 1 && hits.length === 0;
  const showPrompt = !loading && !error && deferredQuery.trim().length < 1;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Search bar row */}
        <View style={[styles.searchRow, { borderBottomColor: theme.divider }]}>
          <View style={[styles.inputWrap, { backgroundColor: theme.surfaceMuted }]}>
            <TextInput
              ref={inputRef}
              autoFocus
              style={[styles.input, { color: theme.text }]}
              placeholder={ChatCopy.search.placeholder}
              placeholderTextColor={theme.textSecondary}
              value={rawQuery}
              onChangeText={setRawQuery}
              returnKeyType="search"
              clearButtonMode="while-editing"
              underlineColorAndroid="transparent"
              selectionColor={Brand.chatBubbleMine}
            />
          </View>

          <ThemedText
            style={[styles.cancelBtn, { color: theme.textSecondary }]}
            onPress={() => router.back()}>
            Cancel
          </ThemedText>
        </View>

        {/* Results / states */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.text} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <ThemedText style={[styles.stateText, { color: theme.textSecondary }]}>
              {ChatCopy.search.error}
            </ThemedText>
          </View>
        ) : showPrompt ? (
          <View style={styles.center}>
            <ThemedText style={[styles.stateText, { color: theme.textSecondary }]}>
              {ChatCopy.search.emptyPrompt}
            </ThemedText>
          </View>
        ) : showEmpty ? (
          <View style={styles.center}>
            <ThemedText style={[styles.stateText, { color: theme.textSecondary }]}>
              {ChatCopy.search.noResults}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={hits}
            keyExtractor={(item) => item.messageId}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <SearchHitRow hit={item} onPress={handleHitPress} />
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SearchHitRow({
  hit,
  onPress,
}: {
  hit: MessageSearchHit;
  onPress: (hit: MessageSearchHit) => void;
}) {
  const theme = useTheme();
  // A sender label: "You" for me, otherwise keep it blank (1-on-1, only two participants).
  // The mock uses 'mock-me-id'; the real repo will return the authenticated user's id.
  // We can't reliably resolve "me" vs counterpart here without extra context, so we
  // always show the time + snippet and leave sender attribution to future work.
  return (
    <Pressable
      style={[styles.hitRow, { borderBottomColor: theme.divider }]}
      onPress={() => onPress(hit)}
      accessibilityRole="button">
      <View style={styles.hitInner}>
        <ThemedText style={[styles.hitSnippet, { color: theme.text }]} numberOfLines={2}>
          {hit.snippet}
        </ThemedText>
        <ThemedText style={[styles.hitTime, { color: theme.textSecondary }]}>
          {formatThreadRowTime(hit.createdAt)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flex: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
  },
  input: {
    fontSize: 16,
    fontWeight: FontWeight.regular,
    padding: 0,
    margin: 0,
  },
  cancelBtn: {
    fontSize: 15,
    fontWeight: FontWeight.medium,
    paddingVertical: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  stateText: {
    fontSize: 14,
    textAlign: 'center',
  },
  list: {
    paddingBottom: Spacing.four,
  },
  hitRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  hitInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  hitSnippet: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  hitTime: {
    fontSize: 12,
    fontWeight: FontWeight.regular,
    paddingTop: 2,
  },
});
