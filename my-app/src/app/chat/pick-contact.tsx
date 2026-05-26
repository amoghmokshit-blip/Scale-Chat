// expo-contacts top-level API throws in SDK 56 — use the /legacy re-export (PR 6 does the same).
import * as Contacts from 'expo-contacts/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ModalHeader } from '@/components/modal-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FontWeight, Radius, Spacing } from '@/constants/theme';
import { ChatCopy } from '@/features/chat/copy';
import { chatRepository } from '@/features/chat/data';
import { useTheme } from '@/hooks/use-theme';
import { formatIndianMobile, localDigitsFromE164, toE164Loose } from '@/lib/phone';

type PickRow = {
  id: string;
  /** Display name, never empty (falls back to the formatted number). */
  name: string;
  /** First number that normalizes to E.164, or null → row is disabled. */
  e164: string | null;
};

type LoadState = 'idle' | 'loading' | 'denied' | 'ready';

/**
 * Contact picker (Tranche 2.D) — a modal sibling of `chat/[id]` (like
 * `chat/forward.tsx`). Lists device contacts, single-select; on tap it sends a
 * CONTACT_CARD to the source thread via the repo directly (no `useThread` —
 * mirrors the forward picker). Numbers are normalized to E.164 with
 * `toE164Loose`; contacts with no usable number render disabled.
 */
export default function PickContactScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();

  const [state, setState] = useState<LoadState>('idle');
  const [rows, setRows] = useState<PickRow[]>([]);
  const [query, setQuery] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!threadId) {
      router.back();
      return;
    }
    let active = true;
    (async () => {
      setState('loading');
      const perm = await Contacts.requestPermissionsAsync();
      if (!active) return;
      if (perm.status !== 'granted') {
        setState('denied');
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });
      if (!active) return;
      const mapped: PickRow[] = data.map((c) => {
        // First number that normalizes to a valid E.164 wins.
        let e164: string | null = null;
        for (const n of c.phoneNumbers ?? []) {
          if (!n.number) continue;
          const v = toE164Loose(n.number);
          if (v) {
            e164 = v;
            break;
          }
        }
        const trimmed = (c.name ?? '').trim();
        const name = trimmed || (e164 ? formatNumber(e164) : ChatCopy.contact.bubbleFallback);
        return { id: c.id ?? `${name}-${e164 ?? ''}`, name, e164 };
      });
      // Contacts with a usable number first, then alphabetical.
      mapped.sort((a, b) => (a.e164 ? 0 : 1) - (b.e164 ? 0 : 1) || a.name.localeCompare(b.name));
      setRows(mapped);
      setState('ready');
    })();
    return () => {
      active = false;
    };
  }, [threadId, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || (r.e164 ?? '').includes(q));
  }, [rows, query]);

  async function pick(row: PickRow) {
    if (!threadId || !row.e164 || sendingId) return;
    setSendingId(row.id);
    try {
      await chatRepository.sendMessage({
        threadId,
        type: 'contact',
        contactName: row.name.slice(0, 120),
        contactPhoneE164: row.e164,
        clientMessageId: `c-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      });
      router.back();
    } catch {
      setSendingId(null);
    }
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ModalHeader title={ChatCopy.contact.pickerTitle} />

        {state === 'ready' || state === 'loading' ? (
          <View style={[styles.search, { backgroundColor: theme.surfaceInput }]}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={ChatCopy.contact.searchPlaceholder}
              placeholderTextColor={theme.inputPlaceholder}
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>
        ) : null}

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.one }} />}
          ListEmptyComponent={
            state === 'loading' ? (
              <View style={styles.empty}>
                <ActivityIndicator color={theme.text} />
              </View>
            ) : (
              <View style={styles.empty}>
                <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                  {state === 'denied' ? ChatCopy.contact.permissionDenied : ChatCopy.contact.empty}
                </ThemedText>
              </View>
            )
          }
          renderItem={({ item }) => {
            const disabled = !item.e164 || sendingId !== null;
            return (
              <Pressable
                onPress={() => void pick(item)}
                disabled={disabled}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.surfaceMuted },
                  pressed && !disabled && { opacity: 0.85 },
                  !item.e164 && { opacity: 0.5 },
                ]}>
                <View style={styles.rowText}>
                  <ThemedText style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                    {item.name}
                  </ThemedText>
                  <ThemedText style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>
                    {item.e164 ? formatNumber(item.e164) : ChatCopy.contact.noNumber}
                  </ThemedText>
                </View>
                {sendingId === item.id ? <ActivityIndicator color={theme.text} /> : null}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

/** +91 numbers show friendly; other countries show E.164. */
function formatNumber(e164: string): string {
  return e164.startsWith('+91') ? formatIndianMobile(localDigitsFromE164(e164)) : e164;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  search: {
    marginHorizontal: Spacing.three,
    paddingHorizontal: Spacing.three,
    height: 44,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  searchInput: { fontSize: 14, fontWeight: FontWeight.medium, paddingVertical: 0 },
  list: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.four },
  empty: { paddingTop: Spacing.six, alignItems: 'center' },
  emptyText: { fontSize: 13, textAlign: 'center', paddingHorizontal: Spacing.four },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: FontWeight.semibold },
  sub: { fontSize: 12 },
});
