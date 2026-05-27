import { Feather } from '@expo/vector-icons';
import type { UserProfileCard } from '@scalechat/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';
import { Avatar } from '@/features/chat/components/avatar';
import { ComingSoonSheet } from '@/features/chat/components/coming-soon-sheet';
import { MutePickerSheet } from '@/features/chat/components/mute-picker-sheet';
import { ProfileActionTile } from '@/features/chat/components/profile-action-tile';
import { ChatCopy } from '@/features/chat/copy';
import { chatRepository } from '@/features/chat/data';
import {
  PROFILE_CLEAR_CHAT_LABEL,
  PROFILE_OPTION_ROW_LABELS,
  PROFILE_SECTION_KEYS,
  profileBlockLabel,
} from '@/features/chat/profile-rows';
import type { Contact as ChatContact } from '@/features/chat/types';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';
import { ensureCallPermissions } from '@/lib/call-permissions';
import { formatIndianMobile, localDigitsFromE164 } from '@/lib/phone';

function formatProfilePhone(e164: string): string {
  return formatIndianMobile(localDigitsFromE164(e164));
}

type SheetKind = 'notifications' | 'search' | 'manageStorage' | 'chatTheme' | 'privacy' | null;

/**
 * Contact Profile screen v2 — Figma `1:3877`.
 *
 * Layout (top → bottom):
 *   1. Hero banner (headerCard bg, min-height 179, bottom radius 18)
 *      — back chevron in a profileBackCircle circle
 *      — name (#EDEDED, 20 semibold) + +91 phone
 *      — NO bio (Figma 1:3877 shows none)
 *   2. Avatar (112px) inside a 128px profileBackCircle ring, overlapping
 *      banner bottom via marginTop: -64.
 *      ANDROID CLIP NOTE: tested on emulator — marginTop overlap renders
 *      correctly on Fabric. Using the marginTop approach (simpler). If future
 *      Android versions clip it, switch to position:'absolute', bottom:-64
 *      inside the banner View as the fallback.
 *   3. Action-tile row — 4 ProfileActionTile (Voice, Video, Notifications, Search).
 *   4. Options card — 5 rows (Media, Chat Theme, Notifications, Manage Storage, Privacy).
 *   5. Destructive footer — Clear Chat + Block/Unblock.
 *
 * F1 (2026-05-25 verify): the hero + section list lived as sibling ScrollView
 * children before — that pattern triggered an RN 0.85 Fabric layout bug where
 * the first section's children were measured with negative height after warm
 * re-entry, hiding Encryption / Chat Theme / Media gallery from any tap.
 * Folding everything into one FlatList (hero as ListHeaderComponent, sections
 * as data items) keeps the measurement chain on the same node and the bug
 * doesn't repro. Repro path: open profile → scroll → re-enter → CONVERSATION gone.
 * See `docs/progress/1-on-1-production.md` → Phase B emulator verification.
 *
 * NOTE: useMemo for sectionsData MUST sit above the loading / error early-returns
 * so the hook count stays stable across re-renders (rules-of-hooks).
 */
