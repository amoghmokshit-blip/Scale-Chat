import { Stack } from 'expo-router';

import { Brand } from '@/constants/theme';

export default function ChatLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Brand.chatBody },
        animation: 'slide_from_right',
      }}>
      {/* The forward picker is a modal sibling of [id]; declaring it here lets
          it slide up from the bottom while [id] stays mounted underneath, so
          dismissing returns to the source thread with its scroll/state intact. */}
      <Stack.Screen
        name="forward"
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      {/* Contact picker (Tranche 2.D) — same modal-sibling pattern as forward. */}
      <Stack.Screen
        name="pick-contact"
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </Stack>
  );
}
