import { useRouter } from 'expo-router';
import type { RefObject } from 'react';
import type { View as ViewType } from 'react-native';

import { PopoverMenu } from '@/components/menu/popover-menu';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  anchorRef: RefObject<ViewType | null>;
};

/** "+" header menu — Figma "Plus Icon Section" variant. */
export function NewChatMenu({ visible, onDismiss, anchorRef }: Props) {
  const router = useRouter();
  return (
    <PopoverMenu
      visible={visible}
      onDismiss={onDismiss}
      anchorRef={anchorRef}
      placement="bottom-right"
      width={208}
      items={[
        {
          key: 'new-chat',
          label: 'New Chat',
          icon: 'message-circle',
          onPress: () => router.push('/new-chat'),
        },
        {
          key: 'create-group',
          label: 'Create Group',
          icon: 'users',
          onPress: () => router.push('/create-group'),
        },
        {
          key: 'add-contact',
          label: 'Add Contact',
          icon: 'user-plus',
          // Phonebook sync is the primary path (WhatsApp-style); the import
          // screen links to manual add for the rare case the user wants it.
          onPress: () => router.push('/import-contacts'),
        },
        {
          key: 'create-super-group',
          label: 'Create Super Group',
          icon: 'shield',
          onPress: () => router.push('/create-super-group'),
        },
      ]}
    />
  );
}
