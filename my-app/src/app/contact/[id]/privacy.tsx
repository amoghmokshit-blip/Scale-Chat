import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';
import { ComingSoonSheet } from '@/features/chat/components/coming-soon-sheet';
import { ChatCopy } from '@/features/chat/copy';
import { chatRepository } from '@/features/chat/data';
import { useTheme } from '@/hooks/use-theme';

/**
 * Privacy sub-screen — reached from Contact Profile → Privacy row.
 *
 * Params: id (target userId), contactName, isBlocked ('true'|'false').
 *
 * Groups three affordances in a single card:
 *   1. Encryption info → ComingSoonSheet (messages secured in transit)
 *   2. Disappearing messages → disabled placeholder (Coming soon)
 *   3. Block / Unblock → optimistic toggle with confirm Alert + revert on failure
 *
 * Block state is owned locally; the parent re-fetches via useFocusEffect on
 * return so its own label stays in sync without prop-drilling.
 */
export default function PrivacyScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    id?: string;
    contactName?: string;
    isBlocked?: string;
  }>();

  const contactId = params.id ?? '';
  const contactName = params.contactName ?? 'this contact';
  const [isBlocked, setIsBlocked] = useState<boolean>(params.isBlocked === 'true');
  const [encryptionSheetOpen, setEncryptionSheetOpen] = useState(false);

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  async function handleToggleBlock() {
    const next = !isBlocked;
    const title = next
      ? ChatCopy.privacy.blockAlertTitle(contactName)
      : ChatCopy.privacy.unblockAlertTitle(contactName);
    const body = next ? ChatCopy.privacy.blockAlertBody : ChatCopy.privacy.unblockAlertBody;
    const verb = next ? ChatCopy.privacy.blockLabel : ChatCopy.privacy.unblockLabel;

    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: verb,
        style: next ? 'destructive' : 'default',
        onPress: async () => {
          const fn = next ? chatRepository.blockUser : chatRepository.unblockUser;
          if (!fn) return;
          setIsBlocked(next);
          try {
            await fn.call(chatRepository, contactId);
          } catch {
            setIsBlocked(!next);
            Alert.alert(
              next ? ChatCopy.privacy.blockFailed : ChatCopy.privacy.unblockFailed,
              '',
            );
          }
        },
      },
    ]);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar backgroundColor={Brand.chatHeaderTop} barStyle="light-content" />

      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: theme.headerCard }}>
        <View style={styles.topBar}>
          <Pressable onPress={handleBack} hitSlop={8} style={styles.iconBtn}>
            <Feather name="arrow-left" size={20} color={theme.headerCardText} />
          </Pressable>
          <ThemedText style={[styles.screenTitle, { color: theme.headerCardText }]}>
            {ChatCopy.privacy.screenTitle}
          </ThemedText>
        </View>
      </SafeAreaView>

      {/* Privacy rows card */}
      <View style={styles.scrollArea}>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <PrivacyRow
            icon="lock"
            label={ChatCopy.privacy.encryptionLabel}
            hint={ChatCopy.privacy.encryptionHint}
            onPress={() => setEncryptionSheetOpen(true)}
          />
          <PrivacyRow
            icon="clock"
            label={ChatCopy.privacy.disappearingLabel}
            hint={ChatCopy.privacy.disappearingHint}
            disabled
          />
          <PrivacyRow
            icon="slash"
            label={isBlocked ? ChatCopy.privacy.unblockLabel : ChatCopy.privacy.blockLabel}
            hint={isBlocked ? ChatCopy.privacy.blockedHint : ChatCopy.privacy.blockHint}
            destructive
            onPress={() => void handleToggleBlock()}
            isLast
          />
        </View>
      </View>

      {/* Encryption info sheet */}
      <ComingSoonSheet
        visible={encryptionSheetOpen}
        icon="lock"
        title={ChatCopy.privacy.encryptionTitle}
        body={ChatCopy.privacy.encryptionBody}
        onClose={() => setEncryptionSheetOpen(false)}
      />
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function PrivacyRow({
  icon,
  label,
  hint,
  onPress,
  destructive,
  disabled,
  isLast,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  hint?: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  isLast?: boolean;
}) {
  const theme = useTheme();
  const tint = destructive ? Brand.destructiveRed : theme.text;
  const hintColor = theme.textSecondary;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      style={({ pressed }: { pressed: boolean }) => [
        styles.row,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
        disabled && styles.rowDisabled,
        pressed && !disabled && { opacity: 0.65 },
      ]}>
      <Feather name={icon} size={18} color={tint} style={styles.rowIcon} />
      <View style={styles.rowTextBlock}>
        <ThemedText style={[styles.rowLabel, { color: tint }]}>{label}</ThemedText>
        {hint ? (
          <ThemedText style={[styles.rowHint, { color: hintColor }]}>{hint}</ThemedText>
        ) : null}
      </View>
      {!disabled ? (
        <Feather name="chevron-right" size={18} color={theme.textSecondary} />
      ) : null}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
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
  screenTitle: {
    fontSize: 17,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.25,
  },
  scrollArea: {
    flex: 1,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  card: {
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    gap: 14,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowIcon: {
    width: 22,
  },
  rowTextBlock: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: FontWeight.medium,
    letterSpacing: -0.15,
  },
  rowHint: {
    fontSize: 12,
    fontWeight: FontWeight.regular,
    letterSpacing: -0.1,
  },
});
