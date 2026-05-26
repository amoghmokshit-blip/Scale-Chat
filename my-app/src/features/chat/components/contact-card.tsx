import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';

import { formatIndianMobile, localDigitsFromE164 } from '@/lib/phone';

import { ChatCopy } from '../copy';
import type { ContactCardMessage } from '../types';
import { cardAccent, InfoCardBubble } from './info-card-bubble';

type Props = {
  message: ContactCardMessage;
  isMine: boolean;
};

/**
 * Shared-contact card (Tranche 2.D). Person icon + name + the number formatted
 * for display (E.164 is stored/sent, but `+91 98765 43210` is shown). Tap →
 * `tel:` dialer. Renders INSIDE the standard bubble (inherits chrome).
 */
export function ContactCard({ message, isMine }: Props) {
  const e164 = message.contactPhoneE164;
  // Display the +91 numbers in the friendly local format; show other countries' E.164 as-is.
  const display = e164.startsWith('+91') ? formatIndianMobile(localDigitsFromE164(e164)) : e164;
  const canCall = e164.length > 0;

  return (
    <InfoCardBubble
      isMine={isMine}
      leading={<MaterialCommunityIcons name="account" size={24} color={cardAccent(isMine)} />}
      title={message.contactName || ChatCopy.contact.bubbleFallback}
      subtitle={display}
      onPress={canCall ? () => void Linking.openURL(`tel:${e164}`) : undefined}
    />
  );
}
