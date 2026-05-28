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

  /**
   * Contact Profile v2 (Figma 1:3877) — coming-soon sheet titles/bodies
   * for affordances not yet wired, plus the clear-chat confirm dialog.
   */
  profile: {
    /** Per-chat search — sheet title + body. */
    searchTitle: 'Search coming soon',
    searchBody: 'Search through messages in this chat. We\'re putting the finishing touches on it.',
    /** Chat theme / wallpaper — sheet title + body. */
    chatThemeTitle: 'Chat themes coming soon',
    chatThemeBody: 'Pick a custom wallpaper or colour theme just for this conversation.',
    /** Manage storage — sheet title + body. */
    manageStorageTitle: 'Storage manager coming soon',
    manageStorageBody: 'Review and delete media to free up space on your device.',
    /** Privacy settings — sheet title + body. */
    privacyTitle: 'Privacy settings coming soon',
    privacyBody: 'Control what this contact can see — profile photo, last seen, status updates.',
    /** Clear chat confirm — title, body, and CTA. */
    clearChatConfirmTitle: 'Clear this chat?',
    clearChatConfirmBody: 'All messages will be removed from your device. Your contact will still have their copy.',
    clearChatCta: 'Clear chat',
    /** Media, Links & Docs — sheet title + body (shown when no commonChatId). */
    mediaTitle: 'No shared media yet',
    mediaBody: 'Start a chat to share photos, voice notes, and documents — they\'ll show up here.',
  },

  /** In-thread message search overlay (P2-Search). */
  search: {
    /** Modal title. */
    title: 'Search in chat',
    /** TextInput placeholder. */
    placeholder: 'Search messages…',
    /** Shown when the query is empty / too short. */
    emptyPrompt: 'Type to search messages',
    /** Shown when a valid query returns no hits. */
    noResults: 'No messages found',
    /** Sender label when the hit was sent by me. */
    senderMe: 'You',
    /** Generic error shown when the network call fails. */
    error: 'Search failed. Please try again.',
  },

  /** Manage Storage screen (P2-Storage). */
  storage: {
    /** Screen header title. */
    title: 'Manage Storage',
    /** Sub-label under the total bytes figure. */
    totalLabel: 'Total storage used',
    /** Disclaimer under the total card. */
    disclaimer: 'Sizes shown for media sent after the last app update.',
    /** Human-readable label for each MessageKind row. */
    kindLabel: {
      TEXT: 'Text messages',
      IMAGE: 'Photos',
      VOICE: 'Voice notes',
      VIDEO: 'Videos',
      DOCUMENT: 'Documents',
      LOCATION: 'Locations',
      LOCATION_LIVE: 'Live locations',
      CONTACT_CARD: 'Contacts',
      POLL: 'Polls',
      CALL_EVENT: 'Call events',
      SYSTEM: 'System',
    } as Record<string, string>,
    /** "N items" / "1 item" count sub-label. */
    itemCount: (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`,
    /** Empty-state body (no messages yet). */
    empty: 'No messages in this chat yet.',
    /** Generic network / fetch error. */
    error: 'Could not load storage info.',
    /** Shown when the screen is opened without a chatId param. */
    noChatId: 'No chat id provided.',
    /** "Free up space" button label (also used as accessibilityLabel). */
    freeUpSpace: 'Free up space',
    /** Alert shown when the user taps "Free up space". */
    freeUpAlert: {
      title: 'Free up space',
      body: 'This will clear locally cached media for this chat. The files will still be available to download again.',
      clearCache: 'Clear cache',
      cancel: 'Cancel',
    },
    /** Alert shown after the stub clear completes. */
    doneAlert: {
      title: 'Done',
      body: 'Local cache cleared for this chat.',
    },
  },

  /** Per-chat theme picker (P2-Theme). */
  theme: {
    /** Modal title shown in the picker sheet. */
    pickerTitle: 'Chat theme',
    /** Display names for each theme value (KEEP IN SYNC WITH ChatThemeEnum). */
    nameDefault: 'Default',
    nameMidnight: 'Midnight',
    nameForest: 'Forest',
    nameSunset: 'Sunset',
    /** Alert shown when the server rejects the theme change. */
    applyFailed: 'Could not apply theme. Please try again.',
  },

  /** Privacy sub-screen (P2-Privacy). */
  privacy: {
    /** Screen header title. */
    screenTitle: 'Privacy',
    /** Encryption row label. */
    encryptionLabel: 'Encryption',
    /** Encryption row hint shown below the label. */
    encryptionHint: 'Messages secured in transit',
    /** ComingSoonSheet title for the encryption info modal. */
    encryptionTitle: 'End-to-end encryption',
    /** ComingSoonSheet body for the encryption info modal. */
    encryptionBody:
      'All messages between you and this contact are encrypted in transit using TLS. No one outside this conversation can read them.',
    /** Disappearing messages row label. */
    disappearingLabel: 'Disappearing messages',
    /** Disappearing messages hint (coming-soon placeholder). */
    disappearingHint: 'Coming soon',
    /** Block row label (contact is not blocked). */
    blockLabel: 'Block',
    /** Unblock row label (contact is already blocked). */
    unblockLabel: 'Unblock',
    /** Hint shown under block label when not blocked. */
    blockHint: "Block this contact",
    /** Hint shown under unblock label when blocked. */
    blockedHint: 'You have blocked this contact',
    /** Alert title for blocking — includes the contact name. */
    blockAlertTitle: (name: string) => `Block ${name}?`,
    /** Alert title for unblocking — includes the contact name. */
    unblockAlertTitle: (name: string) => `Unblock ${name}?`,
    /** Alert body for blocking. */
    blockAlertBody:
      "They won't be able to message you, and you won't be able to message them, until you unblock.",
    /** Alert body for unblocking. */
    unblockAlertBody: 'You will both be able to message each other again.',
    /** Error shown when block fails. */
    blockFailed: 'Could not block. Please try again.',
    /** Error shown when unblock fails. */
    unblockFailed: 'Could not unblock. Please try again.',
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