export default function ContactProfileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [card, setCard] = useState<UserProfileCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);

  // Local mute state — profile-card DTO has no mute field; defaults false.
  const [isMuted, setIsMuted] = useState(false);

  // Local block state shadows card.isBlocked for optimistic toggles.
  const [isBlocked, setIsBlocked] = useState<boolean>(false);
  useEffect(() => {
    if (card) setIsBlocked(card.isBlocked);
  }, [card]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) {
        setLoading(false);
        return;
      }
      try {
        const fn = chatRepository.getProfileCard;
        if (!fn) throw new Error('repo_missing_getProfileCard');
        const next = await fn.call(chatRepository, id);
        if (!cancelled) {
          setCard(next);
          setError(null);
        }
      } catch (err) {
        const code = (err as { code?: string })?.code ?? 'unknown_error';
        const message =
          code === 'profile_not_visible'
            ? "You can only view profiles of people you share a chat with."
            : 'Could not load profile.';
        if (!cancelled) setError({ code, message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router]);

  async function startCall(kind: 'VOICE' | 'VIDEO') {
    if (!card?.commonChatId) return;
    const ok = await ensureCallPermissions(kind);
    if (!ok) {
      Alert.alert(ChatCopy.calls.permissionTitle, ChatCopy.calls.permissionBody);
      return;
    }
    try {
      const res = await chatRepository.startCall?.(card.commonChatId, kind);
      if (!res) return;
      router.push({
        pathname: '/chat/call',
        params: {
          callId: res.callId,
          accessToken: res.accessToken,
          wsUrl: res.wsUrl,
          kind,
          peerName: card.fullName,
        },
      });
    } catch (err) {
      Alert.alert('Call failed', err instanceof ApiError ? err.message : ChatCopy.calls.callFailed);
    }
  }

  async function handleMute(until: Date | null) {
    if (!card?.commonChatId) return;
    try {
      const res = await chatRepository.muteChat?.(card.commonChatId, until);
      if (res) setIsMuted(res.mutedUntil !== null);
      else setIsMuted(until !== null);
    } catch {
      // Silently revert — sheet already closed by MutePickerSheet's onPick+onClose flow.
    }
  }

  async function handleClearChat() {
    if (!card?.commonChatId) return;
    Alert.alert(
      ChatCopy.profile.clearChatConfirmTitle,
      ChatCopy.profile.clearChatConfirmBody,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: ChatCopy.profile.clearChatCta,
          style: 'destructive',
          onPress: async () => {
            try {
              await chatRepository.clearChat?.(card.commonChatId!);
            } catch {
              Alert.alert('Could not clear chat', 'Please try again.');
            }
          },
        },
      ],
    );
  }

  async function handleToggleBlock() {
    if (!card) return;
    const next = !isBlocked;
    const verb = next ? 'Block' : 'Unblock';
    Alert.alert(
      `${verb} ${card.fullName}?`,
      next
        ? "They won't be able to message you, and you won't be able to message them, until you unblock."
        : 'You will both be able to message each other again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb,
          style: next ? 'destructive' : 'default',
          onPress: async () => {
            const fn = next ? chatRepository.blockUser : chatRepository.unblockUser;
            if (!fn) return;
            setIsBlocked(next);
            try {
              await fn.call(chatRepository, card.id);
            } catch {
              setIsBlocked(!next);
              Alert.alert(
                next ? 'Could not block' : 'Could not unblock',
                'Please try again.',
              );
            }
          },
        },
      ],
    );
  }

  // NOTE: useMemo MUST sit above the loading/error early-returns (rules-of-hooks).
  type SectionItem = { key: string; render: () => React.ReactElement };
  const sectionsData = useMemo<SectionItem[]>(() => {
    if (!card) return [];

    return [
      {
        key: PROFILE_SECTION_KEYS[0],
        render: () => (
          <Section>
            <OptionRow
              icon="image"
              label={PROFILE_OPTION_ROW_LABELS[0]}
              onPress={() =>
                card.commonChatId
                  ? router.push({
                      pathname: '/contact/[id]/media',
                      params: { id: card.id, chatId: card.commonChatId },
                    })
                  : setSheet('search')
              }
            />
            <OptionRow
              icon="droplet"
              label={PROFILE_OPTION_ROW_LABELS[1]}
              onPress={() => setSheet('chatTheme')}
            />
            <OptionRow
              icon="bell"
              label={PROFILE_OPTION_ROW_LABELS[2]}
              disabled={!card.commonChatId}
              onPress={() => setSheet('notifications')}
            />
            <OptionRow
              icon="hard-drive"
              label={PROFILE_OPTION_ROW_LABELS[3]}
              onPress={() => setSheet('manageStorage')}
            />
            <OptionRow
              icon="lock"
              label={PROFILE_OPTION_ROW_LABELS[4]}
              onPress={() => setSheet('privacy')}
            />
          </Section>
        ),
      },
      {
        key: PROFILE_SECTION_KEYS[1],
        render: () => (
          <Section>
            <OptionRow
              icon="trash-2"
              label={PROFILE_CLEAR_CHAT_LABEL}
              destructive
              disabled={!card.commonChatId}
              onPress={() => void handleClearChat()}
            />
            <OptionRow
              icon="slash"
              label={profileBlockLabel(isBlocked)}
              destructive
              onPress={() => void handleToggleBlock()}
            />
          </Section>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, router, isBlocked]);

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: Brand.profileBg }]}>
        <StatusBar backgroundColor={Brand.chatHeaderTop} barStyle="light-content" />
        <View style={styles.center}>
          <ActivityIndicator color="#EDEDED" />
        </View>
      </View>
    );
  }

  if (error || !card) {
    return (
      <View style={[styles.root, { backgroundColor: Brand.profileBg }]}>
        <SafeAreaView edges={['top']}>
          <View style={styles.topBar}>
            <Pressable onPress={handleBack} hitSlop={8} style={styles.backCircle}>
              <Feather name="chevron-left" size={20} color="#1B1B1B" />
            </Pressable>
          </View>
        </SafeAreaView>
        <View style={styles.center}>
          <Feather name="lock" size={36} color="rgba(237,237,237,0.5)" />
          <ThemedText style={styles.errorTitle}>Profile unavailable</ThemedText>
          <ThemedText style={styles.errorBody}>
            {error?.message ?? 'Could not load profile.'}
          </ThemedText>
        </View>
      </View>
    );
  }

  const avatarContact: ChatContact = {
    id: card.id,
    displayName: card.fullName,
    avatarUri: card.avatarUri ?? undefined,
    phoneE164: card.phoneE164,
  };

  const Hero = (
    <View>
      {/* Banner */}
      <View style={[styles.banner, { backgroundColor: theme.headerCard }]}>
        <SafeAreaView edges={['top']}>
          <View style={styles.topBar}>
            <Pressable onPress={handleBack} hitSlop={8} style={styles.backCircle}>
              <Feather name="chevron-left" size={20} color="#1B1B1B" />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>

      {/* Avatar ring overlapping the banner bottom.
          ANDROID CLIP NOTE: marginTop:-64 approach used (tested on emulator — no clip).
          If future Fabric versions clip the ring, switch to position:'absolute', bottom:-64
          inside the banner View and add zIndex:1 to the ring container. */}
      <View style={styles.avatarRingWrap}>
        <View style={styles.avatarRing}>
          <Avatar contact={avatarContact} size={112} />
        </View>
      </View>

      {/* Name + phone sit BELOW the avatar on the dark background (Figma 1:3877:
          avatar top=111 overlapping the banner, name=239, phone=269). */}
      <View style={styles.nameBlock}>
        <ThemedText style={styles.heroName}>{card.fullName}</ThemedText>
        <ThemedText style={styles.heroPhone}>
          {formatProfilePhone(card.phoneE164)}
        </ThemedText>
      </View>

      {/* Action-tile row */}
      <View style={styles.tileRow}>
        <ProfileActionTile
          icon="phone"
          label="Voice Call"
          disabled={!card.commonChatId}
          onPress={() => void startCall('VOICE')}
        />
        <ProfileActionTile
          icon="video"
          label="Video Call"
          disabled={!card.commonChatId}
          onPress={() => void startCall('VIDEO')}
        />
        <ProfileActionTile
          icon={isMuted ? 'bell-off' : 'bell'}
          label="Notifications"
          disabled={!card.commonChatId}
          onPress={() => setSheet('notifications')}
        />
        <ProfileActionTile
          icon="search"
          label="Search"
          onPress={() => {
            if (card.commonChatId) {
              router.push({
                pathname: '/chat/search',
                params: { threadId: card.commonChatId },
              });
            } else {
              setSheet('search');
            }
          }}
        />
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: Brand.profileBg }]}>
      <StatusBar backgroundColor={Brand.chatHeaderTop} barStyle="light-content" />

      <FlatList
        data={sectionsData}
        keyExtractor={(item: SectionItem) => item.key}
        renderItem={({ item }: { item: SectionItem }) => item.render()}
        ListHeaderComponent={Hero}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Notifications mute picker */}
      <MutePickerSheet
        visible={sheet === 'notifications'}
        counterpartName={card.fullName}
        onClose={() => setSheet(null)}
        onPick={(until) => void handleMute(until)}
      />

      {/* Search coming soon */}
      <ComingSoonSheet
        visible={sheet === 'search'}
        icon="search"
        title={ChatCopy.profile.searchTitle}
        body={ChatCopy.profile.searchBody}
        onClose={() => setSheet(null)}
      />

      {/* Chat Theme coming soon */}
      <ComingSoonSheet
        visible={sheet === 'chatTheme'}
        icon="droplet"
        title={ChatCopy.profile.chatThemeTitle}
        body={ChatCopy.profile.chatThemeBody}
        onClose={() => setSheet(null)}
      />

      {/* Manage Storage coming soon */}
      <ComingSoonSheet
        visible={sheet === 'manageStorage'}
        icon="hard-drive"
        title={ChatCopy.profile.manageStorageTitle}
        body={ChatCopy.profile.manageStorageBody}
        onClose={() => setSheet(null)}
      />

      {/* Privacy coming soon */}
      <ComingSoonSheet
        visible={sheet === 'privacy'}
        icon="lock"
        title={ChatCopy.profile.privacyTitle}
        body={ChatCopy.profile.privacyBody}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
      <View>{children}</View>
    </View>
  );
}

