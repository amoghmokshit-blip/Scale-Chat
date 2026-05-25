import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight } from '@/constants/theme';

import type { Message } from '../types';

type Action = {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  destructive?: boolean;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  message: Message | null;
  /** True when the bubble belongs to the current user. */
  isMine: boolean;
  onClose: () => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: () => void;
  /** When provided, a "Report" row is shown on counterpart bubbles (non-tombstones). */
  onReport?: () => void;
};

/**
 * Long-press action sheet for a message bubble. Mirrors WhatsApp behaviour:
 *   - Reply (always available, unless the source is a tombstone)
 *   - Copy text (text messages only, not tombstones)
 *   - Delete for everyone (sender-only, within the 60-min edit window the
 *     server enforces — the UI shows it on every mine-bubble and lets the
 *     server reject if expired; the alternative is duplicating the rule on
 *     the client, which would drift).
 *
 * Sheet appears as a centered, opaque card over a translucent backdrop —
 * matches the rest of the auth flow's modal style.
 */
export function MessageActionSheet({
  visible,
  message,
  isMine,
  onClose,
  onReply,
  onCopy,
  onDelete,
  onReport,
}: Props) {
  if (!message) return null;

  const isTombstone = message.deletedAt != null;
  const isText = message.type === 'text';

  const actions: Action[] = [];
  if (!isTombstone) {
    actions.push({ key: 'reply', label: 'Reply', icon: 'corner-up-left', onPress: onReply });
    if (isText) {
      actions.push({ key: 'copy', label: 'Copy', icon: 'copy', onPress: onCopy });
    }
  }
  if (isMine && !isTombstone) {
    actions.push({
      key: 'delete',
      label: 'Delete for everyone',
      icon: 'trash-2',
      destructive: true,
      onPress: onDelete,
    });
  }
  if (!isMine && !isTombstone && onReport) {
    actions.push({
      key: 'report',
      label: 'Report',
      icon: 'flag',
      destructive: true,
      onPress: onReport,
    });
  }
  if (actions.length === 0) {
    actions.push({ key: 'dismiss', label: 'Close', icon: 'x', onPress: onClose });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => undefined} style={styles.sheet}>
          {actions.map((a, i) => (
            <Pressable
              key={a.key}
              onPress={() => {
                a.onPress();
                onClose();
              }}
              style={({ pressed }: { pressed: boolean }) => [
                styles.row,
                i < actions.length - 1 && styles.rowDivider,
                pressed && { backgroundColor: 'rgba(255,255,255,0.06)' },
              ]}>
              <Feather
                name={a.icon}
                size={18}
                color={a.destructive ? '#FF5C5C' : Brand.chatComposerIcon}
                style={styles.icon}
              />
              <ThemedText
                style={[
                  styles.label,
                  a.destructive && { color: '#FF5C5C' },
                ]}>
                {a.label}
              </ThemedText>
            </Pressable>
          ))}
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
    paddingHorizontal: 32,
  },
  sheet: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#272727',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 14,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  icon: {
    width: 22,
  },
  label: {
    fontSize: 15,
    fontWeight: FontWeight.medium,
    color: '#EDEDED',
    letterSpacing: -0.15,
  },
});

// Cross-platform clipboard helper. expo-clipboard ships with SDK 56; if it isn't
// linked we degrade to a noop so a missing dep can't crash the action sheet.
export async function copyMessageText(m: Message): Promise<void> {
  if (m.type !== 'text' || m.deletedAt) return;
  try {
    const mod = await import('expo-clipboard').catch(() => null);
    if (mod && typeof mod.setStringAsync === 'function') {
      await mod.setStringAsync(m.text);
    }
  } catch {
    // best-effort — copy failing silently is better than crashing the screen
  }
}
