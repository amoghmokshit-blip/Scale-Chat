import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { chatRepository } from '../data';
import type { CreateOneOnOneArgs } from '../data/chat-repository';

/**
 * Open-or-create a 1-on-1 chat and navigate into the thread. Shared by the
 * New Chat picker and the Add-from-Contacts screen so the "tap a person →
 * land in the chat" behaviour lives in one place (and goes through the
 * repository, so it works under both `EXPO_PUBLIC_USE_MOCKS` modes).
 *
 * `creatingKey` is the caller-supplied key of the row currently being opened
 * (contact id, phone, …) so a list can show a spinner on just that row and
 * ignore further taps while a create is in flight.
 */
export function useStartChat(): {
  startChat: (args: CreateOneOnOneArgs, key: string) => Promise<void>;
  creatingKey: string | null;
} {
  const router = useRouter();
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  async function startChat(args: CreateOneOnOneArgs, key: string): Promise<void> {
    if (creatingKey) return;
    setCreatingKey(key);
    try {
      const { chatId } = await chatRepository.createOneOnOne(args);
      router.replace({ pathname: '/chat/[id]', params: { id: chatId } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open chat.';
      Alert.alert('New chat', message);
    } finally {
      setCreatingKey(null);
    }
  }

  return { startChat, creatingKey };
}
