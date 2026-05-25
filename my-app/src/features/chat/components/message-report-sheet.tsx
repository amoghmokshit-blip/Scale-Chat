import { Feather } from '@expo/vector-icons';
import type { ReportReason } from '@scalechat/shared';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight, Radius, Spacing } from '@/constants/theme';

type Reason = {
  key: ReportReason;
  label: string;
  body: string;
};

const REASONS: Reason[] = [
  { key: 'SPAM', label: 'Spam', body: 'Repeated unsolicited or promotional messages.' },
  { key: 'HARASSMENT', label: 'Harassment', body: 'Threats, bullying, or unwanted contact.' },
  {
    key: 'INAPPROPRIATE_CONTENT',
    label: 'Inappropriate content',
    body: 'Sexual, violent, or disturbing material.',
  },
  {
    key: 'IMPERSONATION',
    label: 'Impersonation',
    body: 'Pretending to be someone they are not.',
  },
  { key: 'OTHER', label: 'Something else', body: 'Anything not covered above.' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (reason: ReportReason) => Promise<void> | void;
  /** Display name of the counterpart whose message is being reported (informational). */
  counterpartName?: string;
};

/**
 * Pick-a-reason modal for reporting a counterpart's message. Submitting
 * sends the report through `chatRepository.reportMessage`; the row never
 * broadcasts back to chat sockets.
 *
 * Two states: picking + submitting + thank-you. We swap the sheet body so
 * the user always knows the report landed.
 */
export function MessageReportSheet({ visible, onClose, onSubmit, counterpartName }: Props) {
  const [stage, setStage] = useState<'pick' | 'submitting' | 'done' | 'error'>('pick');
  const [errorCode, setErrorCode] = useState<string | null>(null);

  function close() {
    onClose();
    // Reset for next open after a frame so the user doesn't see the stage flip
    // mid-dismiss animation.
    setTimeout(() => {
      setStage('pick');
      setErrorCode(null);
    }, 200);
  }

  async function pick(reason: ReportReason) {
    setStage('submitting');
    setErrorCode(null);
    try {
      await onSubmit(reason);
      setStage('done');
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setStage('error');
      setErrorCode(code ?? null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          {stage === 'pick' ? (
            <>
              <ThemedText style={styles.title}>
                {counterpartName ? `Report ${counterpartName}'s message?` : 'Report this message?'}
              </ThemedText>
              <ThemedText style={styles.body}>
                Your report stays private. Our moderation team will review the message — the sender
                is never told you reported them.
              </ThemedText>
              <View style={styles.reasons}>
                {REASONS.map((r, i) => (
                  <Pressable
                    key={r.key}
                    onPress={() => void pick(r.key)}
                    style={({ pressed }: { pressed: boolean }) => [
                      styles.reasonRow,
                      i < REASONS.length - 1 && styles.reasonDivider,
                      pressed && { backgroundColor: 'rgba(255,255,255,0.06)' },
                    ]}>
                    <View style={styles.reasonText}>
                      <ThemedText style={styles.reasonLabel}>{r.label}</ThemedText>
                      <ThemedText style={styles.reasonBody}>{r.body}</ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color="rgba(237,237,237,0.55)" />
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={close} style={styles.cancel}>
                <ThemedText style={styles.cancelLabel}>Cancel</ThemedText>
              </Pressable>
            </>
          ) : stage === 'submitting' ? (
            <View style={styles.statusBlock}>
              <ThemedText style={styles.title}>Sending report…</ThemedText>
            </View>
          ) : stage === 'done' ? (
            <View style={styles.statusBlock}>
              <View style={styles.successDot}>
                <Feather name="check" size={20} color={Brand.accentText} />
              </View>
              <ThemedText style={styles.title}>Report received</ThemedText>
              <ThemedText style={styles.body}>
                Thank you — our team will review the message. You can block this contact from the
                conversation overflow menu if you don't want to hear from them again.
              </ThemedText>
              <Pressable onPress={close} style={styles.cta}>
                <ThemedText style={styles.ctaLabel}>Done</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.statusBlock}>
              <ThemedText style={styles.title}>Couldn't send report</ThemedText>
              <ThemedText style={styles.body}>
                {errorCode === 'already_reported'
                  ? 'You have already reported this message for that reason.'
                  : 'Something went wrong on our side. Please try again in a moment.'}
              </ThemedText>
              <Pressable onPress={close} style={styles.cta}>
                <ThemedText style={styles.ctaLabel}>Close</ThemedText>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#272727',
    borderRadius: 22,
    paddingTop: Spacing.three + 4,
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.three + 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: FontWeight.semibold,
    color: '#EDEDED',
    letterSpacing: -0.25,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 13,
    fontWeight: FontWeight.regular,
    color: 'rgba(237,237,237,0.72)',
    lineHeight: 19,
    textAlign: 'center',
  },
  reasons: {
    marginTop: Spacing.three,
    backgroundColor: '#1F1F1F',
    borderRadius: 14,
    overflow: 'hidden',
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  reasonDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  reasonText: {
    flex: 1,
  },
  reasonLabel: {
    fontSize: 14,
    fontWeight: FontWeight.semibold,
    color: '#EDEDED',
    letterSpacing: -0.15,
    marginBottom: 2,
  },
  reasonBody: {
    fontSize: 12,
    fontWeight: FontWeight.regular,
    color: 'rgba(237,237,237,0.55)',
    lineHeight: 16,
  },
  cancel: {
    marginTop: Spacing.three,
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelLabel: {
    fontSize: 14,
    fontWeight: FontWeight.medium,
    color: 'rgba(237,237,237,0.6)',
  },
  statusBlock: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  successDot: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  cta: {
    marginTop: Spacing.three,
    alignSelf: 'stretch',
    backgroundColor: Brand.accent,
    borderRadius: Radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ctaLabel: {
    fontSize: 15,
    fontWeight: FontWeight.semibold,
    color: Brand.accentText,
    letterSpacing: -0.15,
  },
});
