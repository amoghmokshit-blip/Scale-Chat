import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ModalHeader } from '@/components/modal-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, FontWeight, Spacing } from '@/constants/theme';
import { ChatCopy } from '@/features/chat/copy';
import { chatRepository } from '@/features/chat/data';
import { useTheme } from '@/hooks/use-theme';

const MAX_OPTIONS = 10;
const MIN_OPTIONS = 2;
const MAX_QUESTION_LEN = 300;
const MAX_OPTION_LEN = 120;

/**
 * Compose poll screen (Tranche 2.F). Sibling modal of `chat/[id]`:
 *
 *   - Question text input (≤300 chars).
 *   - 2–10 option inputs with "+ Add option" affordance; rows beyond the
 *     2-minimum get a trash button to remove them.
 *   - "Allow multiple answers" switch (default OFF — BRD Q4 / WhatsApp parity).
 *   - Anonymous toggle is hidden in the 1-on-1 UI (BRD line 519 — zero value
 *     with 2 voters); the column exists for future Super Groups reuse.
 *
 * On submit: validate (≥2 non-empty unique options) → call
 * `chatRepository.createPoll` → `router.back()` to the source thread (which
 * stays mounted underneath the modal sibling, preserving scroll/state).
 */
export default function ComposePollScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiSelect, setMultiSelect] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function updateOption(index: number, value: string): void {
    setOptions((prev) => prev.map((opt, i) => (i === index ? value : opt)));
  }

  function addOption(): void {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((prev) => [...prev, '']);
  }

  function removeOption(index: number): void {
    if (options.length <= MIN_OPTIONS) return;
    setOptions((prev) => prev.filter((_, i) => i !== index));
  }

  const trimmedQuestion = question.trim();
  const trimmedOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
  const distinctLower = new Set(trimmedOptions.map((o) => o.toLowerCase()));
  const canSubmit =
    !submitting &&
    threadId != null &&
    trimmedQuestion.length > 0 &&
    trimmedOptions.length >= MIN_OPTIONS &&
    distinctLower.size === trimmedOptions.length;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit || !threadId) return;
    if (distinctLower.size !== trimmedOptions.length) {
      Alert.alert(ChatCopy.poll.duplicateOption);
      return;
    }
    const fn = chatRepository.createPoll;
    if (!fn) return;
    setSubmitting(true);
    try {
      await fn.call(chatRepository, {
        threadId,
        clientMessageId: `poll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        question: trimmedQuestion,
        options: trimmedOptions,
        multiSelect,
      });
      router.back();
    } catch {
      setSubmitting(false);
      Alert.alert('Could not create poll', 'Please try again.');
    }
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ModalHeader
          title={ChatCopy.poll.composerTitle}
          trailing={
            <Pressable
              onPress={() => void handleSubmit()}
              disabled={!canSubmit}
              hitSlop={8}
              style={({ pressed }: { pressed: boolean }) => [
                styles.cta,
                {
                  backgroundColor: canSubmit ? Brand.chatReadTick : theme.surfaceMuted,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <ThemedText
                style={[
                  styles.ctaLabel,
                  { color: canSubmit ? '#101012' : theme.textSecondary },
                ]}>
                {submitting ? ChatCopy.poll.creating : ChatCopy.poll.create}
              </ThemedText>
            </Pressable>
          }
        />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled">
            <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
              Question
            </ThemedText>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder={ChatCopy.poll.questionPlaceholder}
              placeholderTextColor={theme.textSecondary}
              multiline
              maxLength={MAX_QUESTION_LEN}
              style={[
                styles.input,
                styles.questionInput,
                { color: theme.text, backgroundColor: theme.surfaceMuted },
              ]}
            />

            <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
              Options
            </ThemedText>
            {options.map((value, i) => (
              <View key={i} style={styles.optionRow}>
                <TextInput
                  value={value}
                  onChangeText={(v: string) => updateOption(i, v)}
                  placeholder={ChatCopy.poll.optionPlaceholder(i + 1)}
                  placeholderTextColor={theme.textSecondary}
                  maxLength={MAX_OPTION_LEN}
                  style={[
                    styles.input,
                    styles.optionInput,
                    { color: theme.text, backgroundColor: theme.surfaceMuted },
                  ]}
                />
                {options.length > MIN_OPTIONS ? (
                  <Pressable
                    onPress={() => removeOption(i)}
                    hitSlop={8}
                    style={({ pressed }: { pressed: boolean }) => [
                      styles.removeBtn,
                      pressed && { opacity: 0.6 },
                    ]}
                    accessibilityLabel="Remove option">
                    <Feather name="x" size={18} color={theme.textSecondary} />
                  </Pressable>
                ) : null}
              </View>
            ))}

            {options.length < MAX_OPTIONS ? (
              <Pressable
                onPress={addOption}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.addRow,
                  pressed && { opacity: 0.7 },
                ]}>
                <Feather name="plus-circle" size={18} color={Brand.chatHeaderTop} />
                <ThemedText style={[styles.addLabel, { color: Brand.chatHeaderTop }]}>
                  {ChatCopy.poll.addOption}
                </ThemedText>
              </Pressable>
            ) : null}

            <View style={styles.switchRow}>
              <ThemedText style={[styles.switchLabel, { color: theme.text }]}>
                {ChatCopy.poll.multiSelectLabel}
              </ThemedText>
              <Switch
                value={multiSelect}
                onValueChange={setMultiSelect}
                trackColor={{ false: theme.surfaceMuted, true: Brand.chatHeaderTop }}
                thumbColor="#FFFFFF"
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  label: {
    fontSize: 12,
    fontWeight: FontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: Spacing.two,
  },
  input: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: FontWeight.regular,
  },
  questionInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionInput: {
    flex: 1,
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: Spacing.one,
  },
  addLabel: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: FontWeight.medium,
  },
  cta: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
  },
});
