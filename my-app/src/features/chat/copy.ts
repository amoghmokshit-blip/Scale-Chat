/** All chat-feature strings live here so future i18n can lift them out of screens. */
export const ChatCopy = {
  list: {
    /** Contact Page greeting prefix — "Hi, {firstName}". */
    greeting: (firstName: string) => `Hi, ${firstName}`,
    /** Fallback greeting when no profile is loaded. */
    greetingFallback: 'Hi there',
    searchPlaceholder: 'Search',
    filter: 'Filter Chats',
    selectedCount: (n: number) => `${n} Selected`,
    readAll: 'Read all',
    deleteAll: 'Delete all',
    empty: 'No conversations yet',
    emptyBody: 'Start a new chat to see it here.',
    /** Toast / banner shown after Read All. */
    allCaughtUp: 'All caught up',
    /** Custom filter dialog placeholder. */
    addFilterTitle: 'Custom filters',
    addFilterBody: 'Saved filters land in a future ticket.',
  },

  thread: {
    typePlaceholder: 'Type a Message',
    voiceCall: 'Voice Call',
    videoCall: 'Video Call',
    deliveredHint: 'Delivered',
    readHint: 'Read',
    todayLabel: 'Today',
    yesterdayLabel: 'Yesterday',
  },

  /** Forward (Tranche 2.E). */
  forward: {
    /** Action-sheet row + picker CTA verb. */
    action: 'Forward',
    /** Picker screen title. */
    pickerTitle: 'Forward to…',
    /** Transient state while the forward POST is in flight. */
    sending: 'Sending…',
    /** Brief success confirmation shown in the picker before it dismisses. */
    sent: 'Sent ✓',
    /** Inline error if the forward fails. */
    failed: 'Could not forward. Tap to retry.',
    /** Small label above a forwarded bubble. */
    label: 'Forwarded',
    /** Empty-picker copy (no other chats to forward to). */
    empty: 'No other chats to forward to',
  },

  /** Pin (Tranche 2.E). */
  pin: {
    pin: 'Pin',
    unpin: 'Unpin',
    /** Shown when the chat already has the max pinned messages (409). */
    capTitle: 'Pin limit reached',
    // No "unpin one first" — without a pinned-strip the user can't see which
    // are pinned, so directing them to unpin would be a dead-end. `max` is the
    // server cap (`MAX_PINNED_PER_CHAT`), passed by the caller — keeping the
    // shared constant out of this file so the Jest graph never runtime-requires
    // `@scalechat/shared` (which Jest maps to TS source with `.js` specifiers).
    capBody: (max: number) => `You've pinned the maximum of ${max} messages.`,
    failTitle: 'Could not pin',
    failBody: 'Please try again.',
  },

  attachments: {
    title: 'Share',
    camera: 'Camera',
    gallery: 'Gallery',
    document: 'Document',
    contact: 'Contact',
    location: 'Location',
  },

  /** Document + Video kinds (Tranche 2.C). */
  media: {
    /** Title for a rejected-pick Alert. */
    cantSendTitle: 'Unable to send file',
    tooLarge: (maxMb: number) => `That file is too large. The limit is ${maxMb} MB.`,
    unsupportedType: 'That file type is not supported.',
    empty: 'That file appears to be empty.',
    /** Bubble fallback label when a document has no name. */
    documentFallbackName: 'Document',
    /** Reply-quote + chat-list preview labels. */
    videoLabel: 'Video',
    documentLabel: 'Document',
  },

  recorder: {
    recording: 'Recording…',
    holdToRecord: 'Tap send to share when ready',
    tapSendToShare: 'Tap send to share',
    permissionDenied: 'Microphone permission denied',
  },

  /** Coming-Soon sheet copy for affordances visible in Figma but shipping later. */
  comingSoon: {
    voiceCall: {
      title: 'Voice calls launching soon',
      body: 'Free voice calls are on the way. We’re putting the finishing touches on call quality across Indian networks.',
      footnote: 'Calls will be free for everyone — not behind any premium plan.',
    },
    videoCall: {
      title: 'Video calls launching soon',
      body: 'Face-to-face on ScaleChat is almost ready. We’re tuning it for slower connections first.',
      footnote: 'Calls will be free for everyone — not behind any premium plan.',
    },
    chatTheme: {
      title: 'Chat themes coming soon',
      body: 'Pick a custom wallpaper or theme for each conversation. Landing in the next polish ticket.',
    },
    exportChat: {
      title: 'Export chat coming soon',
      body: 'You’ll soon be able to email or save a chat transcript with or without media.',
    },
  },
} as const;
