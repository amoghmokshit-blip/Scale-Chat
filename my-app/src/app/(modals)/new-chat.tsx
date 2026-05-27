import type { Contact as ApiContact } from '@scalechat/shared';
import { Feather } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ModalHeader } from '@/components/modal-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';
import { Avatar } from '@/features/chat/components/avatar';
import { ChatCopy } from '@/features/chat/copy';
import { useStartChat } from '@/features/chat/hooks/use-start-chat';
import { AlphaIndexBar } from '@/features/contacts/components/alpha-index-bar';
import { groupContactsByLetter } from '@/features/contacts/data/contact-sections';
import { useContacts } from '@/features/contacts/hooks/use-contacts';
import { useTheme } from '@/hooks/use-theme';

/**
 * Adapt @scalechat/shared Contact (server shape) to the local Avatar prop shape.
 * Avatar reads only id/avatarUri/(optional) tint+emoji; the rest is filler so the
 * type checks without us widening the Avatar API.
 */
function toAvatarContact(c: ApiContact) {
  return {
    id: c.id,
    displayName: c.displayName,
    phoneE164: c.phoneE164,
    avatarUri: c.avatarUri ?? undefined,
  };
}

export default function NewChatScreen() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  // Load every page so the A–Z index covers all contacts (search narrows it).
  const { contacts, loading } = useContacts({ search: query, all: true });
  const { startChat, creatingKey } = useStartChat();
  const listRef = useRef<SectionList<ApiContact, { title: string }>>(null);

  const searching = query.trim().length > 0;

  // While searching, show a single flat (header-less) section; otherwise the
  // alphabetically-grouped sections that drive the index bar.
  const sections = useMemo(
    () =>
      searching
        ? [{ title: '', data: contacts }]
        : groupContactsByLetter(contacts),
    [searching, contacts],
  );

  const letters = useMemo(() => sections.map((s) => s.title), [sections]);

  function jumpToLetter(letter: string) {
    const sectionIndex = sections.findIndex((s) => s.title === letter);
    if (sectionIndex < 0) return;
    try {
      listRef.current?.scrollToLocation({ sectionIndex, itemIndex: 0, viewPosition: 0 });
    } catch {
      // scrollToLocation can throw if the target is far outside the render
      // window; ignore — the next tap (now closer) succeeds.
    }
  }

  async function invite() {
    try {
      await Share.share({
        message: ChatCopy.invite.shareMessage(ChatCopy.invite.url),
        title: ChatCopy.invite.shareTitle,
      });
    } catch {
      // User dismissed the sheet, or sharing is unavailable — nothing to do.
    }
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ModalHeader title="New Chat" />

        <View style={[styles.search, { backgroundColor: theme.surfaceInput }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={ChatCopy.list.searchPlaceholder}
            placeholderTextColor={theme.inputPlaceholder}
            style={[styles.searchInput, { color: theme.text }]}
          />
        </View>

        <View style={styles.listWrap}>
          <SectionList
            ref={listRef}
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={!searching}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.one }} />}
            renderSectionHeader={({ section }) =>
              section.title ? (
                <ThemedView style={styles.sectionHeader}>
                  <ThemedText style={[styles.sectionHeaderText, { color: theme.textSecondary }]}>
                    {section.title}
                  </ThemedText>
                </ThemedView>
              ) : null
            }
            ListEmptyComponent={
              loading ? (
                <View style={styles.empty}>
                  <ActivityIndicator color={theme.text} />
                </View>
              ) : (
                <View style={styles.empty}>
                  <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                    {query
                      ? `No contacts match "${query}"`
                      : 'No contacts yet — add one from the menu.'}
                  </ThemedText>
                </View>
              )
            }
            ListFooterComponent={
              <Pressable
                onPress={invite}
                style={({ pressed }) => [
                  styles.invite,
                  { backgroundColor: Brand.accent },
                  pressed && { opacity: 0.85 },
                ]}>
                <Feather name="user-plus" size={16} color={Brand.accentText} />
                <ThemedText style={[styles.inviteLabel, { color: Brand.accentText }]}>
                  {ChatCopy.invite.button}
                </ThemedText>
              </Pressable>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() =>
                  startChat(
                    {
                      contactUserId: item.contactUserId ?? undefined,
                      phoneE164: item.phoneE164,
                      displayName: item.displayName,
                      avatarUri: item.avatarUri,
                    },
                    item.id,
                  )
                }
                disabled={creatingKey === item.id}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.surfaceMuted },
                  pressed && { opacity: 0.85 },
                  creatingKey === item.id && { opacity: 0.6 },
                ]}>
                <Avatar contact={toAvatarContact(item) as never} size={44} />
                <View style={styles.rowText}>
                  <ThemedText style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                    {item.displayName}
                  </ThemedText>
                  <ThemedText
                    style={[styles.phone, { color: theme.textSecondary }]}
                    numberOfLines={1}>
                    {item.phoneE164}
                  </ThemedText>
                </View>
                {creatingKey === item.id ? <ActivityIndicator color={theme.text} /> : null}
              </Pressable>
            )}
          />

          {/* A–Z fast-scroll index — hidden while searching (results are flat). */}
          {!searching && letters.length > 0 ? (
            <AlphaIndexBar letters={letters} onSelectLetter={jumpToLetter} />
          ) : null}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
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
  searchInput: {
    fontSize: 14,
    fontWeight: FontWeight.medium,
    paddingVertical: 0,
  },
  listWrap: { flex: 1 },
  list: {
    paddingHorizontal: Spacing.two,
    // Leave room on the right so rows don't sit under the A–Z index column.
    paddingRight: Spacing.three,
    paddingBottom: Spacing.four,
  },
  sectionHeader: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.half,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: FontWeight.bold,
  },
  empty: {
    paddingTop: Spacing.six,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
  },
  invite: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.three,
    marginHorizontal: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.pill,
  },
  inviteLabel: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.pill,
  },
  rowText: { flex: 1, gap: 2 },
  name: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
  },
  phone: {
    fontSize: 12,
  },
});
