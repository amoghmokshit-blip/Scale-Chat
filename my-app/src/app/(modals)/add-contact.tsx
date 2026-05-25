import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ModalHeader } from '@/components/modal-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FontWeight, Radius, Spacing } from '@/constants/theme';
import { PillButton } from '@/features/auth/components/pill-button';
import { PillInput } from '@/features/auth/components/pill-input';
import { contactsRepository } from '@/features/contacts/data';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';
import { isValidIndianMobile, toE164India } from '@/lib/phone';

export default function AddContactScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const phoneValid = isValidIndianMobile(phone);
  const canSave = name.trim().length >= 2 && phoneValid && !saving;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ModalHeader title="Add Contact" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.body}>
          <View style={styles.fields}>
            {/*
              Pick-from-phonebook entry — the "import N matched contacts at
              once" shortcut. Sits above the manual form so users see it
              first; manual entry stays available below for off-platform
              numbers users want to track manually.
            */}
            <Pressable
              onPress={() => router.push('/import-contacts')}
              accessibilityLabel="Pick contacts from your phonebook"
              style={({ pressed }) => [
                styles.phonebookRow,
                { backgroundColor: theme.surfaceMuted },
                pressed && { opacity: 0.85 },
              ]}>
              <View style={[styles.phonebookIcon, { backgroundColor: theme.surfaceInput }]}>
                <Feather name="book-open" size={18} color={theme.text} />
              </View>
              <View style={styles.phonebookText}>
                <ThemedText style={[styles.phonebookTitle, { color: theme.text }]}>
                  Pick from phonebook
                </ThemedText>
                <ThemedText
                  style={[styles.phonebookSubtitle, { color: theme.textSecondary }]}
                  numberOfLines={2}>
                  Find friends already on ScaleChat
                </ThemedText>
              </View>
              <Feather name="chevron-right" size={18} color={theme.textSecondary} />
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: theme.surfaceMuted }]} />
              <ThemedText style={[styles.dividerLabel, { color: theme.textSecondary }]}>
                or add manually
              </ThemedText>
              <View style={[styles.dividerLine, { backgroundColor: theme.surfaceMuted }]} />
            </View>

            <PillInput
              value={name}
              onChangeText={setName}
              placeholder="Display name"
              autoCapitalize="words"
              returnKeyType="next"
            />
            <PillInput
              value={phone}
              onChangeText={setPhone}
              placeholder="98765 43210"
              prefix="+91"
              keyboardType="phone-pad"
              maxLength={12}
            />
          </View>

          <PillButton
            label={saving ? 'Saving…' : 'Save Contact'}
            disabled={!canSave}
            loading={saving}
            onPress={async () => {
              const e164 = toE164India(phone);
              if (!e164) return;
              setSaving(true);
              try {
                await contactsRepository.add({ phoneE164: e164, displayName: name.trim() });
                Alert.alert('Contact saved', `${name.trim()} · ${e164}`, [
                  { text: 'OK', onPress: () => router.back() },
                ]);
              } catch (err) {
                const msg = err instanceof ApiError ? err.message : 'Could not save contact.';
                Alert.alert("Couldn't save", msg);
              } finally {
                setSaving(false);
              }
            }}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
    justifyContent: 'space-between',
  },
  fields: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  phonebookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.cardLg,
  },
  phonebookIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phonebookText: {
    flex: 1,
    gap: 2,
  },
  phonebookTitle: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
  },
  phonebookSubtitle: {
    fontSize: 12,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerLabel: {
    fontSize: 11,
    fontWeight: FontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
