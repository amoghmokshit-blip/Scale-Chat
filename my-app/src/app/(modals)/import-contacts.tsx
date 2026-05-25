import { Feather } from '@expo/vector-icons';
import type { ContactDiscoveryMatch } from '@scalechat/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ModalHeader } from '@/components/modal-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';
import { contactsRepository } from '@/features/contacts/data';
import { useDeviceContacts } from '@/features/contacts/hooks/use-device-contacts';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';

/**
 * Import Contacts — the "Pick from phonebook" path off /add-contact.
 *
 * Five UI states (idle / requesting / denied / loading / ready) driven by
 * `useDeviceContacts`. Each state renders centered until matches arrive,
 * then we swap to a FlatList of checkboxes + sticky "Save N" bottom CTA.
 *
 * The screen NEVER uploads the full address book. `useDeviceContacts`:
 *   1. Reads contacts locally,
 *   2. Normalises every phone to E.164 via `toE164India()`,
 *   3. POSTs only the normalised list to `/contacts/discover` in chunks,
 *   4. Caches matches in MMKV with a 24h TTL.
 *
 * After Save, `contactsRepository.addMany()` calls `notify()`, so any
 * open `useContacts()` consumer (e.g. /new-chat) refreshes automatically.
 */
export default function ImportContactsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { status, matches, scanned, error, requestPermission, refresh } = useDeviceContacts();

  /** Ids of `phoneE164`s the user has ticked. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Reset selection when matches change (re-discover via pull-to-refresh).
  // Otherwise stale `selected` keys could refer to phones no longer in `matches`.
  const selectedInMatches = useMemo(() => {
    const phoneSet = new Set(matches.map((m) => m.phoneE164));
    return new Set(Array.from(selected).filter((p) => phoneSet.has(p)));
  }, [matches, selected]);

  function toggle(phoneE164: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phoneE164)) next.delete(phoneE164);
      else next.add(phoneE164);
      return next;
    });
  }

  function toggleAll() {
    if (selectedInMatches.size === matches.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(matches.map((m) => m.phoneE164)));
    }
  }

  async function save() {
    if (saving || selectedInMatches.size === 0) return;
    const items = matches
      .filter((m) => selectedInMatches.has(m.phoneE164))
      .map((m) => ({ phoneE164: m.phoneE164, displayName: m.displayName }));
    setSaving(true);
    try {
      const res = await contactsRepository.addMany({ items });
      const msg =
        res.alreadyHad > 0
          ? `Saved ${res.saved.length} new${res.alreadyHad > 0 ? `, ${res.alreadyHad} were already in your contacts` : ''}.`
          : `Saved ${res.saved.length} contact${res.saved.length === 1 ? '' : 's'}.`;
      Alert.alert('Imported', msg, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (err) {
      // ApiError already unwraps the global { error: { code, message, ... } }
      // envelope into `.message`/`.code` — see lib/api-client.ts.
      const msg = err instanceof ApiError ? err.message : 'Could not save contacts.';
      Alert.alert("Couldn't import", msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ModalHeader title="Import Contacts" />
        {renderBody({
          status,
          matches,
          scanned,
          error,
          selected: selectedInMatches,
          onToggle: toggle,
          onToggleAll: toggleAll,
          onRequestPermission: requestPermission,
          onRefresh: refresh,
          theme,
        })}
        {status === 'ready' && matches.length > 0 ? (
          <View style={[styles.bottomBar, { backgroundColor: theme.background }]}>
            <Pressable
              onPress={save}
              disabled={saving || selectedInMatches.size === 0}
              style={({ pressed }) => [
                styles.saveBtn,
                { backgroundColor: Brand.primary },
                (pressed || saving || selectedInMatches.size === 0) && { opacity: 0.6 },
              ]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.saveLabel}>
                  {selectedInMatches.size === 0
                    ? 'Select contacts to import'
                    : `Save ${selectedInMatches.size} selected`}
                </ThemedText>
              )}
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

// ─── State-specific bodies ────────────────────────────────────────────────────

type BodyProps = {
  status: ReturnType<typeof useDeviceContacts>['status'];
  matches: ContactDiscoveryMatch[];
  scanned: number;
  error: string | null;
  selected: ReadonlySet<string>;
  onToggle: (phone: string) => void;
  onToggleAll: () => void;
  onRequestPermission: () => Promise<void>;
  onRefresh: () => Promise<void>;
  theme: ReturnType<typeof useTheme>;
};

function renderBody(p: BodyProps) {
  if (p.status === 'idle') return <IdleState onRequestPermission={p.onRequestPermission} theme={p.theme} />;
  if (p.status === 'requesting') return <BusyState label="Asking for permission…" theme={p.theme} />;
  if (p.status === 'denied') return <DeniedState theme={p.theme} />;
  if (p.status === 'loading') return <BusyState label="Looking through your contacts…" theme={p.theme} />;
  if (p.status === 'error') return <ErrorState error={p.error} onRetry={p.onRefresh} theme={p.theme} />;
  return <ReadyState {...p} />;
}

function CenteredCallout({
  icon,
  title,
  body,
  cta,
  secondary,
  theme,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  cta?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.callout}>
      <View style={[styles.calloutIcon, { backgroundColor: theme.surfaceMuted }]}>
        <Feather name={icon} size={28} color={theme.text} />
      </View>
      <ThemedText style={[styles.calloutTitle, { color: theme.text }]}>{title}</ThemedText>
      <ThemedText style={[styles.calloutBody, { color: theme.textSecondary }]}>{body}</ThemedText>
      {cta ? (
        <Pressable
          onPress={cta.onPress}
          style={({ pressed }) => [
            styles.calloutCta,
            { backgroundColor: Brand.primary },
            pressed && { opacity: 0.85 },
          ]}>
          <ThemedText style={styles.calloutCtaLabel}>{cta.label}</ThemedText>
        </Pressable>
      ) : null}
      {secondary ? (
        <Pressable onPress={secondary.onPress} style={styles.calloutSecondary} hitSlop={8}>
          <ThemedText style={[styles.calloutSecondaryLabel, { color: theme.textSecondary }]}>
            {secondary.label}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function IdleState({
  onRequestPermission,
  theme,
}: {
  onRequestPermission: () => Promise<void>;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <CenteredCallout
      icon="users"
      title="Find friends on ScaleChat"
      body="Pick people from your phonebook who already use the app. We only check — nothing's saved until you tap Save."
      cta={{ label: 'Continue', onPress: () => void onRequestPermission() }}
      theme={theme}
    />
  );
}

function DeniedState({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const router = useRouter();
  return (
    <CenteredCallout
      icon="lock"
      title="Contacts permission needed"
      body="ScaleChat needs your contacts to find friends on the app. You can grant access from system settings."
      cta={{ label: 'Open Settings', onPress: () => void Linking.openSettings() }}
      secondary={{ label: 'Add manually instead', onPress: () => router.replace('/add-contact') }}
      theme={theme}
    />
  );
}

function BusyState({ label, theme }: { label: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.callout}>
      <ActivityIndicator color={theme.text} />
      <ThemedText style={[styles.calloutBody, { color: theme.textSecondary, marginTop: Spacing.three }]}>
        {label}
      </ThemedText>
    </View>
  );
}

function ErrorState({
  error,
  onRetry,
  theme,
}: {
  error: string | null;
  onRetry: () => Promise<void>;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <CenteredCallout
      icon="alert-circle"
      title="Something went wrong"
      body={error ?? 'Could not finish discovering contacts. Try again in a moment.'}
      cta={{ label: 'Retry', onPress: () => void onRetry() }}
      theme={theme}
    />
  );
}

function ReadyState(p: BodyProps) {
  if (p.matches.length === 0) {
    return (
      <CenteredCallout
        icon="user-x"
        title="No matches yet"
        body={
          p.scanned > 0
            ? `We scanned ${p.scanned} ${p.scanned === 1 ? 'contact' : 'contacts'}. None are on ScaleChat yet — we'll let you know when they join.`
            : "Your phonebook is empty or no numbers were valid Indian mobiles."
        }
        secondary={{ label: 'Refresh', onPress: () => void p.onRefresh() }}
        theme={p.theme}
      />
    );
  }
  const allSelected = p.selected.size === p.matches.length;
  return (
    <View style={styles.listWrap}>
      <View style={styles.listHeader}>
        <ThemedText style={[styles.listHeaderLabel, { color: p.theme.textSecondary }]}>
          {p.matches.length} on ScaleChat · {p.scanned} scanned
        </ThemedText>
        <Pressable onPress={p.onToggleAll} hitSlop={8}>
          <ThemedText style={[styles.listHeaderAction, { color: Brand.primary }]}>
            {allSelected ? 'Deselect all' : 'Select all'}
          </ThemedText>
        </Pressable>
      </View>
      <FlatList
        data={p.matches}
        keyExtractor={(m) => m.phoneE164}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.one }} />}
        renderItem={({ item }) => (
          <MatchRow
            match={item}
            selected={p.selected.has(item.phoneE164)}
            onToggle={() => p.onToggle(item.phoneE164)}
            theme={p.theme}
          />
        )}
      />
    </View>
  );
}

function MatchRow({
  match,
  selected,
  onToggle,
  theme,
}: {
  match: ContactDiscoveryMatch;
  selected: boolean;
  onToggle: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityLabel={`${match.displayName}, ${selected ? 'selected' : 'not selected'}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.surfaceMuted },
        pressed && { opacity: 0.85 },
      ]}>
      <View
        style={[
          styles.checkbox,
          {
            borderColor: selected ? Brand.accent : theme.textSecondary,
            backgroundColor: selected ? Brand.accent : 'transparent',
          },
        ]}>
        {selected ? <Feather name="check" size={14} color={Brand.accentText} /> : null}
      </View>

      {/* Avatar disc — use platform avatar if any, else first-letter fallback. */}
      <View
        style={[
          styles.avatar,
          { backgroundColor: theme.surfaceInput },
        ]}>
        <ThemedText style={[styles.avatarInitial, { color: theme.text }]}>
          {match.displayName[0]?.toUpperCase() ?? '?'}
        </ThemedText>
      </View>

      <View style={styles.rowText}>
        <ThemedText style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
          {match.displayName}
        </ThemedText>
        <ThemedText style={[styles.rowPhone, { color: theme.textSecondary }]} numberOfLines={1}>
          {match.phoneE164}
        </ThemedText>
      </View>

      <View style={[styles.badge, { backgroundColor: Brand.accent }]}>
        <ThemedText style={[styles.badgeText, { color: Brand.accentText }]}>ON PLATFORM</ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },

  callout: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    gap: Spacing.two,
  },
  calloutIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  calloutTitle: {
    fontSize: 18,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  calloutBody: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  calloutCta: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.six,
    borderRadius: Radius.pill,
    marginTop: Spacing.three,
  },
  calloutCtaLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: FontWeight.semibold,
  },
  calloutSecondary: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.one,
  },
  calloutSecondaryLabel: {
    fontSize: 13,
    fontWeight: FontWeight.medium,
    textDecorationLine: 'underline',
  },

  listWrap: {
    flex: 1,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  listHeaderLabel: {
    fontSize: 12,
    fontWeight: FontWeight.medium,
  },
  listHeaderAction: {
    fontSize: 13,
    fontWeight: FontWeight.semibold,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.cardLg,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 16,
    fontWeight: FontWeight.semibold,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
  },
  rowPhone: {
    fontSize: 12,
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.4,
  },

  bottomBar: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  saveBtn: {
    paddingVertical: Spacing.three + 2,
    borderRadius: Radius.pill,
    alignItems: 'center',
  },
  saveLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: FontWeight.semibold,
  },
});
