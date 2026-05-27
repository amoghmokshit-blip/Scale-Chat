import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { chatRepository } from '@/features/chat/data';

/**
 * Push wakeup (Tranche 2.I). Foreground notifications still surface (so a call
 * push is seen even with the app open), and we register the device's Expo push
 * token so the backend can wake a backgrounded callee on `call:ring`.
 *
 * Best-effort throughout: if permissions are denied or registration fails, the
 * socket `call:ring` still rings online/foregrounded devices.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushAsync(): Promise<void> {
  try {
    // High-importance Android channel so a call push rings on the lock screen.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('calls', {
        name: 'Calls',
        importance: Notifications.AndroidImportance.MAX,
        // Omit `sound` → use the system default ringtone. Passing the literal
        // 'default' expects a bundled sound asset of that name and warns.
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    const projectId = (
      Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
    )?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

    await chatRepository.registerPushToken?.(token.data, Platform.OS === 'ios' ? 'IOS' : 'ANDROID');
  } catch {
    // best-effort — calls still ring via socket when foregrounded.
  }
}
