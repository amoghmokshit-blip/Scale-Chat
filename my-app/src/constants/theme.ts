/**
 * Single source of truth for design tokens.
 *
 * Source: Figma file JYhOHnaEDgGYNxJShD9WDK ("SlayChat" — earlier brand name, see CLAUDE.md §1).
 *
 * Hard rule: never hard-code colors / spacing in screens. Extend tokens here.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Theme-aware tokens (resolved through `useTheme()`).
 * Dark mode is the source of truth in the Figma; light mode mirrors the same intent.
 */
export const Colors = {
  light: {
    text: '#101012',
    textSecondary: '#5C6068',
    background: '#FFFFFF',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    surfaceMuted: '#F1F2F5',
    surfaceInput: '#EDEEF2',
    surfaceModal: '#FFFFFF',
    inputPlaceholder: '#8A8A92',
    divider: '#E5E6EA',
    chatBubbleMine: '#6F7FE8',
    chatBubbleTheirs: '#F1F2F5',
    chatBubbleMineText: '#FFFFFF',
    chatBubbleTheirsText: '#101012',
    bubbleTimestamp: '#5C6068',
    danger: '#E54848',
    /** Contact Page tokens (Figma "Contact Page" frame). */
    headerCard: '#6F7FE8',
    headerCardText: '#FFFFFF',
    headerCardIconBg: 'rgba(255,255,255,0.18)',
    menuBackground: '#FFFFFF',
    menuBorder: '#E5E6EA',
    menuHover: '#F4F5F8',
    statusRingActive: '#E2FA61',
    statusRingMuted: '#D0D2D8',
    tabBarBackground: '#E9EAEE',
    tabBarIcon: '#5C6068',
    tabBarIconActive: '#1F2025',
    tabBarFAB: '#6F7FE8',
    onlineDot: '#1FD160',
  },
  dark: {
    /** Figma canvas background. */
    text: '#FFFFFF',
    textSecondary: '#D6D6DA',
    background: '#0B1014',
    backgroundElement: '#1B1D22',
    backgroundSelected: '#2B2E34',
    /** Pill / picker fill on dark mode (matches Figma `#383838`). */
    surfaceMuted: '#1F2025',
    surfaceInput: '#383838',
    surfaceModal: '#1B1D22',
    inputPlaceholder: '#6E6E6E',
    divider: '#26272C',
    /** Chat thread (Figma 1:2972) — mine purple `#5360EC`, theirs cream `#EDEDED`. */
    chatBubbleMine: '#5360EC',
    chatBubbleTheirs: '#EDEDED',
    chatBubbleMineText: '#EDEDED',
    chatBubbleTheirsText: '#313131',
    bubbleTimestamp: '#838383',
    danger: '#FF5C5C',
    /** Contact Page tokens — desaturated for dark surfaces. */
    headerCard: '#3D49AE',
    headerCardText: '#FFFFFF',
    headerCardIconBg: 'rgba(255,255,255,0.14)',
    menuBackground: '#1B1D22',
    menuBorder: '#2B2E34',
    menuHover: '#23262C',
    statusRingActive: '#E2FA61',
    statusRingMuted: '#3A3C42',
    tabBarBackground: '#1B1D22',
    tabBarIcon: '#A0A2A8',
    tabBarIconActive: '#FFFFFF',
    tabBarFAB: '#6F7FE8',
    onlineDot: '#1FD160',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Brand tokens — constant across light/dark mode.
 * Values match the source-of-truth Figma (Account Setup pages 1-7).
 */
export const Brand = {
  /** Primary purple used for titles (Figma `#6F7AFC`). */
  primary: '#6F7AFC',
  primaryDeep: '#4757D9',
  primarySoft: '#A9B0FF',
  /** Welcome card body purple. */
  cardWelcome: '#6F7FE8',
  /** Lime accent used on every primary CTA (Figma `#E2FA61`). */
  accent: '#E2FA61',
  /** Dark text used on the lime pill. */
  accentText: '#1B1B1B',
  /** Outlined CTA border on dark mode. */
  outlineDark: '#FFFFFF',
  outlineLight: '#101012',
  /** End-to-end encrypted hint text. */
  hintMuted: '#D6D6DA',
  /**
   * Chat thread tokens — Figma "Chat Page" (1:2972). These intentionally diverge
   * from the welcome / setup palette so the thread reads as a darker, denser
   * surface than the rest of the app.
   */
  chatHeaderTop: '#4552E4',
  chatHeaderBottom: '#707CFD',
  chatBody: '#000000',
  chatBubbleMine: '#5360EC',
  chatBubbleTheirs: '#EDEDED',
  chatBubbleMineText: '#EDEDED',
  chatBubbleTheirsText: '#313131',
  chatTimestamp: '#838383',
  chatDayPill: 'rgba(36,36,36,0.74)',
  chatDayPillText: '#777777',
  chatComposerBg: '#272727',
  chatComposerInputBg: '#474545',
  chatComposerPlaceholder: '#979797',
  chatComposerIcon: '#EDEDED',
  /** Lime green used for header call buttons + read receipts in the thread. */
  chatActionLime: '#B3EF2B',
  chatActionLimeText: '#1B1B1B',
  chatReadTick: '#B3EF2B',
  /**
   * Attachment panel (Figma 1:3098) — bottom sheet with Camera / Gallery /
   * Document / Contact / Location tiles. Dark slab so the tiles read against
   * the dark thread body.
   */
  chatAttachmentSheetBg: '#1A1A1A',
  chatAttachmentTileBg: '#2A2A2A',
  chatAttachmentTileLabel: '#EDEDED',
  chatAttachmentBackdrop: 'rgba(0,0,0,0.55)',
  /**
   * Voice recording overlay (Figma 1:3698) — pulsing red dot + timer + live
   * waveform + slide-to-cancel hint.
   */
  chatRecordingDot: '#FF4D4D',
  chatRecordingBg: '#1A1A1A',
  chatRecordingHint: '#979797',
  /** Image bubble placeholder while the asset is loading (matches dark thread). */
  chatImagePlaceholder: '#2A2A2A',
  /** Voice playback progress fill (lime for played, muted for unplayed). */
  chatVoicePlayed: '#B3EF2B',
  chatVoiceUnplayed: 'rgba(237,237,237,0.45)',
  /** Contact Profile v2 (Figma 1:3877). */
  profileBg: '#09080e',
  profileBackCircle: '#d7daff',
  destructiveRed: '#ff2a2d',

  /**
   * Per-chat theme token map (P2-Theme). Each entry fully describes one chat
   * "wallpaper": background slab + mine/theirs bubble surfaces + their text colors.
   *
   * These are intentionally dark-palette regardless of the device light/dark
   * mode — matching WhatsApp's wallpaper behavior where the thread background
   * is theme-controlled, not system-color-scheme-controlled.
   *
   * KEEP KEYS IN SYNC WITH `ChatThemeEnum` in `@scalechat/shared`.
   */
  chatThemes: {
    /** Default — matches the existing Figma dark thread (Brand.chatBody + chatBubble*). */
    default: {
      body: '#000000',
      mine: '#5360EC',
      theirs: '#EDEDED',
      mineText: '#EDEDED',
      theirsText: '#313131',
    },
    /** Midnight — deep navy with GitHub-blue mine bubbles + silver theirs. */
    midnight: {
      body: '#0D1117',
      mine: '#1F6FEB',
      theirs: '#C9D1D9',
      mineText: '#FFFFFF',
      theirsText: '#111827',
    },
    /** Forest — dark jungle with deep-green mine + mint theirs. */
    forest: {
      body: '#0D1F1A',
      mine: '#2D6A4F',
      theirs: '#D8F3DC',
      mineText: '#FFFFFF',
      theirsText: '#1B4332',
    },
    /** Sunset — dark maroon with crimson mine + apricot theirs. */
    sunset: {
      body: '#1A0D0D',
      mine: '#AE2012',
      theirs: '#FFE8D6',
      mineText: '#FFFFFF',
      theirsText: '#6B1010',
    },
  },
} as const;

export type BrandColor = keyof typeof Brand;

/** Shape of a single chat-theme token entry (P2-Theme). */
export type ChatThemeToken = {
  body: string;
  mine: string;
  theirs: string;
  mineText: string;
  theirsText: string;
};

/**
 * Typography. The Figma uses Jeko-Black + Poppins, neither of which ship with RN/Expo by
 * default. We approximate with the system sans/rounded faces; if a future ticket bundles
 * Poppins via `expo-font`, swap the values here and every screen picks it up.
 */
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/** Common font-weight palette so screens stay aligned on heading hierarchy. */
export const FontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Visual radius tokens — keep all roundness decisions here. */
export const Radius = {
  /** Pill buttons + inputs (full half-height). */
  pill: 32,
  card: 20,
  cardLg: 28,
  bubble: 18,
  square: 14,
  /** Floating tab-bar capsule (Figma Contact Page bottom bar). */
  bubblePill: 48,
} as const;

/**
 * Elevation tokens — single source of truth for shadow / drop styles.
 * RN's shadow API differs on iOS (shadowColor/Offset/Opacity/Radius) and
 * Android (elevation); we encode both per layer.
 */
export const Shadow = {
  small: Platform.select({
    ios: {
      shadowColor: '#0B1014',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
    },
    android: { elevation: 2 },
    default: {},
  }) as object,
  medium: Platform.select({
    ios: {
      shadowColor: '#0B1014',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.12,
      shadowRadius: 14,
    },
    android: { elevation: 6 },
    default: {},
  }) as object,
  floating: Platform.select({
    ios: {
      shadowColor: '#0B1014',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.18,
      shadowRadius: 28,
    },
    android: { elevation: 12 },
    default: {},
  }) as object,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
