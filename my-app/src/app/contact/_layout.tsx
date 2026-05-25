import { Stack } from 'expo-router';

/**
 * Stack for the Contact Profile screens (BRD §3.3 / §3.4).
 *
 * Pushed from the Chat thread header avatar tap and from contact rows in the
 * Contact Page. Lives outside the tab bar so back-swipe pops to the chat.
 */
export default function ContactLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    />
  );
}
