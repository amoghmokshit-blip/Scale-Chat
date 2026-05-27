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
      {/* Poll composer (Tranche 2.F) — same modal-sibling pattern. Question +
          2–10 options + multi-select switch; submit calls `chatRepository.createPoll`. */}
      <Stack.Screen
        name="compose-poll"
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      {/* Calls (Tranche 2.I) — full-screen, gesture-locked so a swipe can't
          dismiss a live call. IncomingCall slides up; CallScreen fades in. */}
      <Stack.Screen
        name="incoming-call"
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }}
      />
      <Stack.Screen
        name="call"
        options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
      />
    </Stack>
  );
}
