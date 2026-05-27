import type { CallKind } from '@scalechat/shared';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';

/**
 * Ensure mic (always) + camera (VIDEO only) permission is GRANTED before the
 * CallScreen mounts `<LiveKitRoom connect audio …>`.
 *
 * Why up-front: LiveKitRoom auto-publishes the mic on connect. On a first call
 * the OS RECORD_AUDIO dialog otherwise pops up *mid-connect*, and granting it
 * fires a mic-publish signal before the room has connected — LiveKit throws
 * "cannot send signal request before connected" and the CallScreen bounces.
 * Pre-granting removes the mid-connect dialog so the connect runs clean.
 *
 * Same OS-level permissions LiveKit needs (Android RECORD_AUDIO / CAMERA, iOS
 * NSMicrophone/NSCamera), so one grant satisfies both. Already-granted resolves
 * immediately with no dialog (idempotent). Reuses the app's existing APIs:
 * `expo-audio` (voice-recorder-overlay) + `expo-image-picker` (camera attach).
 */
export async function ensureCallPermissions(kind: CallKind): Promise<boolean> {
  const mic = await requestRecordingPermissionsAsync();
  if (!mic.granted) return false;
  if (kind === 'VIDEO') {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (cam.status !== 'granted') return false;
  }
  return true;
}
