import { Feather } from '@expo/vector-icons';
import type { UserProfileCard } from '@scalechat/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Avatar } from '@/features/chat/components/avatar';
import { ComingSoonSheet } from '@/features/chat/components/coming-soon-sheet';
import { ChatCopy } from '@/features/chat/copy';
import { chatRepository } from '@/features/chat/data';
import { useTheme } from '@/hooks/use-theme';
import { formatIndianMobile, localDigitsFromE164 } from '@/lib/phone';

function formatProfilePhone(e164: string): string {
  return formatIndianMobile(localDigitsFromE164(e164));
}

import type { Contact as ChatContact } from '@/features/chat/types';

type SheetKind = 'voiceCall' | 'videoCall' | 'chatTheme' | 'mediaGallery' | null;

/**
 * Contact Profile screen — BRD §3.3 (unsubscribed) / §3.4 (subscribed premium).
 *
 * Pushed from:
 *   - chat thread header avatar tap → `/contact/<counterpartUserId>`
 *   - (future) contact row in `/new-chat` or directory views
 *
 * Sections (top → bottom, per Figma `1:6560` / `1:6666`):
 *   1. Hero — avatar + name + phone
 *   2. Voice Call / Video Call CTAs (open Coming-Soon, free per BRD §4.19)
 *   3. Options list (Media Links & Docs / Chat Theme / Encryption / Contact Details)
 *   4. Common Groups (empty state until groups ship)
 *   5. Premium-only "Add in Super Group" tile (gated on `useAuth().currentUser.isPremium`)
 *   6. Destructive footer (Block contact / Report contact — wiring in Phase C / Phase A)
 *
 * Privacy: the screen never renders before the backend `/users/:id/profile-card`
 * resolves so we don't paint stale or fabricated PII. On 403 (`profile_not_visible`)
 * the screen shows an empty state with a back link rather than a fake card.
 */