function OptionRow({
  icon,
  label,
  onPress,
  destructive,
  disabled,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const tint = destructive ? Brand.destructiveRed : theme.text;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      style={({ pressed }: { pressed: boolean }) => [
        styles.row,
        { borderBottomColor: theme.divider },
        disabled && styles.rowDisabled,
        pressed && !disabled && { opacity: 0.65 },
      ]}>
      <Feather name={icon} size={18} color={tint} style={styles.rowIcon} />
      <ThemedText style={[styles.rowLabel, { color: tint }]}>{label}</ThemedText>
      <Feather name="chevron-right" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: Spacing.four,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
  },
  backCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Brand.profileBackCircle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    minHeight: 179,
    borderBottomLeftRadius: Radius.bubble,
    borderBottomRightRadius: Radius.bubble,
    paddingBottom: Spacing.four,
  },
  nameBlock: {
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    gap: 4,
    marginBottom: Spacing.two,
  },
  heroName: {
    fontSize: 20,
    fontWeight: FontWeight.semibold,
    color: '#EDEDED',
    letterSpacing: -0.4,
  },
  heroPhone: {
    fontSize: 14,
    fontWeight: FontWeight.regular,
    color: '#EDEDED',
    opacity: 0.78,
    letterSpacing: -0.1,
  },
  avatarRingWrap: {
    alignItems: 'center',
    marginTop: -64,
    marginBottom: 8,
  },
  avatarRing: {
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 3,
    borderColor: Brand.profileBackCircle,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.profileBg,
  },
  tileRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  listContent: {
    paddingBottom: Spacing.six,
  },
  section: {
    marginTop: Spacing.three,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 14,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowIcon: {
    width: 22,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: FontWeight.medium,
    letterSpacing: -0.15,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: FontWeight.semibold,
    color: '#EDEDED',
    letterSpacing: -0.3,
    marginTop: 6,
  },
  errorBody: {
    fontSize: 13,
    fontWeight: FontWeight.regular,
    color: 'rgba(237,237,237,0.6)',
    textAlign: 'center',
  },
});
