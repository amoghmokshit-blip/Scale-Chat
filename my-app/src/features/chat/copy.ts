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

  /** Invite a friend (New Chat picker → system share sheet). */
  invite: {
    /** Footer button + share-sheet dialog title. */
    button: 'Invite a friend',
    shareTitle: 'Invite to ScaleChat',
    // TODO: swap for the real Play Store / universal link once the app ships.
    url: 'https://scalechat.app',
    shareMessage: (link: string) =>
      `Hey! I'm on ScaleChat — let's chat here. Get it: ${link}`,
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
    poll: 'Poll',
  },

  /** Polls (Tranche 2.F — 1-on-1 scope). */
  poll: {
    composerTitle: 'New poll',
    questionPlaceholder: 'Ask a question…',
    optionPlaceholder: (n: number) => `Option ${n}`,
    addOption: 'Add option',
    multiSelectLabel: 'Allow multiple answers',
    create: 'Create poll',
    creating: 'Creating…',
    /** Subline below the bubble — "N voted" with pluralisation. */
    votedCount: (n: number) => (n === 1 ? '1 voted' : `${n} voted`),
    closed: 'Poll closed',
    closeAction: 'Close poll',
    closeFailed: 'Could not close the poll. Please try again.',
    voteFailed: 'Could not record your vote. Please try again.',
    /** Validation toasts. */
    needTwoOptions: 'A poll needs at least 2 options.',
    duplicateOption: 'Each option must be unique.',
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

  /** Location (Tranche 2.D). */
  location: {
    /** Confirm before sharing precise current GPS (privacy-first). */
    confirmTitle: 'Share your location?',
    confirmBody: 'Your current location will be sent in this chat.',
    confirmCta: 'Share location',
    permissionDenied: 'Location permission is needed to share where you are. Enable it in Settings.',
    unavailable: 'Couldn’t get your location. Make sure location is on and try again.',
    bubbleFallback: 'Location',
    openInMaps: 'Open in Maps',
  },

  /** Contact card (Tranche 2.D). */
  contact: {
    pickerTitle: 'Share a contact',
    searchPlaceholder: 'Search contacts',
    permissionDenied: 'Contacts permission is needed to share a contact. Enable it in Settings.',
    grantCta: 'Allow access to contacts',
    empty: 'No contacts found',
    noNumber: 'No number',
    bubbleFallback: 'Contact',
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

  /** Voice/Video call UI (Tranche 2.I). */
  calls: {
    incomingVoice: 'Incoming voice call',
    incomingVideo: 'Incoming video call',
    accept: 'Accept',
    decline: 'Decline',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    ringing: 'Ringing…',
    endCall: 'End call',
    mute: 'Mute',
    unmute: 'Unmute',
    speaker: 'Speaker',
    flipCamera: 'Flip',
    callFailed: 'Couldn’t connect the call',
    permissionTitle: 'Permission needed',
    permissionBody:
      'ScaleChat needs microphone (and camera for video) access to place calls. Enable it in Settings.',
  },
} as const;
