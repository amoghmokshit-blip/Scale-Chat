import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, FontWeight } from '@/constants/theme';

import { ChatCopy } from '../copy';
import type { LocationMessage } from '../types';

type Props = {
  message: LocationMessage;
  isMine: boolean;
};

/**
 * Location message (Tranche 2.D) — a deliberate TILE (not a text row): a
 * faux-map gradient band with a pin, the reverse-geocoded place name, and an
 * "Open in Maps" affordance. No real map (defers react-native-maps + the
 * Google Maps API key); tap opens a universal Google Maps URL (works on iOS +
 * Android, unlike the Android-only `geo:` scheme).
 */
export function LocationCard({ message, isMine }: Props) {
  const { latitude, longitude } = message;
  const hasCoords =
    Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
  const name = message.locationName || ChatCopy.location.bubbleFallback;

  function open() {
    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    void Linking.openURL(url);
  }

  return (
    <Pressable
      onPress={hasCoords ? open : undefined}
      disabled={!hasCoords}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`Location: ${name}`}>
      <LinearGradient
        colors={['#3C5A78', '#26313F']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.mapBand}>
        <View style={styles.pinDisc}>
          <Feather name="map-pin" size={20} color="#FFFFFF" />
        </View>
      </LinearGradient>
      <View style={styles.body}>
        <ThemedText
          style={[styles.name, { color: isMine ? Brand.chatBubbleMineText : Brand.chatBubbleTheirsText }]}
          numberOfLines={1}>
          {name}
        </ThemedText>
        <View style={styles.openRow}>
          <ThemedText style={[styles.open, { color: isMine ? 'rgba(255,255,255,0.8)' : Brand.chatHeaderTop }]}>
            {ChatCopy.location.openInMaps}
          </ThemedText>
          <Feather name="chevron-right" size={13} color={isMine ? 'rgba(255,255,255,0.8)' : Brand.chatHeaderTop} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 230,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  mapBand: {
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  body: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 3,
  },
  name: { fontSize: 14, fontWeight: FontWeight.semibold, letterSpacing: -0.14 },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  open: { fontSize: 12, fontWeight: FontWeight.medium },
});