export default function ContactProfileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { currentUser } = useAuth();

  const [card, setCard] = useState<UserProfileCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [showEncryption, setShowEncryption] = useState(false);

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

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const handleOpenChat = () => {
    if (!card?.commonChatId) return;
    router.replace({ pathname: '/chat/[id]', params: { id: card.commonChatId } });
  };

  const isPremium = currentUser?.isPremium === true;

  // Local block state shadows `card.isBlocked` so optimistic toggles don't
  // require a profile-card refetch. Synced from `card` whenever it updates.
  const [isBlocked, setIsBlocked] = useState<boolean>(card?.isBlocked ?? false);
  useEffect(() => {
    if (card) setIsBlocked(card.isBlocked);
  }, [card]);

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
            // Optimistic flip; revert on failure.
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

  // F1 (2026-05-25 verify): the hero + section list lived as sibling ScrollView
  // children before — that pattern triggered an RN 0.85 Fabric layout bug where
  // the first section's children were measured with negative height after warm
  // re-entry, hiding Encryption / Chat Theme / Media gallery from any tap.
  // Folding everything into one FlatList (hero as ListHeaderComponent, sections
  // as data items) keeps the measurement chain on the same node and the bug
  // doesn't repro. Repro path: open profile → scroll → re-enter → CONVERSATION gone.
  // See `docs/progress/1-on-1-production.md` → Phase B emulator verification.
  //
  // NOTE: this useMemo MUST sit above the loading / error early-returns so the
  // hook count stays stable across re-renders (rules-of-hooks).
  type SectionItem = { key: string; render: () => React.ReactElement };
  const sectionsData = useMemo<SectionItem[]>(() => {
    if (!card) return [];
    const items: SectionItem[] = [
      {
        key: 'conversation',
        render: () => (
          <Section title="Conversation">
            <OptionRow
              icon="image"
              label="Media & Voice"
              onPress={() =>
                card.commonChatId
                  ? router.push({
                      pathname: '/contact/[id]/media',
                      params: { id: card.id, chatId: card.commonChatId },
                    })
                  : setSheet('mediaGallery')
              }
              hint={card.commonChatId ? 'View' : 'Start a chat to share media'}
            />
            <OptionRow
              icon="droplet"
              label="Chat Theme"
              onPress={() => setSheet('chatTheme')}
              hint="Default"
            />
            <OptionRow
              icon="lock"
              label="Encryption"
              onPress={() => setShowEncryption(true)}
              hint="In transit"
            />
          </Section>
        ),
      },
      {
        key: 'contact-details',
        render: () => (
          <Section title="Contact details">
            <DetailRow icon="phone" label="Phone" value={formatProfilePhone(card.phoneE164)} />
            <DetailRow
              icon="calendar"
              label="On ScaleChat since"
              value={new Date(card.createdAt).toLocaleDateString('en-IN', {
                month: 'short',
                year: 'numeric',
              })}
            />
          </Section>
        ),
      },
      {
        key: 'common-groups',
        render: () => (
          <Section title="Groups in common">
            <EmptyRow label="No groups in common yet" />
          </Section>
        ),
      },
    ];

    if (isPremium) {
      items.push({
        key: 'premium-options',
        render: () => (
          <Section title="Premium options">
            <OptionRow
              icon="users"
              label="Add to Super Group"
              hint="Network owner only"
              onPress={() => setSheet('chatTheme')}
            />
          </Section>
        ),
      });
    }

    items.push({
      key: 'destructive-footer',
      render: () => (
        <Section>
          <OptionRow
            icon="slash"
            label={isBlocked ? 'Unblock contact' : 'Block contact'}
            destructive
            hint={isBlocked ? 'Currently blocked' : ''}
            onPress={() => void handleToggleBlock()}
          />
          <OptionRow
            icon="flag"
            label="Report contact"
            destructive
            hint="Long-press a message to report"
            onPress={() => setSheet('chatTheme')}
          />
        </Section>
      ),
    });

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, isPremium, router, isBlocked]);

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <StatusBar backgroundColor={Brand.chatHeaderTop} barStyle="light-content" />
        <View style={styles.center}>
          <ActivityIndicator color={theme.text} />
        </View>
      </View>
    );
  }

  if (error || !card) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <SafeAreaView edges={['top']}>
          <View style={styles.topBar}>
            <Pressable onPress={handleBack} hitSlop={8} style={styles.iconBtn}>
              <Feather name="arrow-left" size={20} color={theme.text} />
            </Pressable>
          </View>
        </SafeAreaView>
        <View style={styles.center}>
          <Feather name="lock" size={36} color={theme.textSecondary} />
          <ThemedText style={[styles.errorTitle, { color: theme.text }]}>
            Profile unavailable
          </ThemedText>
          <ThemedText style={[styles.errorBody, { color: theme.textSecondary }]}>
            {error?.message ?? 'Could not load profile.'}
          </ThemedText>
        </View>
      </View>
    );
  }

  // Synthesise a chat-Contact for the Avatar component (it expects that shape).
  const avatarContact: ChatContact = {
    id: card.id,
    displayName: card.fullName,
    avatarUri: card.avatarUri ?? undefined,
    phoneE164: card.phoneE164,
  };

  const Hero = (
    <View style={[styles.hero, { backgroundColor: theme.headerCard }]}>
      <SafeAreaView edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={handleBack} hitSlop={8} style={styles.iconBtn}>
            <Feather name="arrow-left" size={20} color={theme.headerCardText} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {card.commonChatId ? (
            <Pressable onPress={handleOpenChat} hitSlop={8} style={styles.iconBtn}>
              <Feather name="message-circle" size={20} color={theme.headerCardText} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.heroBody}>
          <Avatar contact={avatarContact} size={104} />
          <ThemedText style={[styles.heroName, { color: theme.headerCardText }]}>
            {card.fullName}
          </ThemedText>
          <ThemedText
            style={[styles.heroPhone, { color: theme.headerCardText, opacity: 0.82 }]}>
            {formatProfilePhone(card.phoneE164)}
          </ThemedText>
          {card.bio ? (
            <ThemedText
              style={[styles.heroBio, { color: theme.headerCardText, opacity: 0.78 }]}>
              {card.bio}
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.callRow}>
          <CallButton icon="phone" label="Voice Call" onPress={() => setSheet('voiceCall')} />
          <CallButton icon="video" label="Video Call" onPress={() => setSheet('videoCall')} />
        </View>
      </SafeAreaView>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar backgroundColor={Brand.chatHeaderTop} barStyle="light-content" />

      <FlatList
        data={sectionsData}
        keyExtractor={(item: SectionItem) => item.key}
        renderItem={({ item }: { item: SectionItem }) => item.render()}
        ListHeaderComponent={Hero}
        contentContainerStyle={{ paddingBottom: Spacing.six }}
        showsVerticalScrollIndicator={false}
      />

      <ComingSoonSheet
        visible={sheet === 'voiceCall' || sheet === 'videoCall'}
        icon={sheet === 'videoCall' ? 'video' : 'phone'}
        title={
          sheet === 'voiceCall'
            ? ChatCopy.comingSoon.voiceCall.title
            : ChatCopy.comingSoon.videoCall.title
        }
        body={
          sheet === 'voiceCall'
            ? ChatCopy.comingSoon.voiceCall.body
            : ChatCopy.comingSoon.videoCall.body
        }
        footnote={
          sheet === 'voiceCall'
            ? ChatCopy.comingSoon.voiceCall.footnote
            : ChatCopy.comingSoon.videoCall.footnote
        }
        onClose={() => setSheet(null)}
      />

      <ComingSoonSheet
        visible={sheet === 'chatTheme'}
        icon="droplet"
        title={ChatCopy.comingSoon.chatTheme.title}
        body={ChatCopy.comingSoon.chatTheme.body}
        onClose={() => setSheet(null)}
      />

      <ComingSoonSheet
        visible={sheet === 'mediaGallery'}
        icon="image"
        title="No shared media yet"
        body="Start a chat with this contact to share photos and voice notes — they'll appear here."
        onClose={() => setSheet(null)}
      />

      <ComingSoonSheet
        visible={showEncryption}
        icon="lock"
        title="Messages secured in transit"
        body="ScaleChat uses TLS to protect every message and call setup between your device and our servers. End-to-end encryption between devices ships in a later release."
        onClose={() => setShowEncryption(false)}
      />
    </View>
  );
}

// ─── Sub-components (kept in-file so the screen is one diff to scan) ─────────

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: theme.backgroundElement }]}>
      {title ? (
        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          {title.toUpperCase()}
        </ThemedText>
      ) : null}
      <View>{children}</View>
    </View>
  );
}

