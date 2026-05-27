import { Feather } from '@expo/vector-icons';
import type { ContactDiscoveryMatch } from '@scalechat/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
 * Import Contacts — the primary "Add Contact" path (WhatsApp-style).
 *
 * Five discovery states (idle / requesting / denied / loading / ready) driven by
 * `useDeviceContacts`. Once matches arrive we **auto-import all of them** — no
 * checkboxes, no Save button, no blocking alert. The list renders read-only with
 * an inline "Added N friends" status; manual single-contact entry stays reachable
 * via a secondary link.
 *
 * The screen NEVER uploads the full address book. `useDeviceContacts`:
 *   1. Reads contacts locally,
 *   2. Normalises every phone to E.164 via `toE164India()`,
 *   3. POSTs only the normalised list to `/contacts/discover` in chunks,
 *   4. Caches matches in MMKV with a 24h TTL.
 *
 * Auto-import calls `contactsRepository.addMany()` (idempotent server-side via
 * `alreadyHad`, and in the mock repo), which `notify()`s subscribers so any open
 * `useContacts()` consumer (e.g. /new-chat) refreshes automatically.
 */

type ImportState = 'idle' | 'saving' | 'done' | 'error';

export default function ImportContactsScreen() {
  const theme = useTheme();
  const { status, matches, scanned, error, requestPermission, refresh } = useDeviceContacts();

  const [importState, setImportState] = useState<ImportState>('idle');
  const [savedCount, setSavedCount] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  // Guards against re-importing on re-render / cache-hydrated `ready`. Reset on a
  // manual refresh so a fresh discovery imports its new matches.
  const didImport = useRef(false);

  const runImport = useCallback(async (toImport: ContactDiscoveryMatch[]) => {
    setImportState('saving');
    setImportError(null);
    try {
      const items = toImport.map((m) => ({ phoneE164: m.phoneE164, displayName: m.displayName }));
      const res = await contactsRepository.addMany({ items });
      setSavedCount(res.saved.length);
      setImportState('done');
    } catch (err) {
      // ApiError unwraps the global { error: { code, message } } envelope.
      setImportError(err instanceof ApiError ? err.message : 'Could not import contacts.');
      setImportState('error');
    }
  }, []);

  // Auto-import every match the moment discovery resolves.
  useEffect(() => {
    if (status !== 'ready' || matches.length === 0) return;
    if (didImport.current) return;
    didImport.current = true;
    void runImport(matches);
  }, [status, matches, runImport]);

  const handleRefresh = useCallback(async () => {
    didImport.current = false;
    setImportState('idle');
    setSavedCount(0);
    setImportError(null);
    await refresh();
  }, [refresh]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ModalHeader title="Add from Contacts" />
        {renderBody({
          status,
          matches,
          scanned,
          error,
          importState,
          savedCount,
          importError,
          onRetryImport: () => void runImport(matches),
          onRequestPermission: requestPermission,
          onRefresh: handleRefresh,
          theme,
        })}
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
  importState: ImportState;
  savedCount: number;
  importError: string | null;
  onRetryImport: () => void;
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
  const router = useRouter();
  return (
    <CenteredCallout
      icon="users"
      title="Find friends on ScaleChat"
      body="We'll add everyone in your phonebook who's already on ScaleChat. We only check your numbers — your address book is never uploaded."
      cta={{ label: 'Continue', onPress: () => void onRequestPermission() }}
      secondary={{ label: 'Add a number manually', onPress: () => router.replace('/add-contact') }}
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
      secondary={{ label: 'Add a number manually', onPress: () => router.replace('/add-contact') }}
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
  const router = useRouter();
  if (p.matches.length === 0) {
    return (
      <CenteredCallout
        icon="user-x"
        title="No matches yet"
        body={
          p.scanned > 0
            ? `We scanned ${p.scanned} ${p.scanned === 1 ? 'contact' : 'contacts'}. None are on ScaleChat yet — we'll let you know when they join.`
            : 'Your phonebook is empty or no numbers were valid Indian mobiles.'
        }
        cta={{ label: 'Add a number manually', onPress: () => router.replace('/add-contact') }}
        secondary={{ label: 'Refresh', onPress: () => void p.onRefresh() }}
        theme={p.theme}
      />
    );
  }
  return (
    <View style={styles.listWrap}>
      <View style={styles.listHeader}>
        <ThemedText style={[styles.listHeaderLabel, { color: p.theme.textSecondary }]}>
          {p.matches.length} on ScaleChat · {p.scanned} scanned
        </ThemedText>
        <ImportStatus
          state={p.importState}
          savedCount={p.savedCount}
          onRetry={p.onRetryImport}
          theme={p.theme}
        />
      </View>
      <FlatList
        data={p.matches}
        keyExtractor={(m) => m.phoneE164}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.one }} />}
        renderItem={({ item }) => <MatchRow match={item} theme={p.theme} />}
      />
    </View>
  );
}

/** Inline status pill where the old "Select all" toggle used to live. */
function ImportStatus({
  state,
  savedCount,
  onRetry,
  theme,
}: {
  state: ImportState;
  savedCount: number;
  onRetry: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  if (state === 'saving') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator size="small" color={theme.textSecondary} />
        <ThemedText style={[styles.statusLabel, { color: theme.textSecondary }]}>Adding…</ThemedText>
      </View>
    );
  }
  if (state === 'done') {
    return (
      <View style={styles.statusRow}>
        <Feather name="check-circle" size={14} color={Brand.accent} />
        <ThemedText style={[styles.statusLabel, { color: Brand.accent }]}>
          {savedCount > 0 ? `Added ${savedCount}` : 'Up to date'}
        </ThemedText>
      </View>
    );
  }
  if (state === 'error') {
    return (
      <Pressable onPress={onRetry} hitSlop={8}>
        <ThemedText style={[styles.statusLabel, { color: Brand.primary }]}>Couldn&apos;t add · Retry</ThemedText>
      </Pressable>
    );
  }
  return null;
}

function MatchRow({
  match,
  theme,
}: {
  match: ContactDiscoveryMatch;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View
      accessibilityLabel={`${match.displayName}, on ScaleChat`}
      style={[styles.row, { backgroundColor: theme.surfaceMuted }]}>
      {/* Avatar disc — use platform avatar if any, else first-letter fallback. */}
      <View style={[styles.avatar, { backgroundColor: theme.surfaceInput }]}>
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
    </View>
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
  },
  statusLabel: {
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
});