function OptionRow({
  icon,
  label,
  hint,
  onPress,
  destructive,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  hint?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const tint = destructive ? '#FF5C5C' : theme.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => [
        styles.row,
        { borderBottomColor: theme.divider },
        pressed && { opacity: 0.65 },
      ]}>
      <Feather name={icon} size={18} color={tint} style={styles.rowIcon} />
      <ThemedText style={[styles.rowLabel, { color: tint }]}>{label}</ThemedText>
      {hint ? (
        <ThemedText style={[styles.rowHint, { color: theme.textSecondary }]}>{hint}</ThemedText>
      ) : null}
      <Feather name="chevron-right" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.divider }]}>
      <Feather name={icon} size={18} color={theme.textSecondary} style={styles.rowIcon} />
      <View style={{ flex: 1 }}>
        <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
        <ThemedText style={[styles.detailValue, { color: theme.text }]}>{value}</ThemedText>
      </View>
    </View>
  );
}

function EmptyRow({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <ThemedText style={[styles.rowLabel, { color: theme.textSecondary, fontStyle: 'italic' }]}>
        {label}
      </ThemedText>
    </View>
  );
}

function CallButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => [
        styles.callBtn,
        pressed && { opacity: 0.85 },
      ]}>
      <Feather name={icon} size={16} color={Brand.chatActionLimeText} />
      <ThemedText style={styles.callLabel}>{label}</ThemedText>
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
    paddingHorizontal: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    borderBottomLeftRadius: Radius.cardLg,
    borderBottomRightRadius: Radius.cardLg,
    paddingBottom: Spacing.three,
  },
  heroBody: {
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: 6,
  },
  heroName: {
    fontSize: 22,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.5,
    marginTop: Spacing.two + 4,
  },
  heroPhone: {
    fontSize: 14,
    fontWeight: FontWeight.regular,
    letterSpacing: -0.1,
  },
  heroBio: {
    fontSize: 13,
    fontWeight: FontWeight.regular,
    letterSpacing: -0.1,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: Spacing.three,
  },
  callRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  callBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Brand.chatActionLime,
    borderRadius: Radius.pill,
    paddingVertical: 12,
  },
  callLabel: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: Brand.chatActionLimeText,
    letterSpacing: -0.15,
  },
  section: {
    marginTop: Spacing.three,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.card,
    overflow: 'hidden',
    paddingTop: Spacing.two,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.6,
    paddingHorizontal: Spacing.three,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 14,
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
  rowHint: {
    fontSize: 13,
    fontWeight: FontWeight.regular,
    marginRight: 4,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: FontWeight.regular,
    marginBottom: 2,
    letterSpacing: -0.05,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: FontWeight.medium,
    letterSpacing: -0.15,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.3,
    marginTop: 6,
  },
  errorBody: {
    fontSize: 13,
    fontWeight: FontWeight.regular,
    textAlign: 'center',
  },
});
